import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'

import { useImeBottom } from '@/hooks/use-android-insets'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/ui/message-scroller'
import { TurnItem } from './turn-item'
import type { EmojiMap } from './emoji-renderer'
import { answerAnchorId, type Turn } from '@/lib/turns'

const MotionMessageScrollerItem = motion.create(MessageScrollerItem)

function ImeScrollSync() {
  const ime = useImeBottom()
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => { if (ime > 0) scrollToEnd() }, [ime, scrollToEnd])
  return null
}

/**
 * When a turn stops streaming, put the reader back at the top of the answer.
 *
 * Following the live edge is right while the answer is being written and wrong
 * the moment it stops: the reader was carried along at the model's pace, not
 * their own, and is left staring at the last line of something they have not
 * read. Only for a reader who was actually following — anyone who scrolled away
 * chose where to be, and the end of a turn is no reason to overrule that.
 *
 * `onlyWhenAbove` keeps a short answer still: there is nothing to go back to
 * when the whole thing is already on screen.
 */
function AnswerSettle({ streaming, anchorId }: { streaming: boolean; anchorId: string | null }) {
  const { isFollowing, scrollToMessage } = useMessageScroller()
  const wasStreaming = useRef(streaming)

  useEffect(() => {
    const justFinished = wasStreaming.current && !streaming
    wasStreaming.current = streaming
    if (!justFinished || !anchorId || !isFollowing()) return
    // Run now rather than a frame later. The reload that follows a turn lands
    // asynchronously and re-keys this row, which would re-run this effect and
    // cancel a deferred scroll before it ever happened.
    scrollToMessage(anchorId, { align: 'start', onlyWhenAbove: true })
  }, [streaming, anchorId, isFollowing, scrollToMessage])

  return null
}

export interface ChatTranscriptProps {
  turns: Turn[]
  conversationId: string
  streaming: boolean
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
  onEdit?: (id: string, content: string) => void
  onRate?: (id: string, rating: number | null) => void
  isOneBot?: boolean
  emojiMap?: EmojiMap
  assistantAvatar?: string | null
  /** Rows above the turns — the compacted region and its boundary marker. */
  leading?: React.ReactNode
  /** Rows below the turns — the compaction spinner and the turn's error. */
  trailing?: React.ReactNode
  /** Shown instead of the transcript when there is nothing in it yet. */
  emptyState?: React.ReactNode
  scrollToBottomLabel?: string
}

/**
 * The scrolling transcript: everything between the toolbar and the composer.
 *
 * Split out of `chat-view` so the scroll behaviour can be driven from the dev
 * playground with synthetic turns. Anything that changes how a turn is measured
 * or anchored has to be exercised against the real rows, not a stand-in.
 */
export function ChatTranscript({
  turns,
  conversationId,
  streaming,
  onDelete,
  onRegenerate,
  onEdit,
  onRate,
  isOneBot,
  emojiMap,
  assistantAvatar,
  leading,
  trailing,
  emptyState,
  scrollToBottomLabel,
}: ChatTranscriptProps) {
  const lastTurn = turns[turns.length - 1]

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={48}>
      <ImeScrollSync />
      <AnswerSettle streaming={streaming} anchorId={lastTurn ? answerAnchorId(lastTurn.id) : null} />
      <MessageScroller className="flex-1 min-h-0">
        <MessageScrollerViewport>
          <MessageScrollerContent className="max-w-4xl mx-auto px-4 py-6 pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]">
            {leading}
            {turns.map((turn, i) => {
              const isLastTurn = i === turns.length - 1
              const turnEl = (
                <TurnItem
                  turn={turn}
                  conversationId={conversationId}
                  isLastTurn={isLastTurn}
                  streaming={streaming}
                  onDelete={onDelete}
                  onRegenerate={onRegenerate}
                  onEdit={onEdit}
                  onRate={onRate}
                  isOneBot={isOneBot}
                  emojiMap={emojiMap}
                  assistantAvatar={assistantAvatar}
                />
              )
              // Turns hold many messages each, so the reveal animation covers fewer
              // items than the old per-message window did.
              if (i >= turns.length - 2) {
                return (
                  <MotionMessageScrollerItem
                    key={turn.id}
                    messageId={turn.id}
                    scrollAnchor={turn.userMessage != null}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {turnEl}
                  </MotionMessageScrollerItem>
                )
              }
              return (
                <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.userMessage != null}>
                  {turnEl}
                </MessageScrollerItem>
              )
            })}
            {trailing}
            {emptyState}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label={scrollToBottomLabel} />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
