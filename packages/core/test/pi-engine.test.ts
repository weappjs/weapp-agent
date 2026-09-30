import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai'
import type { ModelChunk, SessionEvent, Tool } from '../src/types.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { z } from 'zod'
import { configSchema, fileTools, runPiAgent, Session, toPiMessage } from '../src/index.js'
import { scriptedPiModel } from './pi-model.js'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'weapp-pi-'))
  process.env.WEAPP_AGENT_STATE_DIR = path.join(root, 'state')
})
afterEach(async () => {
  delete process.env.WEAPP_AGENT_STATE_DIR
  await rm(root, { recursive: true, force: true })
})
const config = configSchema.parse({ model: { provider: 'openai', name: 'test' } })
const call = (id: string, name: string, input: unknown = {}): ModelChunk => ({ type: 'call', call: { id, name, input } })
function scripted(steps: ModelChunk[][]) {
  return scriptedPiModel({ id: 'test', async* stream() {
    yield* steps.shift() ?? [{ type: 'text', text: 'done' }]
  } })
}
it('awaits each tool and its durable record, blocks the rest of a batch after denial', async () => {
  const events: SessionEvent[] = []
  const order: string[] = []
  const first: Tool = {
    name: 'first',
    description: '',
    schema: z.strictObject({}),
    mutates: true,
    async execute() {
      const journal = await readFile(new Session(root, events[0]!.sessionId).filename, 'utf8')
      expect(journal).toContain('tool.started')
      expect(journal).toContain('assistant')
      order.push('first')
      await Promise.resolve()
      order.push('finished')
      return { text: 'ok' }
    },
  }
  const result = await runPiAgent({ root, config, trusted: true, tools: [first, ...fileTools()], model: scripted([[call('a', 'first'), call('b', 'shell', { command: 'touch denied' }), call('c', 'create_file', { path: 'skipped', content: 'no' })]]), prompt: 'batch', onEvent: (event) => {
    events.push(event)
  } })
  expect(result.status).toBe('action_required')
  expect(order).toEqual(['first', 'finished'])
  await expect(readFile(path.join(root, 'denied'))).rejects.toThrow()
  await expect(readFile(path.join(root, 'skipped'))).rejects.toThrow()
  expect(events.filter(e => e.type === 'step.started')).toHaveLength(1)
  const session = new Session(root, result.sessionId)
  await session.open(true)
  expect(session.unresolved()).toEqual([])
  expect(session.messages.filter(m => m.role === 'tool')).toHaveLength(3)
  await session.close()
})
it('leaves an interrupted effect unresolved and prevents a follow-up request', async () => {
  const abort = new AbortController()
  let executions = 0
  const effect: Tool = { name: 'effect', description: '', schema: z.strictObject({}), mutates: true, async execute() {
    executions++
    abort.abort()
    throw new Error('interrupted')
  } }
  const result = await runPiAgent({ root, config, signal: abort.signal, tools: [effect], model: scripted([[call('pending', 'effect')]]), prompt: 'effect' })
  expect(result.status).toBe('cancelled')
  const resumed = await runPiAgent({ root, config, sessionId: result.sessionId, tools: [effect], model: scripted([]), prompt: 'resume' })
  expect(resumed.status).toBe('action_required')
  expect(executions).toBe(1)
})
it('does not execute a tool if the assistant journal observer fails', async () => {
  let executed = false
  const tool: Tool = { name: 'effect', description: '', schema: z.strictObject({}), mutates: true, async execute() {
    executed = true
    return { text: 'bad' }
  } }
  const result = await runPiAgent({ root, config, tools: [tool], model: scripted([[call('a', 'effect')]]), prompt: 'effect', onEvent(event) {
    if (event.type === 'message' && (event.data.message as {
      role: string
    }).role === 'assistant') {
      throw new Error('journal observer failed')
    }
  } })
  expect(result.status).toBe('failed')
  expect(executed).toBe(false)
})
it('rejects duplicate call IDs before running any effect', async () => {
  const result = await runPiAgent({ root, config, trusted: true, tools: fileTools(), model: scripted([[call('same', 'create_file', { path: 'a', content: 'a' }), call('same', 'create_file', { path: 'b', content: 'b' })]]), prompt: 'duplicate' })
  expect(result.status).toBe('failed')
  await expect(readFile(path.join(root, 'a'))).rejects.toThrow()
})

