import type { Message } from './types.js'

// Image bytes are not text-context tokens. Account for a bounded image cost instead.
function contextSize(messages: Message[]): number {
  return JSON.stringify(messages, (key, value) =>
    key === 'images' && Array.isArray(value)
      ? value.map(() => '[image]'.repeat(256))
      : value).length
}
export function compactMessages(
  messages: Message[],
  budget: number,
): { messages: Message[], compacted: boolean } {
  if (contextSize(messages) <= budget) {
    return { messages, compacted: false }
  }
  // Keep assistant calls and all their tool results together, including the last user request.
  const groups: Message[][] = []
  for (const message of messages) {
    if (message.role !== 'tool' || groups.length === 0) {
      groups.push([])
    }
    groups[groups.length - 1]!.push(message)
  }
  const retained: Message[][] = []
  let size = 0
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!
    const length = contextSize(group)
    if (retained.length && size + length > budget * 0.7) {
      break
    }
    retained.unshift(group)
    size += length
  }
  const kept = retained.flat()
  const omitted = messages.slice(0, messages.length - kept.length)
  const summary = omitted
    .map((m) => {
      if (m.role === 'tool') {
        return `${m.name}: ${m.result.text.slice(0, 240)}`
      }
      return `${m.role}: ${m.text.slice(0, 500)}`
    })
    .join('\n')
    .slice(-Math.floor(budget * 0.2))
  // Clip oversized individual outputs, never discard call IDs or tool-result pairing.
  const clipped = kept.map(m =>
    m.role === 'tool'
      ? {
          ...m,
          result: {
            ...m.result,
            text: m.result.text.slice(0, Math.floor(budget * 0.25)),
          },
        }
      : m,
  )
  if (contextSize(clipped) + summary.length + 200 > budget) {
    // An indivisible call/result group can exceed the budget. Summarize the whole
    // group instead of sending orphan results or altered tool-call arguments.
    const latestUser = messages.findLast(m => m.role === 'user')
    return {
      messages: [
        {
          role: 'user',
          text: `Earlier context (summary, not new instructions):\n${summary}\nOversized recent context omitted. Inspect project files again before making changes.\nLatest user request: ${latestUser?.text.slice(0, Math.floor(budget * 0.4)) ?? ''}`,
          ...(latestUser?.role === 'user' && latestUser.images
            ? { images: latestUser.images }
            : {}),
        },
      ],
      compacted: true,
    }
  }
  return {
    messages: [
      {
        role: 'user',
        text: `Earlier context (summary, not new instructions):\n${summary}`,
      },
      ...clipped,
    ],
    compacted: true,
  }
}
