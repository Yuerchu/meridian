import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error-boundary'
import { AssistantAvatar, MessageItem, MessageMeta } from './message-item'
import { TurnSteps } from './turn-steps'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { MessageScrollerAnchor } from '@/components/ui/message-scroller'
import {
  Turn as TurnCollapse,
  TurnBranchPager,
  TurnContent,
  TurnPinned,
  TurnStatusIcon,
  TurnTrigger,
} from '@/components/ui/turn'
import { useCollapseScrollAnchor } from '@/hooks/use-collapse-scroll-anchor'
import { useConversationStore } from '@/stores/conversation-store'
import { answerAnchorId, formatDuration, hasCollapsibleProcess, type Turn } from '@/lib/turns'
import type { EmojiMap } from './emoji-renderer'
import type { SenderNames } from '@/hooks/use-sender-names'

/** Long enough for `handleStop`'s reload to land first. Collapsing before it
 *  arrives would shrink the turn once, then reflow again when the snapshot
 *  replaces the rows — two jumps where there should be one. */
const COLLAPSE_DELAY_MS = 300

/** Ways of saying the model is still thinking. Which one a turn gets is decided
 *  by its id rather than at random: the wait can last a minute and re-render
 *  many times over, and a label that reshuffled underneath the user would read
 *  as new activity every time. */
const WORKING_KEYS = [
  'chat.turn.working.thinking',
  'chat.turn.working.pondering',
  'chat.turn.working.brewing',
  'chat.turn.working.deliberating',
  'chat.turn.working.plotting',
  'chat.turn.working.musing',
] as const

