import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { TurnItem } from './turn-item'
import type { EmojiMap } from './emoji-renderer'
import type { SenderNames } from '@/hooks/use-sender-names'
import type { Turn } from '@/lib/turns'
import type { MessageViewModel } from '@/types'

export interface CompactedRegionProps {
  /** Turns that fall before the compaction boundary. Empty means nothing to show. */
  turns: Turn[]
  conversationId: string
  /** Messages behind those turns — what the "N messages" counters name. */
  compactedCount: number
  compactSummary?: MessageViewModel
  onDelete?: (id: string) => void
  isOneBot?: boolean
  emojiMap?: EmojiMap
  senderNames?: SenderNames
  assistantAvatar?: string | null
}

/**
 * The folded-away head of a compacted conversation, plus the marker where the
 * summary takes over.
 *
 * Both disclosures keep their state here rather than in the chat view: they
 * change nothing outside this block, and hoisting them would re-render the
 * whole transcript to open a fold.
 */
export function CompactedRegion({
  turns,
  conversationId,
  compactedCount,
  compactSummary,
  onDelete,
  isOneBot,
  emojiMap,
  senderNames,
  assistantAvatar,
}: CompactedRegionProps) {
  const { t } = useTranslation()
  const [showCompactedMessages, setShowCompactedMessages] = useState(false)
  const [showCompactSummary, setShowCompactSummary] = useState(false)

  if (turns.length === 0) return null

  return (
    <MessageScrollerItem messageId="__compact-region" className="space-y-6">
      {showCompactedMessages ? (
        <>
          <Button
            variant="ghost"
            onClick={() => setShowCompactedMessages(false)}
            className="w-full h-auto rounded-lg text-center text-xs text-muted hover:text-muted py-2"
          >
            {t('chat.compact.hideCompacted', { count: compactedCount })}
          </Button>
          {turns.map((turn) => (
            <div key={turn.id} className="opacity-40">
              <TurnItem
                turn={turn}
                conversationId={conversationId}
                onDelete={onDelete}
                isOneBot={isOneBot}
                emojiMap={emojiMap}
                senderNames={senderNames}
                assistantAvatar={assistantAvatar}
              />
            </div>
          ))}
        </>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setShowCompactedMessages(true)}
          className="w-full h-auto rounded-lg text-center text-xs text-muted hover:text-muted py-2"
        >
          {t('chat.compact.showCompacted', { count: compactedCount })}
        </Button>
      )}
      <Marker variant="separator" className="py-3 px-2">
        <MarkerContent>
          {/* `h-auto py-0` leaves this about 18px tall, and it is the only way
              to open the summary of what was compacted away. */}
          <Button
            variant="ghost"
            onClick={() => setShowCompactSummary((v) => !v)}
            className="touch-hitbox text-xs text-muted hover:text-muted whitespace-nowrap h-auto px-2 py-0"
          >
            {t('chat.compact.boundary', { count: compactedCount })}
          </Button>
        </MarkerContent>
      </Marker>
      {compactSummary && showCompactSummary && (
        <div className="px-4 py-2 mb-2 text-xs text-muted bg-default/30 rounded-lg border border-border whitespace-pre-wrap">
          {compactSummary.content}
        </div>
      )}
    </MessageScrollerItem>
  )
}
