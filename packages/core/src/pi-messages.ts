import type { Api, AssistantMessage, Model, Message as PiMessage, Usage } from '@earendil-works/pi-ai'
import type { Message, ToolResult } from './types.js'

export function assistantText(message: AssistantMessage): string {
  return message.content.filter(c => c.type === 'text').map(c => c.text).join('')
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

/** Detect secrets spanning provider text blocks before persisting native metadata. */
export function redactPiMessage(message: AssistantMessage, clean: (text: string) => string): AssistantMessage {
  const text = assistantText(message)
  const thinking = message.content.filter(c => c.type === 'thinking').map(c => c.thinking).join('')
  return {
    ...message,
    content: message.content.map((c) => {
      if (c.type === 'text' && clean(text) !== text) {
        return { ...c, text: '[REDACTED]' }
      }
      if (c.type === 'thinking' && clean(thinking) !== thinking) {
        return { ...c, thinking: '[REDACTED]' }
      }
      return c
    }),
  }
}

export function piToolResult(result: ToolResult) {
  return {
    content: [
      { type: 'text' as const, text: result.data === undefined ? result.text : `${result.text}\n${JSON.stringify(result.data)}` },
      ...(result.images ?? []).map(image => ({ type: 'image' as const, data: image.data, mimeType: image.mediaType })),
    ],
    details: { weappResult: result },
  }
}

export function toPiMessage(message: Message, model: Model<Api>): PiMessage {
  if (message.role === 'user') {
    return { role: 'user', content: [{ type: 'text', text: message.text }, ...(message.images ?? []).map(image => ({ type: 'image' as const, data: image.data, mimeType: image.mediaType }))], timestamp: 0 }
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: 0,
      usage: emptyUsage(),
      stopReason: message.calls?.length ? 'toolUse' : 'stop',
      content: [
        ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
        ...(message.calls ?? []).map(call => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: call.input as Record<string, unknown> })),
      ],
    }
  }
  return { role: 'toolResult', toolCallId: message.callId, toolName: message.name, ...piToolResult(message.result), isError: Boolean(message.error), timestamp: 0 }
}

export function fromPiMessage(message: PiMessage): Message {
  if (message.role === 'user') {
    const content = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content
    return { role: 'user', text: content.filter(c => c.type === 'text').map(c => c.text).join(''), images: content.filter(c => c.type === 'image').map(c => ({ type: 'image', data: c.data, mediaType: c.mimeType })) }
  }
  if (message.role === 'assistant') {
    return { role: 'assistant', text: assistantText(message), calls: message.content.filter(c => c.type === 'toolCall').map(c => ({ id: c.id, name: c.name, input: c.arguments })) }
  }
  const original = (message.details as { weappResult?: ToolResult } | undefined)?.weappResult
  return {
    role: 'tool',
    callId: message.toolCallId,
    name: message.toolName,
    error: message.isError,
    result: original ?? {
      text: message.content.filter(c => c.type === 'text').map(c => c.text).join('\n'),
      images: message.content.filter(c => c.type === 'image').map(c => ({ type: 'image', data: c.data, mediaType: c.mimeType })),
    },
  }
}
