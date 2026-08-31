import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LazyMotion, domAnimation } from 'motion/react'
import * as m from 'motion/react-m'
import { Button } from '@heroui/react'

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
import { TurnOutline } from './turn-outline'
import { FilePreviewProvider } from './file-preview'
import type { EmojiMap } from './emoji-renderer'
import type { SenderNames } from '@/hooks/use-sender-names'
import { answerAnchorId, type Turn } from '@/lib/turns'

const TRANSCRIPT_WINDOW_TURNS = 40

// `m.create`, not `motion.create`: the full `motion` proxy drags every DOM
// feature into the bundle. The reveal below only tweens opacity and y, which
// `domAnimation` covers -- no layout projection, drag or gestures here.
const MotionMessageScrollerItem = m.create(MessageScrollerItem)

function ImeScrollSync() {
  const ime = useImeBottom()
  const { isFollowing, scrollToEnd } = useMessageScroller()
  useEffect(() => {
    // Resizing the viewport for the keyboard should keep a live transcript at
    // its edge, but opening a form or the composer while reading history is not
    // permission to discard the reader's position.
    if (ime > 0 && isFollowing()) scrollToEnd()
  }, [ime, isFollowing, scrollToEnd])
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
  /** A hosted Claude Code session: the assistant answering is not this app's. */
  isHosted?: boolean
  emojiMap?: EmojiMap
  /** Nicknames for the ids on user rows. Only a group has more than one. */
  senderNames?: SenderNames
  assistantAvatar?: string | null
  /** Rows above the turns — the compacted region and its boundary marker. */
  leading?: React.ReactNode
  /** Rows below the turns — the compaction spinner and the turn's error. */
  trailing?: React.ReactNode
  /** Shown instead of the transcript when there is nothing in it yet. */
  emptyState?: React.ReactNode
  scrollToBottomLabel?: string
}

type TranscriptTurnsProps = Omit<ChatTranscriptProps, 'leading' | 'trailing' | 'emptyState' | 'scrollToBottomLabel'>

function LoadEarlierTurns({
  remaining,
  oldFirstId,
  onLoad,
}: {
  remaining: number
  oldFirstId: string | undefined
  onLoad: () => void
}) {
  const { t } = useTranslation()
  const { scrollToMessage } = useMessageScroller()

  return (
    <div data-slot="transcript-load-earlier" className="flex justify-center py-1">
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          onLoad()
          if (oldFirstId) {
            requestAnimationFrame(() => {
              scrollToMessage(oldFirstId, { align: 'start', behavior: 'auto' })
              // The control disappears after the final chunk. Put keyboard and
              // screen-reader focus on the row that stayed in place instead of
              // letting it fall back to the document body.
              const oldFirstRow = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(
                (element) => element.dataset.messageId === oldFirstId,
              )
              oldFirstRow?.focus({ preventScroll: true })
            })
          }
        }}
      >
        {t('chat.transcript.loadEarlier', { count: remaining })}
      </Button>
    </div>
  )
}

/**
 * Keep the initial DOM bounded without relying on `content-visibility`, which
 * crashes desktop WebView2 under a long scrolling transcript. The first visible
 * id, rather than a count, is retained so appending a live turn never removes a
 * row that the reader may currently be using. Loading a chunk preserves the old
 * first row as the viewport anchor.
 */
function TranscriptTurns({
  turns,
  visibleStart,
  conversationId,
  streaming,
  onDelete,
  onRegenerate,
  onEdit,
  onRate,
  isOneBot,
  isHosted,
  emojiMap,
  senderNames,
  assistantAvatar,
}: TranscriptTurnsProps & { visibleStart: number }) {
  return (
    <>
      {turns.slice(visibleStart).map((turn, visibleIndex) => {
        const i = visibleStart + visibleIndex
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
            isHosted={isHosted}
            emojiMap={emojiMap}
            senderNames={senderNames}
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
              tabIndex={-1}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              {turnEl}
            </MotionMessageScrollerItem>
          )
        }
        return (
          <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.userMessage != null} tabIndex={-1}>
            {turnEl}
          </MessageScrollerItem>
        )
      })}
    </>
  )
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
  isHosted,
  emojiMap,
  senderNames,
  assistantAvatar,
  leading,
  trailing,
  emptyState,
  scrollToBottomLabel,
}: ChatTranscriptProps) {
  const lastTurn = turns[turns.length - 1]
  const [windowState, setWindowState] = useState<{ conversationId: string; firstVisibleId: string | null }>(() => ({
    conversationId,
    firstVisibleId: null,
  }))
  const rememberedId = windowState.conversationId === conversationId ? windowState.firstVisibleId : null
  const defaultStart = Math.max(0, turns.length - TRANSCRIPT_WINDOW_TURNS)
  const rememberedStart = rememberedId ? turns.findIndex((turn) => turn.id === rememberedId) : -1
  const visibleStart = rememberedStart >= 0 ? rememberedStart : defaultStart
  const visibleTurns = turns.slice(visibleStart)

  // The conversation can first render empty and hydrate with hundreds of
  // turns. Remember the bounded start after that load, and recover if a branch
  // switch removes the row that used to anchor this window.
  useEffect(() => {
    const firstVisibleId = turns[visibleStart]?.id ?? null
    setWindowState((current) => {
      if (current.conversationId === conversationId && current.firstVisibleId === firstVisibleId) return current
      return { conversationId, firstVisibleId }
    })
  }, [conversationId, turns, visibleStart])

  return (
    <FilePreviewProvider conversationId={conversationId}>
      <LazyMotion features={domAnimation}>
        <MessageScrollerProvider
          autoScroll
          defaultScrollPosition="last-anchor"
          // Count changes identify a genuinely new live turn, including queued
          // turns, while surviving the optimistic row's persisted-id re-key.
          // A non-streaming branch/history update must not re-arm follow.
          followKey={streaming ? turns.length : null}
          scrollPreviousItemPeek={48}
        >
          <ImeScrollSync />
          <AnswerSettle streaming={streaming} anchorId={lastTurn ? answerAnchorId(lastTurn.id) : null} />
          <MessageScroller className="flex-1 min-h-0">
            <MessageScrollerViewport>
              <MessageScrollerContent className="max-w-4xl mx-auto px-4 py-6 pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]">
                {leading}
                {visibleStart > 0 && (
                  <LoadEarlierTurns
                    remaining={visibleStart}
                    oldFirstId={turns[visibleStart]?.id}
                    onLoad={() => {
                      const nextStart = Math.max(0, visibleStart - TRANSCRIPT_WINDOW_TURNS)
                      setWindowState({ conversationId, firstVisibleId: turns[nextStart]?.id ?? null })
                    }}
                  />
                )}
                <TranscriptTurns
                  turns={turns}
                  visibleStart={visibleStart}
                  conversationId={conversationId}
                  streaming={streaming}
                  onDelete={onDelete}
                  onRegenerate={onRegenerate}
                  onEdit={onEdit}
                  onRate={onRate}
                  isOneBot={isOneBot}
                  isHosted={isHosted}
                  emojiMap={emojiMap}
                  senderNames={senderNames}
                  assistantAvatar={assistantAvatar}
                />
                {trailing}
                {emptyState}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton aria-label={scrollToBottomLabel} />
            {/* Inside the scroller, not beside it: it reads the reading line off
                the same context, and the root is already the positioned
                ancestor. */}
            <TurnOutline turns={visibleTurns} />
          </MessageScroller>
        </MessageScrollerProvider>
      </LazyMotion>
    </FilePreviewProvider>
  )
}
