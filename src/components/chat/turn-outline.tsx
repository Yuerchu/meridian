import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FloatingToc } from '@/components/base'

import { useMessageScroller, useMessageScrollerVisibility } from '@/components/ui/message-scroller'
import type { Turn } from '@/lib/turns'

/**
 * Below this it is not worth the gutter: a handful of turns is one scroll.
 */
const MIN_TURNS = 4

/** Long enough to tell two questions apart, short enough not to widen the
 *  popover into the transcript. The item itself is `white-space: nowrap`. */
const LABEL_CHARS = 60

/** The stored user body may be a multimodal parts array. Outline labels name
 * the visible question, never the JSON envelope or a local asset URL. */
function visibleQuestion(content: string): string {
  if (!content.startsWith('[')) return content
  try {
    const parsed: unknown = JSON.parse(content)
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every(
        (part) => typeof part === 'object' && part !== null && typeof (part as { type?: unknown }).type === 'string',
      )
    ) {
      return content
    }
    return parsed
      .flatMap((part) => {
        const item = part as {
          type: string
          text?: string
          name?: string
          file?: { name?: string }
        }
        if (item.type === 'text') return item.text ?? ''
        if (item.type === 'file') return item.file?.name ?? ''
        if (item.type === 'sticker') return item.name ?? ''
        return ''
      })
      .filter(Boolean)
      .join(' ')
  } catch {
    return content
  }
}

/**
 * What a turn is called in the outline: the question that opened it.
 *
 * `Array.from` rather than `slice`, so a cut never lands in the middle of a
 * surrogate pair — an emoji or a rarer CJK character would otherwise be
 * truncated into a replacement glyph.
 */
function label(content: string): string {
  const line =
    content
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  const chars = Array.from(line.replace(/\s+/g, ' '))
  return chars.length > LABEL_CHARS ? `${chars.slice(0, LABEL_CHARS).join('')}…` : chars.join('')
}

/**
 * A minimap of the conversation, for finding a message you remember having.
 *
 * Turns, not headings. A table of contents built from the `#` in one long
 * answer would need the block index of every heading, which Pro's markdown
 * renderer makes unavailable — it renders each top-level block as its own
 * isolated `ReactMarkdown`, so there is no shared counter to mint stable ids
 * from. Indexing by turn needs none of that: the transcript already registers
 * every turn with the scroller under `turn.id`, so this is a list of ids the
 * scroller can already jump to.
 *
 * Both halves are the scroller's own answers, not a second observer:
 * `currentAnchorId` is the turn at the reading line, and `scrollToMessage` is
 * the one way to move — going around it with `scrollIntoView` would fight the
 * follow/idle policy that the whole of `lib/message-scroller.tsx` exists to
 * hold. Jumping puts the scroller in `idle`, so a running answer will not drag
 * the reader back; the button in the corner re-arms following.
 *
 * Only turns with a question of their own are listed, which is also exactly the
 * set the scroller anchors — a turn that is not an anchor can never be
 * `currentAnchorId`, so listing it would give a row that never lights up.
 */
export function TurnOutline({ turns }: { turns: Turn[] }) {
  const { t } = useTranslation()
  const { currentAnchorId } = useMessageScrollerVisibility()
  const { scrollToMessage } = useMessageScroller()

  const entries = useMemo(
    () =>
      turns
        .filter((turn) => turn.userMessage !== null)
        .map((turn) => ({
          id: turn.id,
          text: label(visibleQuestion(turn.userMessage?.content ?? '')),
        })),
    [turns],
  )

  if (entries.length < MIN_TURNS) return null

  return (
    // Hidden where the transcript already fills the width: below `md` this
    // would sit on top of the text rather than beside it.
    <div
      data-slot="turn-outline"
      className="pointer-events-none absolute inset-y-0 end-0 z-10 hidden items-center pe-1 md:flex"
    >
      <FloatingToc placement="right">
        {/* The strip scrolls rather than growing without bound — a hundred-turn
            conversation is taller than the window. Pro's own `Bar` calls
            `scrollIntoView({ block: 'nearest' })` when it becomes active, which
            only does anything if something here can scroll, so this is the
            shape that component was written for. */}
        <FloatingToc.Trigger
          aria-label={t('chat.outline.title')}
          className="pointer-events-auto max-h-[60vh] overflow-y-auto no-scrollbar"
        >
          {entries.map((entry) => (
            <FloatingToc.Bar key={entry.id} active={entry.id === currentAnchorId} />
          ))}
        </FloatingToc.Trigger>
        <FloatingToc.Content>
          {entries.map((entry) => (
            <FloatingToc.Item
              key={entry.id}
              active={entry.id === currentAnchorId}
              // `nowrap` with no width of its own: without a bound, one long
              // question stretches the popover across the transcript.
              className="max-w-72 overflow-hidden text-ellipsis"
              onClick={() => scrollToMessage(entry.id, { align: 'start' })}
            >
              {entry.text || t('chat.outline.untitled')}
            </FloatingToc.Item>
          ))}
        </FloatingToc.Content>
      </FloatingToc>
    </div>
  )
}