it('never executes tool arguments from an output truncated by the model', async () => {
  const model = { ...scripted([]) }
  let step = 0
  model.stream = () => {
    const message = toPiMessage(step++ === 0
      ? { role: 'assistant', text: '', calls: [{ id: 'cut', name: 'create_file', input: { path: 'truncated', content: 'incomplete' } }] }
      : { role: 'assistant', text: 'Stopped after truncated output' }, model.model) as AssistantMessage
    message.stopReason = step === 1 ? 'length' : 'stop'
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'done', reason: message.stopReason, message })
    return stream
  }
  const result = await runPiAgent({ root, config, tools: fileTools(), model, trusted: true, prompt: 'write' })
  expect(result.status).toBe('completed')
  await expect(readFile(path.join(root, 'truncated'))).rejects.toThrow()
})

it('normalizes cached input usage without counting output twice', async () => {
  const model = { ...scripted([]) }
  model.stream = () => {
    const message = toPiMessage({ role: 'assistant', text: 'ok' }, model.model) as AssistantMessage
    message.usage = { ...message.usage, input: 10, cacheRead: 2, cacheWrite: 3, output: 7, totalTokens: 22 }
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'done', reason: 'stop', message })
    return stream
  }
  const events: SessionEvent[] = []
  await runPiAgent({ root, config, tools: [], model, prompt: 'tokens', onEvent: (event) => {
    events.push(event)
  } })
  expect(events.find(e => e.type === 'usage')?.data).toEqual({ inputTokens: 15, outputTokens: 7 })
})
it('preserves provider-native metadata across resume and images/data across tool conversion', async () => {
  const model = { ...scripted([]) }
  const native = toPiMessage({ role: 'assistant', text: 'ok' }, model.model) as AssistantMessage
  native.content = [{ type: 'thinking', thinking: 'retained', thinkingSignature: 'signature' }, { type: 'text', text: 'ok', textSignature: 'text-signature' }]
  native.responseId = 'response-1'
  model.stream = () => {
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'done', reason: 'stop', message: native })
    return stream
  }
  const first = await runPiAgent({ root, config, tools: [], model, prompt: 'start' })
  let history: PiMessage[] = []
  model.stream = (_model, context) => {
    history = context.messages
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'done', reason: 'stop', message: native })
    return stream
  }
  await runPiAgent({ root, config, tools: [], model, sessionId: first.sessionId, prompt: 'resume' })
  expect(history.find(m => m.role === 'assistant')).toMatchObject({ responseId: 'response-1', content: native.content })
  const result = toPiMessage({ role: 'tool', callId: 'x', name: 'capture', result: { text: 'image', data: { route: 'home' }, images: [{ type: 'image', data: 'base64', mediaType: 'image/png' }] } }, model.model)
  expect(JSON.stringify(result)).toContain('home')
  expect(JSON.stringify(result)).toContain('image/png')
})

it('counts native reasoning metadata in the context budget without orphaned tools', async () => {
  const model = { ...scripted([]) }
  const native = toPiMessage({ role: 'assistant', text: 'ok' }, model.model) as AssistantMessage
  native.content.unshift({ type: 'thinking', thinking: 'large '.repeat(10_000), thinkingSignature: 'signature' })
  const session = new Session(root)
  await session.open()
  await session.append('message', { message: { role: 'assistant', text: 'ok' }, piMessage: native })
  await session.close()
  model.stream = (_model, context) => {
    expect(JSON.stringify(context.messages).length).toBeLessThan(8000)
    expect(JSON.stringify(context.messages)).toContain('Latest goal')
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'done', reason: 'stop', message: toPiMessage({ role: 'assistant', text: 'done' }, model.model) as AssistantMessage })
    return stream
  }
  const result = await runPiAgent({ root, config: { ...config, contextCharacters: 8000 }, tools: [], model, sessionId: session.id, prompt: 'Latest goal' })
  expect(result.status).toBe('completed')
})
it('reports failed verification data and allows a model to repair and verify again', async () => {
  let checked = 0
  const reports: unknown[] = []
  const tool: Tool = { name: 'verify_project', description: '', schema: z.strictObject({}), mutates: true, async execute() {
    checked++
    return { text: checked === 1 ? 'failed' : 'passed', data: { passed: checked > 1 } }
  } }
  const result = await runPiAgent({ root, config, tools: [tool], model: scripted([[call('v1', 'verify_project')], [call('v2', 'verify_project')], [{ type: 'text', text: 'verified' }]]), prompt: 'verify', onEvent(event) {
    if (event.type === 'tool.completed') {
      reports.push(event.data.result)
    }
  } })
  expect(result.status).toBe('completed')
  expect(reports).toEqual([{ text: 'failed', data: { passed: false } }, { text: 'passed', data: { passed: true } }])
})
