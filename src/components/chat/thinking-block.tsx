import { useTranslation } from 'react-i18next'
import { ChevronDown, Comment } from '@gravity-ui/icons'
import { TextShimmer } from '@heroui-pro/react/text-shimmer'
import { BubbleFoldBadge } from '@/components/ui/bubble-keyboard'
import { usePanelExpansion } from '@/hooks/use-panel-expansion'
import { cn } from '@/lib/utils'
import { MarkdownContent } from './markdown-content'

/**
 * A reasoning summary arrives as parts — each a bold title over a paragraph —
 * and rows written before the parts were separated on the way in hold them
 * run together: `**one****two**`. Two closing stars against two opening ones
 * never occur in prose, so the seam is unambiguous and is reopened here.
 */
export function separateSummaryParts(text: string): string {
  return text.replace(/\*\*\*\*/g, '**\n\n**')
}

/**
 * What a reasoning block is made of: the titles of its parts, and whether any
 * part has a body under its title.
 *
 * The Responses API's summaries come as `**Title**\n\nbody` parts, and at the
 * `concise` setting — or for a short thought — the body is absent and the
 * whole summary is one or more titles. That is a status line, not a document:
 * "Checking available references" says what the model is doing and is worth
 * showing as it happens, while a page of reasoning is worth folding.
 */
export interface ThinkingShape {
  titles: string[]
  hasProse: boolean
}

const TITLE_LINE = /^\*\*([^*\n]+)\*\*$/

export function shapeOfThinking(text: string): ThinkingShape {
  const titles: string[] = []
  let hasProse = false
  for (const raw of separateSummaryParts(text).split(/\n\s*\n/)) {
    const paragraph = raw.trim()
    if (!paragraph) continue
    const title = TITLE_LINE.exec(paragraph)
    if (title) titles.push(title[1].trim())
    else hasProse = true
  }
  return { titles, hasProse }
}

/**
 * The reasoning behind a bubble, at its head — above the prose it led to.
 *
 * It used to be a key on the keyboard under the bubble, beside the calls.
 * That put the thinking *after* the answer it produced, and a row that never
 * reached prose drew a keyboard with a "Thinking" key and nothing above it.
 *
 * Two shapes, decided by `shapeOfThinking`. A summary that is only titles is
 * drawn as those titles, always visible, in the muted size — the last one
 * shimmering while the thought is still arriving. Anything with a body is a
 * badge in the top-left corner, where the "ran 1 command" badges sit at the
 * bubble's foot, opening the whole thought inline as small muted Markdown:
 * open while it streams (the only sign of life at that point), shut once the
 * answer starts, unless the reader opened it themselves. One panel per bubble
 * rather than one per reasoning block, because "what was it thinking" is one
 * question.
 */
export function ThinkingRow({
  text,
  panelKey,
  isStreaming = false,
}: {
  text: string
  /** Stable across renders and across the post-turn reload, which re-keys the
   *  rows: a bubble's own key, which is derived from the row id. */
  panelKey: string
  isStreaming?: boolean
}) {
  const shape = shapeOfThinking(text)
  if (!shape.hasProse) {
    return shape.titles.length > 0 ? <ThinkingTitles titles={shape.titles} isStreaming={isStreaming} /> : null
  }
  return <ThinkingFold text={text} panelKey={panelKey} isStreaming={isStreaming} />
}

function ThinkingTitles({ titles, isStreaming }: { titles: string[]; isStreaming: boolean }) {
  return (
    <div
      data-slot="bubble-thinking"
      data-shape="titles"
      className="mb-1.5 flex min-w-0 flex-col gap-0.5 text-xs text-muted"
    >
      {titles.map((title, i) => {
        const live = isStreaming && i === titles.length - 1
        return (
          <div key={`${i}:${title}`} data-slot="bubble-thinking-title" className="flex min-w-0 items-center gap-1">
            {i === 0 ? (
              <Comment aria-hidden className="size-3 shrink-0" />
            ) : (
              <span data-slot="bubble-thinking-title-indent" aria-hidden className="size-3 shrink-0" />
            )}
            {live ? (
              <TextShimmer className="min-w-0 truncate">{title}</TextShimmer>
            ) : (
              <span data-slot="bubble-thinking-title-text" className="min-w-0 truncate">
                {title}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ThinkingFold({ text, panelKey, isStreaming }: { text: string; panelKey: string; isStreaming: boolean }) {
  const { t } = useTranslation()
  const { isExpanded, onExpandedChange } = usePanelExpansion(panelKey, isStreaming, false)
  const panelId = `thinking-${panelKey.replace(/[^\w-]/g, '_')}`
  return (
    <div data-slot="bubble-thinking" data-shape="fold" className="mb-1.5 flex min-w-0 flex-col gap-1.5">
      <div data-slot="bubble-thinking-row" className="flex min-w-0 items-center">
        <BubbleFoldBadge
          expanded={isExpanded}
          aria-controls={isExpanded ? panelId : undefined}
          onClick={() => onExpandedChange(!isExpanded)}
        >
          <Comment aria-hidden className="size-3" />
          <span data-slot="thinking-label" className={cn(isStreaming && 'shimmer')}>
            {t('chat.thinking')}
          </span>
          <ChevronDown aria-hidden className={cn('size-3 transition-transform', isExpanded && 'rotate-180')} />
        </BubbleFoldBadge>
      </div>
      {isExpanded && (
        <div id={panelId} data-slot="bubble-thinking-panel">
          <MarkdownContent
            content={separateSummaryParts(text)}
            isStreaming={isStreaming}
            allowRemoteImages={false}
            blockId={panelKey}
            // Smaller and quieter than the answer under it, so the two read
            // as different things; a part's title is a heading of the thought,
            // not of the reply.
            className="text-xs text-muted [&_strong]:font-medium"
          />
        </div>
      )}
    </div>
  )
}