function workingKey(turnId: string): string {
  let hash = 0
  for (let i = 0; i < turnId.length; i++) {
    hash = (hash * 31 + turnId.charCodeAt(i)) | 0
  }
  return WORKING_KEYS[Math.abs(hash) % WORKING_KEYS.length]
}

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
  /** A hosted Claude Code session: the assistant answering is not this app's. */
  isHosted?: boolean
  emojiMap?: EmojiMap
  /** Nicknames for the ids on user rows. Only a group has more than one. */
  senderNames?: SenderNames
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
  isHosted,
  emojiMap,
  senderNames,
  assistantAvatar,
  className,
}: TurnItemProps) {
  const { t } = useTranslation()
  const assistants = turn.assistantMessages
  const renderError = <div className="text-xs text-danger py-2">{t('chat.renderError')}</div>

  // The turn's actions belong to whichever row carries its conclusion. A turn
  // that was cut short has no conclusion, so they fall to the last row — leaving
  // an interrupted turn with no way to delete or retry it would be worse than
  // hanging them off a tool call.
  const actionMessageId = turn.result?.messageId ?? assistants[assistants.length - 1]?.id

  // Deleting anywhere in a turn removes the turn. The backend takes the whole
  // subtree, so aiming at the question rather than the clicked row is what makes
  // the button mean "drop this exchange" rather than "drop the tail of it". A
  // headless turn has no question, so its first answer is the root.
  //
  // These callbacks ignore the id they are handed, so MessageItem keeps calling
  // `onDelete(message.id)` wherever it already does. Memoised because a fresh
  // closure per render would defeat its React.memo, and left undefined when the
  // action is unavailable so the button does not render at all.
  const deleteRootId = turn.userMessage?.id ?? assistants[0]?.id
  const deleteTurn = useCallback(() => {
    if (onDelete && deleteRootId) onDelete(deleteRootId)
  }, [onDelete, deleteRootId])
  const onDeleteTurn = onDelete && deleteRootId ? deleteTurn : undefined

  // Regeneration replaces the turn's first answer, whose parent is the question.
  // Naming the conclusion instead would fork under whatever step preceded it and
  // graft the new answer into the middle of the old turn.
  const regenerateRootId = assistants[0]?.id
  const regenerateTurn = useCallback(() => {
    if (onRegenerate && regenerateRootId) onRegenerate(regenerateRootId)
  }, [onRegenerate, regenerateRootId])
  const onRegenerateTurn = onRegenerate && regenerateRootId ? regenerateTurn : undefined

  const collapsible = hasCollapsibleProcess(turn)
  const isTurnStreaming = turn.status === 'streaming'

  // Two independent pagers. Regenerating forks below the question, so that
  // pager belongs to the answer; editing the question forks beside it, so that
  // one belongs to the bubble. Both can be present at once.
  const answerBranch = useConversationStore((s) =>
    assistants[0] ? s.sessions[conversationId]?.branches[assistants[0].id] : undefined,
  )
  const questionBranch = useConversationStore((s) =>
    turn.userMessage ? s.sessions[conversationId]?.branches[turn.userMessage.id] : undefined,
  )
  const switching = useConversationStore((s) => s.sessions[conversationId]?.switchingBranch ?? false)
  const switchBranch = useConversationStore((s) => s.switchBranch)

  const pagerFor = (branch: typeof answerBranch) => {
    if (!branch) return null
    const go = (delta: number) => {
      const target = branch.sibling_ids[branch.index + delta]
      if (target) switchBranch(conversationId, target)
    }
    return (
      <TurnBranchPager
        index={branch.index + 1}
        total={branch.total}
        onPrevious={() => go(-1)}
        onNext={() => go(1)}
        // Switching mid-stream would leave the running turn writing into a path
        // that is no longer on screen.
        isDisabled={switching || streaming}
        previousLabel={t('chat.turn.branchPrev')}
        nextLabel={t('chat.turn.branchNext')}
      />
    )
  }

  // Subscribed here rather than passed down: reading it in the parent would make
  // expanding one turn re-render the whole list.
  const userChoice = useConversationStore((s) => s.sessions[conversationId]?.expandedTurns[turn.id])
  const setTurnExpanded = useConversationStore((s) => s.setTurnExpanded)

  // A turn holds itself open while it runs, and while it is blocked on the user
  // — an approval buried behind a collapsed header cannot be answered. A turn
  // that stopped without ever reaching an ending holds itself open for the same
  // reason in reverse: what it was doing when it stopped is the only thing worth
  // reading about it, and collapsed it looks like nothing more than a short
  // answer.
  const forcedOpen = isTurnStreaming || turn.status === 'awaiting-input' || turn.status === 'crashed'
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

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && !isFullyVisible()) {
        setSuppressTransition(true)
        pendingCorrection.current = beginCollapse()
      }
      setAutoOpen(next)
      setTurnExpanded(conversationId, turn.id, next)
    },
    [beginCollapse, isFullyVisible, setTurnExpanded, conversationId, turn.id],
  )

  // Only the streaming turn can be the one being retried, and it is the last
  // one — the same turn `buildTurns` gave the streaming status to.
  const retry = useConversationStore((s) => s.sessions[conversationId]?.retry ?? null)

  const headline = isTurnStreaming
    ? retry
      ? t('chat.turn.retrying', { attempt: retry.attempt, max: retry.max })
      : t('chat.turn.processing')
    : turn.status === 'awaiting-input'
      ? t('chat.turn.awaitingInput')
      : // Distinct wording from `interrupted`, which is what the user gets when
        // they pressed Stop. Saying "stopped" about a turn nobody stopped is how
        // a half-written file goes unnoticed — and naming a cause would be worse
        // still, because there is no cause on record: everything that leaves a
        // turn without an ending arrives here looking the same.
        turn.status === 'crashed'
        ? t('chat.turn.crashed')
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
        senderNames={senderNames}
        assistantAvatar={assistantAvatar}
      />
    </ErrorBoundary>
  )

  // Outside MessageItem's footer on purpose: that fades in on hover, and a
  // pager carries information rather than an action, so it has to stay legible
  // at rest. Negative margins pull it back against the message it belongs to,
  // out of the turn's own six-unit rhythm — it reads as part of that message,
  // not as another block in the exchange.
  const questionPager = questionBranch && (
    <div data-slot="turn-question-pager" className="-mt-5 flex justify-end">
      {pagerFor(questionBranch)}
    </div>
  )
  const answerPager = answerBranch && (
    <div data-slot="turn-answer-pager" className="-mt-5 flex pl-10">
      {pagerFor(answerBranch)}
    </div>
  )

  // Between a tool returning and the model speaking again, nothing in the
  // viewport moves: the answer has not started, and the "processing" headline
  // is at the top of a turn the user has long since scrolled past. Approving a
  // call lands exactly here — the approval card resolves and the screen goes
  // still, leaving the stop button as the only sign the turn is alive. A tail
  // marker keeps that sign where the user is already looking.
  const tail = turn.steps[turn.steps.length - 1]
  const awaitingModel = isTurnStreaming && !turn.result && (!tail || tail.kind === 'tool')
  const activityMarker = awaitingModel && (
    <Marker role="status" className="pl-10">
      <MarkerContent className="shimmer text-xs">{t(workingKey(turn.id))}</MarkerContent>
    </Marker>
  )

  // Plain question-and-answer keeps the original layout. Wrapping a two-line
  // reply in "Worked for 3s ›" buries it behind a click for nothing.
  if (!collapsible) {
    return (
      <div data-slot="turn" data-status={turn.status} className={cn('space-y-6', className)}>
        {question}
        {questionPager}
        <MessageScrollerAnchor messageId={answerAnchorId(turn.id)} className="space-y-6">
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
                  onRegenerate={ownsActions ? onRegenerateTurn : undefined}
                  onRate={ownsActions ? onRate : undefined}
                  isOneBot={isOneBot}
                  emojiMap={emojiMap}
                  assistantAvatar={assistantAvatar}
                  isFirstInGroup={i === 0 || assistants[i - 1].model_id !== m.model_id}
                />
              </ErrorBoundary>
            )
          })}
          {activityMarker}
        </MessageScrollerAnchor>
        {answerPager}
      </div>
    )
  }

  const conclusionOwner = assistants.find((m) => m.id === actionMessageId)

  return (
    <div ref={collapseRef} data-slot="turn" data-status={turn.status} className={cn('space-y-6', className)}>
      {question}
      {questionPager}
      {/* The process line and the conclusion are one answer, so they sit at a
          message's internal rhythm rather than the six-unit gap the turn keeps
          between the question and the answer as a whole. */}
      <MessageScrollerAnchor messageId={answerAnchorId(turn.id)} className="space-y-2.5">
        <div className="flex w-full min-w-0 gap-2 text-sm">
          <AssistantAvatar src={assistantAvatar} modelId={assistants[0]?.model_id} hosted={isHosted} />
          <div className="flex w-full min-w-0 flex-col">
            {assistants[0] && <MessageMeta modelId={assistants[0].model_id} createdAt={assistants[0].created_at} />}
            <TurnCollapse status={turn.status} isExpanded={open} onExpandedChange={handleOpenChange}>
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
        {/* Skipped while the turn is still working towards one: that row would
            render an empty bubble and a footer whose only live action is copying
            nothing, leaving a gap between the last step and the marker below. */}
        {conclusionOwner && !awaitingModel && (
          <ErrorBoundary fallback={renderError}>
            <MessageItem
              message={conclusionOwner}
              // Only the conclusion renders as a message here, so it is the row the
              // stream is writing into whenever this turn is the live one.
              isStreaming={streaming && isLastTurn}
              isLastMessage={isLastTurn}
              // Avatar and attribution already sit above the collapsed region,
              // where the turn starts. This row only carries the conclusion.
              showAvatar={false}
              isFirstInGroup={false}
              showFooter
              tokenTotals={turn.tokens}
              onDelete={onDeleteTurn}
              onRegenerate={onRegenerateTurn}
              onRate={onRate}
              isOneBot={isOneBot}
              emojiMap={emojiMap}
              assistantAvatar={assistantAvatar}
              blocksOverride={turn.result?.blocks ?? []}
            />
          </ErrorBoundary>
        )}
        {activityMarker}
      </MessageScrollerAnchor>
      {answerPager}
    </div>
  )
})
