import { useTranslation } from 'react-i18next'
import { Comment } from '@gravity-ui/icons'
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
 * The reasoning behind a bubble: a badge in its top-left corner, opening the
 * thought inline above the prose it led to.
 *
 * It used to be a key on the keyboard under the bubble, beside the calls.
 * That put the thinking *after* the answer it produced, and a row that never
 * reached prose drew a keyboard with a "Thinking" key and nothing above it.
 * The badge sits where the "ran 1 command" badges sit at the bubble's foot,
 * and reads in the order things happened.
 *
 * One panel per bubble rather than one per reasoning block: the model may
 * think several times on the way to one answer, and what the reader wants is
 * "what was it thinking", not a stack of badges. Open while the thought is
 * still arriving — it is the only sign of life at that point — and shut once
 * the answer starts, unless the reader opened it themselves.
 *
 * The text is Markdown, not plain: a Responses-API summary is a bold title
 * over a paragraph, and drawn raw it is a line of asterisks.
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
  const { t } = useTranslation()
  const { isExpanded, onExpandedChange } = usePanelExpansion(panelKey, isStreaming, false)
  const panelId = `thinking-${panelKey.replace(/[^\w-]/g, '_')}`
  return (
    <div data-slot="bubble-thinking" className="mb-1.5 flex min-w-0 flex-col gap-1.5">
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
        </BubbleFoldBadge>
      </div>
      {isExpanded && (
        <div id={panelId} data-slot="bubble-thinking-panel" className="text-xs leading-relaxed text-muted">
          <MarkdownContent
            content={separateSummaryParts(text)}
            isStreaming={isStreaming}
            allowRemoteImages={false}
            blockId={panelKey}
          />
        </div>
      )}
    </div>
  )
}
