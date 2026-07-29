import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error-boundary'
import { MessageItem } from './message-item'
import { TurnSteps } from './turn-steps'
import {
  Turn as TurnCollapse,
  TurnContent,
  TurnPinned,
  TurnStatusIcon,
  TurnTrigger,
} from '@/components/ui/turn'
import { useCollapseScrollAnchor } from '@/hooks/use-collapse-scroll-anchor'
import { useConversationStore } from '@/stores/conversation-store'
import { formatDuration, hasCollapsibleProcess, type Turn } from '@/lib/turns'
import type { EmojiMap } from './emoji-renderer'

/** Long enough for `handleStop`'s reload to land first. Collapsing before it
 *  arrives would shrink the turn once, then reflow again when the snapshot
 *  replaces the rows — two jumps where there should be one. */
const COLLAPSE_DELAY_MS = 300

export interface TurnItemProps {
  turn: Turn
  conversationId: string
  /** Drives the reveal animation and the expanded-by-default reasoning block. */
  isLastTurn?: boolean
  streaming?: boolean
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
  onEdit?: (id: string, content: string) => void
  onRate?: (id: string, rating: number | null) => void
  isOneBot?: boolean
  emojiMap?: EmojiMap
  assistantAvatar?: string | null
  className?: string
}

/**
 * One user message and everything the agent produced answering it.
 *
 * A whole turn is a single scroller item, which is what makes collapsing safe:
 * the scroller re-anchors off the item's `offsetTop`, and an element collapsing
 * internally does not move its own top. The question stays where it is while
 * the answer slides up into view.
 */
