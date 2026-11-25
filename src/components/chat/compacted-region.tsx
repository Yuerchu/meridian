import './compacted-region.css'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Bubble, BubbleContent } from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
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
    <MessageScrollerItem messageId="__compact-region" className="m-compacted-region">
      {showCompactedMessages ? (
        <>
          <div className="m-compacted-region__fold">
            <Button variant="secondary" aria-expanded={true} onPress={() => setShowCompactedMessages(false)}>
              {t('chat.compact.hideCompacted', { count: compactedCount })}
            </Button>
          </div>
          {turns.map((turn, i) => (
            <div key={turn.id} data-slot="compacted-turn" className="m-compacted-region__turn">
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
        <div className="m-compacted-region__fold">
          <Button variant="secondary" aria-expanded={false} onPress={() => setShowCompactedMessages(true)}>
            {t('chat.compact.showCompacted', { count: compactedCount })}
          </Button>
        </div>
      )}
      <Marker variant="separator" className="m-compacted-region__marker">
        <MarkerContent>
          {/* The only way to open the summary of what was compacted away. */}
          <Button
            data-slot="compact-boundary-toggle"
            variant="ghost"
            size="sm"
            aria-expanded={showCompactSummary}
            onPress={() => setShowCompactSummary((v) => !v)}
          >
            {t('chat.compact.boundary', { count: compactedCount })}
          </Button>
        </MarkerContent>
      </Marker>
      {compactSummary && showCompactSummary && (
        <Bubble variant="muted" data-slot="compact-summary" className="m-compacted-region__summary">
          <BubbleContent className="m-compacted-region__summary-content">{compactSummary.content}</BubbleContent>
        </Bubble>
      )}
    </MessageScrollerItem>
  )
}
