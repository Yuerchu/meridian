import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Link } from '@/components/base'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { TurnItem } from './turn-item'
import type { EmojiMap } from './emoji-renderer'
import type { SenderNames } from '@/hooks/use-sender-names'
import { turnEndedAt, type Turn } from '@/lib/turns'
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
            onPress={() => setShowCompactedMessages(false)}
            className="w-full rounded-lg text-center text-xs text-text-secondary hover:text-text-secondary py-2"
          >
            {t('chat.compact.hideCompacted', { count: compactedCount })}
          </Button>
          {turns.map((turn, i) => (
            <div key={turn.id} data-slot="compacted-turn" className="opacity-40">
              <TurnItem
                turn={turn}
                conversationId={conversationId}
                previousTurnEndedAt={i > 0 ? turnEndedAt(turns[i - 1]) : null}
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
          onPress={() => setShowCompactedMessages(true)}
          className="w-full rounded-lg text-center text-xs text-text-secondary hover:text-text-secondary py-2"
        >
          {t('chat.compact.showCompacted', { count: compactedCount })}
        </Button>
      )}
      <Marker variant="separator" className="py-3 px-2">
        <MarkerContent>
          {/* About 18px tall, and it is the only way to open the summary of
              what was compacted away. */}
          <Link
            data-slot="compact-boundary-toggle"
            onPress={() => setShowCompactSummary((v) => !v)}
            className="touch-hitbox text-xs font-normal text-text-secondary whitespace-nowrap px-2"
          >
            {t('chat.compact.boundary', { count: compactedCount })}
          </Link>
        </MarkerContent>
      </Marker>
      {compactSummary && showCompactSummary && (
        <Bubble variant="muted" data-slot="compact-summary" className="mb-2 max-w-full">
          <BubbleContent className="text-xs whitespace-pre-wrap text-text-secondary">
            {compactSummary.content}
          </BubbleContent>
        </Bubble>
      )}
    </MessageScrollerItem>
  )
}