export const TurnItem = React.memo(function TurnItem({
  turn,
  conversationId,
  isLastTurn = false,
  streaming = false,
  onDelete,
  onRegenerate,
  onEdit,
  onRate,
  isOneBot,
  emojiMap,
  assistantAvatar,
  className,
}: TurnItemProps) {
  const { t } = useTranslation()
  const assistants = turn.assistantMessages
  const renderError = <div className="text-xs text-destructive py-2">{t('chat.renderError')}</div>

  // The turn's actions belong to whichever row carries its conclusion. A turn
  // that was cut short has no conclusion, so they fall to the last row — leaving
  // an interrupted turn with no way to delete or retry it would be worse than
  // hanging them off a tool call.
  const actionMessageId = turn.result?.messageId ?? assistants[assistants.length - 1]?.id

  // Deleting anywhere in a turn removes the turn. The backend takes the whole
  // subtree, so aiming at the question rather than the clicked row is what makes
  // the button mean "drop this exchange" rather than "drop the tail of it".
  // A headless turn has no question, so its first answer is the root.
  // Takes an id and ignores it, so MessageItem keeps calling
  // `onDelete(message.id)` wherever it already does. Memoised because a fresh
  // closure per render would defeat MessageItem's React.memo, and left undefined
  // when deletion is unavailable so the button does not render at all.
  const deleteRootId = turn.userMessage?.id ?? assistants[0]?.id
  const deleteTurn = useCallback(() => {
    if (onDelete && deleteRootId) onDelete(deleteRootId)
  }, [onDelete, deleteRootId])
  const onDeleteTurn = onDelete && deleteRootId ? deleteTurn : undefined

  const collapsible = hasCollapsibleProcess(turn)
  const isTurnStreaming = turn.status === 'streaming'

  // Subscribed here rather than passed down: reading it in the parent would make
  // expanding one turn re-render the whole list.
  const userChoice = useConversationStore(
    (s) => s.sessions[conversationId]?.expandedTurns[turn.id],
  )
  const setTurnExpanded = useConversationStore((s) => s.setTurnExpanded)

  // A turn holds itself open while it runs, and while it is blocked on the user
  // — an approval buried behind a collapsed header cannot be answered.
  const forcedOpen = isTurnStreaming || turn.status === 'awaiting-input'
  const [autoOpen, setAutoOpen] = useState(forcedOpen)
  const open = userChoice ?? (forcedOpen || autoOpen)

  const { ref: collapseRef, beginCollapse, isFullyVisible } = useCollapseScrollAnchor<HTMLDivElement>()
  const [suppressTransition, setSuppressTransition] = useState(false)
  const pendingCorrection = useRef<(() => void) | null>(null)

  const collapseWithCompensation = useCallback(() => {
    // Off-screen collapses skip the animation so the scroll correction can be
    // applied in the same layout pass; an animated one would land mid-flight.
    if (!isFullyVisible()) {
      setSuppressTransition(true)
      pendingCorrection.current = beginCollapse()
    }
    setAutoOpen(false)
  }, [beginCollapse, isFullyVisible])

  useLayoutEffect(() => {
    if (pendingCorrection.current && !open) {
      pendingCorrection.current()
      pendingCorrection.current = null
      setSuppressTransition(false)
    }
  }, [open])

  const wasStreaming = useRef(isTurnStreaming)
  useEffect(() => {
    const justFinished = wasStreaming.current && !isTurnStreaming
    wasStreaming.current = isTurnStreaming
    if (!justFinished || userChoice != null || !collapsible) return
    const timer = setTimeout(collapseWithCompensation, COLLAPSE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isTurnStreaming, userChoice, collapsible, collapseWithCompensation])

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next && !isFullyVisible()) {
      setSuppressTransition(true)
      pendingCorrection.current = beginCollapse()
    }
    setAutoOpen(next)
    setTurnExpanded(conversationId, turn.id, next)
  }, [beginCollapse, isFullyVisible, setTurnExpanded, conversationId, turn.id])

  const headline = isTurnStreaming
    ? t('chat.turn.processing')
    : turn.status === 'awaiting-input'
      ? t('chat.turn.awaitingInput')
      : turn.status === 'interrupted'
        ? t('chat.turn.interrupted')
        : turn.durationMs != null
          ? t('chat.turn.processed', { duration: formatDuration(turn.durationMs) })
          : t('chat.turn.steps', { count: turn.steps.length })

  const question = turn.userMessage && (
    <ErrorBoundary fallback={renderError}>
      <MessageItem
        message={turn.userMessage}
        isStreaming={false}
        isLastMessage={false}
        onDelete={onDeleteTurn}
        onEdit={!streaming ? onEdit : undefined}
        isOneBot={isOneBot}
        emojiMap={emojiMap}
        assistantAvatar={assistantAvatar}
      />
    </ErrorBoundary>
  )

  // Plain question-and-answer keeps the original layout. Wrapping a two-line
  // reply in "Worked for 3s ›" buries it behind a click for nothing.
  if (!collapsible) {
    return (
      <div data-slot="turn" data-status={turn.status} className={cn('space-y-6', className)}>
        {question}
        {assistants.map((m, i) => {
          const isLast = i === assistants.length - 1
          const ownsActions = m.id === actionMessageId
          return (
            <ErrorBoundary key={m.id} fallback={renderError}>
              <MessageItem
                message={m}
                isStreaming={streaming && isLastTurn && isLast}
                isLastMessage={isLastTurn && isLast}
                showFooter={ownsActions}
                tokenTotals={ownsActions ? turn.tokens : undefined}
                onDelete={ownsActions ? onDeleteTurn : undefined}
                onRegenerate={ownsActions ? onRegenerate : undefined}
                onRate={ownsActions ? onRate : undefined}
                isOneBot={isOneBot}
                emojiMap={emojiMap}
                assistantAvatar={assistantAvatar}
                isFirstInGroup={i === 0 || assistants[i - 1].model_id !== m.model_id}
                isLastInGroup={isLast || assistants[i + 1].model_id !== m.model_id}
              />
            </ErrorBoundary>
          )
        })}
      </div>
    )
  }

  const conclusionOwner = assistants.find((m) => m.id === actionMessageId)

  return (
    <div
      ref={collapseRef}
      data-slot="turn"
      data-status={turn.status}
      className={cn('space-y-6', className)}
    >
      {question}
      <div className="flex w-full min-w-0 gap-2 text-sm">
        <div className="min-w-8 shrink-0" />
        <div className="flex w-full min-w-0 flex-col">
          <TurnCollapse status={turn.status} open={open} onOpenChange={handleOpenChange}>
            <TurnTrigger>
              <span className="inline-flex items-center gap-1.5">
                <TurnStatusIcon />
                {headline}
              </span>
            </TurnTrigger>
            <TurnContent disableTransition={suppressTransition}>
              <TurnSteps steps={turn.steps} isOneBot={isOneBot} emojiMap={emojiMap} />
            </TurnContent>
            {turn.pinned.length > 0 && (
              <TurnPinned>
                <TurnSteps steps={turn.pinned} isOneBot={isOneBot} emojiMap={emojiMap} />
              </TurnPinned>
            )}
          </TurnCollapse>
        </div>
      </div>
      {conclusionOwner && (
        <ErrorBoundary fallback={renderError}>
          <MessageItem
            message={conclusionOwner}
            // Only the conclusion renders as a message here, so it is the row the
            // stream is writing into whenever this turn is the live one.
            isStreaming={streaming && isLastTurn}
            isLastMessage={isLastTurn}
            showFooter
            tokenTotals={turn.tokens}
            onDelete={onDeleteTurn}
            onRegenerate={onRegenerate}
            onRate={onRate}
            isOneBot={isOneBot}
            emojiMap={emojiMap}
            assistantAvatar={assistantAvatar}
            blocksOverride={turn.result?.blocks ?? []}
          />
        </ErrorBoundary>
      )}
    </div>
  )
})
