import type { PiModelAdapter } from '../src/pi-engine.js'
import type { ModelAdapter } from '../src/types.js'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { emptyUsage, fromPiMessage, toPiMessage } from '../src/pi-messages.js'

/** Test-only bridge: both engines receive the exact same scripted responses. */
export function scriptedPiModel(adapter: ModelAdapter): PiModelAdapter {
  const model: PiModelAdapter['model'] = { id: adapter.id, name: adapter.id, api: 'openai-responses', provider: 'test', baseUrl: '', reasoning: false, input: ['text', 'image'], contextWindow: 0, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  return {
    id: adapter.id,
    model,
    stream: (_model, context, options) => {
      const stream = createAssistantMessageEventStream()
      void (async () => {
        const message = toPiMessage({ role: 'assistant', text: '' }, model)
        if (message.role !== 'assistant') {
          throw new Error('Invalid fixture')
        }
        message.usage = emptyUsage()
        stream.push({ type: 'start', partial: structuredClone(message) })
        try {
          for await (const chunk of adapter.stream({ system: context.systemPrompt ?? '', messages: context.messages.map(fromPiMessage), tools: (context.tools ?? []).map(tool => ({ name: tool.name, description: tool.description, schema: tool.parameters as unknown as Record<string, unknown> })), signal: options?.signal ?? new AbortController().signal })) {
            if (chunk.type === 'text') {
              const index = message.content.length
              message.content.push({ type: 'text', text: chunk.text })
              stream.push({ type: 'text_delta', contentIndex: index, delta: chunk.text, partial: structuredClone(message) })
            }
            if (chunk.type === 'call') {
              message.content.push({ type: 'toolCall', id: chunk.call.id, name: chunk.call.name, arguments: chunk.call.input as Record<string, unknown> })
            }
            if (chunk.type === 'usage') {
              message.usage = { ...emptyUsage(), input: chunk.inputTokens, output: chunk.outputTokens, totalTokens: chunk.inputTokens + chunk.outputTokens }
            }
          }
          message.stopReason = message.content.some(c => c.type === 'toolCall') ? 'toolUse' : 'stop'
          stream.push({ type: 'done', reason: message.stopReason, message })
        }
        catch (error) {
          message.stopReason = options?.signal?.aborted ? 'aborted' : 'error'
          message.errorMessage = error instanceof Error ? error.message : String(error)
          stream.push({ type: 'error', reason: message.stopReason, error: message })
        }
      })()
      return stream
    },
  }
}
