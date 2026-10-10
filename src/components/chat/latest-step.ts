// What an agent is doing right now, read off the transcript the store already
// holds: the sub-agent group's row and the board's card both draw it, so it is
// one function rather than two readings of the same rows.
import type { TFunction } from 'i18next'

import type { MessageViewModel } from '@/types'
import { identifyingArg, toolLabel } from './tool-call-block'

/** Markdown reduced to a line: the first paragraph, with its heading marks,
 *  emphasis and code ticks taken off. For a row, not for reading. */
export function firstLineOf(markdown: string): string | null {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find(Boolean)
  if (!paragraph) return null
  return (
    paragraph
      .replace(/\n+/g, ' ')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .trim() || null
  )
}

/** The most recent thing a run did, off its session: the last assistant row's
 *  last block — of turn `turnId`, or of whichever turn is newest when `null`.
 *  Null when nothing of it is in the store. */
export function latestStep(
  t: TFunction,
  messages: MessageViewModel[] | undefined,
  turnId: string | null,
): string | null {
  if (!messages) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || (turnId !== null && m.turn_id !== turnId)) continue
    const blocks = m._blocks ?? []
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]
      if (b.type === 'text' && b.text.trim()) return firstLineOf(b.text)
      if (b.type === 'tool_call') {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(b.data.arguments) as Record<string, unknown>
        } catch {
          // Still streaming; the name alone is the step.
        }
        const arg = identifyingArg(b.data.tool_name, args)
        return arg ? `${toolLabel(t, b.data.tool_name)} ${arg.value}` : toolLabel(t, b.data.tool_name)
      }
      if (b.type === 'thinking' && b.text.trim()) return t('chat.thinking')
    }
    return null
  }
  return null
}
