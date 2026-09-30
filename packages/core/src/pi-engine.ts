import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core'
import type { Api, Model, Message as PiMessage } from '@earendil-works/pi-ai'
import type { RunOptions } from './engine.js'
import type { Message, RunResult, RunStatus } from './types.js'
import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { z } from 'zod'
import { compactMessages } from './context.js'
import { agentInstructions } from './instructions.js'
import { assistantText, fromPiMessage, piToolResult, redactPiMessage, toPiMessage } from './pi-messages.js'
import { ApprovalRequired, redactor, redactValue } from './security.js'
import { Session } from './session.js'

export interface PiModelAdapter {
  readonly id: string
  readonly model: Model<Api>
  readonly stream: StreamFn
}

export interface PiRunOptions extends Omit<RunOptions, 'model'> {
  model: PiModelAdapter
}

/** Pi owns scheduling; the journal and guarded tools own durable effects. */
export async function runPiAgent(options: PiRunOptions): Promise<RunResult> {
  const session = new Session(options.root, options.sessionId)
  await session.open(Boolean(options.sessionId))
  const clean = redactor()
  let agent: Agent | undefined
  let unsubscribe: (() => void) | undefined
  let fatal: Error | undefined
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.config.timeoutMs)])
  const stop = () => agent?.abort()
  const ctx = { root: options.root, trusted: options.trusted ?? false, approve: options.approve ?? (async () => false), signal }
  const emit = async (type: string, data: Record<string, unknown>) => {
    try {
      const event = await session.append(type, data)
      await options.onEvent?.(event)
    }
    catch (error) {
      fatal = error instanceof Error ? error : new Error(String(error))
      agent?.abort()
      throw fatal
    }
  }
  const finish = async (status: RunStatus, text: string): Promise<RunResult> => {
    await emit('run.completed', { status, text: clean(text) })
    return { sessionId: session.id, status, text: clean(text) }
  }
  let needsVerification = false
  for (const event of session.events) {
    if (event.type === 'tool.started' && ['edit_file', 'create_file', 'shell'].includes(String(event.data.name))) {
      needsVerification = true
    }
    if (event.type === 'tool.completed' && event.data.name === 'verify_project' && !event.data.error) {
      needsVerification = false
    }
  }
  let approvalReason: string | undefined
  let step = 0
  let limitReached = false
  let lastText = ''
  let modelError: string | undefined
  // Pi turns aborts into tool errors. An interrupted effect must remain unresolved
  // in our journal so resume cannot silently treat its outcome as known.
  const interrupted = new Set<string>()
  let buffer = ''
  const flush = async (final = false) => {
    const cut = final ? buffer.length : Math.max(buffer.lastIndexOf('\n'), buffer.lastIndexOf(' ')) + 1
    if (cut > 0) {
      await emit('text.delta', { text: clean(buffer.slice(0, cut)) })
      buffer = buffer.slice(cut)
    }
  }
  const contextMessages = () => {
    const compact = compactMessages(session.messages, options.config.contextCharacters)
    // Keep provider-native signatures/response ids for retained assistant turns.
    // Both representations are redacted and committed in the same journal record.
    const native = new Map(session.events.filter(e => e.type === 'message' && e.data.piMessage).map(e => [e.data.message as Message, e.data.piMessage as PiMessage]))
    const piMessages = compact.messages.map(m => m.role === 'assistant' && native.has(m) ? native.get(m)! : toPiMessage(m, options.model.model))
    const size = JSON.stringify(piMessages, (_key, value) => value?.type === 'image' ? { type: 'image', data: '[image]'.repeat(256) } : value).length
    if (size > options.config.contextCharacters) {
      // Native reasoning/signatures also consume context. Omit the entire group
      // rather than keeping invalid signatures or orphaning tool results.
      const latest = session.messages.findLast(m => m.role === 'user')
      const fallback: Message = {
        role: 'user',
        text: `Oversized earlier context omitted. Inspect project files again before making changes.\nLatest user request: ${latest?.text.slice(0, Math.floor(options.config.contextCharacters * 0.4)) ?? ''}`,
        ...(latest?.role === 'user' && latest.images ? { images: latest.images } : {}),
      }
      return { compacted: true, messages: [fallback], piMessages: [toPiMessage(fallback, options.model.model)] }
    }
    return { ...compact, piMessages }
  }
  try {
    await emit('run.started', { root: options.root, model: options.model.id, resumed: Boolean(options.sessionId), engine: 'pi', engineVersion: '0.85.1' })
    const unresolved = session.unresolved()
    if (unresolved.length && !options.acknowledgeInterrupted) {
      await emit('recovery.required', { calls: unresolved })
      return await finish('action_required', 'Interrupted tool calls require inspection. Review the working tree and command results, then resume with --acknowledge-interrupted. Calls will not be replayed.')
    }
    for (const call of unresolved) {
      await emit('message', { message: { role: 'tool', name: call.name, callId: call.id, error: true, result: { text: 'Execution was interrupted. User acknowledged inspection; outcome unknown. Do not repeat this action without first checking current state.' } } satisfies Message })
    }
    signal.throwIfAborted()
    const registry = new Map(options.tools.map(tool => [tool.name, tool]))
    if (registry.size !== options.tools.length) {
      throw new Error('Duplicate tool names')
    }
    const tools: AgentTool[] = options.tools.map(tool => ({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: Type.Unsafe(z.toJSONSchema(tool.schema)),
      executionMode: 'sequential',
      replay: 'never',
      // Zod supplies defaults and rejects unknown keys before Pi's validation.
      prepareArguments: input => tool.schema.parse(input),
      async execute(callId, input) {
        signal.throwIfAborted()
        if (fatal) {
          throw fatal
        }
        if (approvalReason) {
          throw new ApprovalRequired(approvalReason)
        }
        await emit('tool.started', { callId, name: tool.name, input, mutates: tool.mutates })
        if (['edit_file', 'create_file', 'shell'].includes(tool.name)) {
          needsVerification = true
        }
        try {
          const result = await tool.execute(input, ctx)
          signal.throwIfAborted()
          if (tool.name === 'verify_project') {
            needsVerification = false
          }
          return piToolResult(redactValue(result, clean))
        }
        catch (error) {
          if (signal.aborted) {
            interrupted.add(callId)
          }
          if (error instanceof ApprovalRequired) {
            approvalReason = clean(error.message)
          }
          throw error
        }
      },
    }))
    agent = new Agent({
      initialState: { systemPrompt: `${agentInstructions}\n${options.system ?? ''}`, model: options.model.model, thinkingLevel: 'off', tools, messages: contextMessages().piMessages },
      streamFn: options.model.stream,
      toolExecution: 'sequential',
      sessionId: session.id,
      transformContext: async () => {
        const context = contextMessages()
        if (context.compacted) {
          await emit('context.compacted', { before: session.messages.length, after: context.messages.length })
        }
        return context.piMessages
      },
      beforeToolCall: async () => {
        if (fatal || signal.aborted) {
          return { block: true, reason: 'Run stopped', terminate: true }
        }
        if (approvalReason) {
          return { block: true, reason: 'Not executed: an earlier call needs approval.', terminate: true }
        }
        // Exact-command/MCP approvals stay in the guarded Tool.execute methods.
        // They can inspect the current fingerprint and paths at execution time.
        return undefined
      },
      afterToolCall: async ({ result }) => ({ ...redactValue(result, clean), terminate: Boolean(approvalReason) }),
      shouldStopAfterTurn: ({ message }) => {
        if (approvalReason || fatal || signal.aborted) {
          return true
        }
        const pending = message.content.some(c => c.type === 'toolCall') || (needsVerification && registry.has('verify_project'))
        if (step >= options.config.maxSteps && pending) {
          limitReached = true
          return true
        }
        return false
      },
    })
    unsubscribe = agent.subscribe(async (event) => {
      if (fatal) {
        return
      }
      if (event.type === 'turn_start') {
        step++
        await emit('step.started', { step })
      }
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        buffer += event.assistantMessageEvent.delta
        await flush()
      }
      if (event.type === 'message_end') {
        const message = event.message
        if (message.role === 'toolResult' && interrupted.has(message.toolCallId)) {
          return
        }
        if (message.role === 'assistant') {
          await flush(true)
          lastText = assistantText(message)
          if (message.stopReason === 'error' || message.stopReason === 'aborted') {
            modelError = message.errorMessage ?? 'Model request failed'
          }
          const calls = message.content.filter(c => c.type === 'toolCall')
          if (new Set(calls.map(c => c.id)).size !== calls.length) {
            fatal = new Error('Provider returned a duplicate tool call ID')
            agent!.abort()
            return
          }
          await emit('usage', { inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite, outputTokens: message.usage.output })
        }
        const normalized = fromPiMessage(message as PiMessage)
        await emit('message', { message: normalized, ...(message.role === 'assistant' ? { piMessage: redactPiMessage(message, clean) } : {}) })
        if (normalized.role === 'tool') {
          await emit('tool.completed', { callId: normalized.callId, name: normalized.name, result: normalized.result, error: normalized.error })
        }
      }
      if (event.type === 'turn_end' && !approvalReason && !modelError && !signal.aborted && needsVerification && registry.has('verify_project') && event.message.role === 'assistant' && !event.message.content.some(c => c.type === 'toolCall')) {
        agent!.followUp({ role: 'user', content: 'Files changed since the last verification. Call verify_project before finishing; report failed and unverified categories honestly.', timestamp: Date.now() })
      }
    })
    signal.addEventListener('abort', stop, { once: true })
    signal.throwIfAborted()
    await agent.prompt(toPiMessage({ role: 'user', text: options.prompt, images: options.images }, options.model.model))
    if (fatal) {
      throw fatal
    }
    if (signal.aborted) {
      return await finish('cancelled', 'Run cancelled')
    }
    if (approvalReason) {
      return await finish('action_required', approvalReason)
    }
    if (modelError || agent.state.errorMessage) {
      return await finish('failed', modelError ?? agent.state.errorMessage!)
    }
    if (limitReached) {
      return await finish('limit_reached', `Stopped after ${options.config.maxSteps} model steps. Resume the session to continue.`)
    }
    return await finish('completed', lastText)
  }
  catch (error) {
    return await finish(signal.aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error))
  }
  finally {
    signal.removeEventListener('abort', stop)
    unsubscribe?.()
    agent?.abort()
    await agent?.waitForIdle()
    await session.close()
  }
}
