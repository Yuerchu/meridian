import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error-boundary'
import { AssistantGroupView, UserMessage } from './message-item'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { MessageScrollerAnchor } from '@/components/ui/message-scroller'
import { TurnBranchPager, TurnStatusIcon } from '@/components/ui/turn-status'
import { useHeightCompensation } from '@/hooks/use-height-compensation'
import { isDifferentDay, useDateLabel } from '@/hooks/use-clock-time'
import { useConversationStore } from '@/stores/conversation-store'
import { answerAnchorId, turnStartedAt, type Turn } from '@/lib/turns'
import { awaitingModel, buildAssistantGroups, groupsPlainText, type BubblePosition } from '@/lib/message-groups'
import type { EmojiMap } from './emoji-renderer'
import type { SenderNames } from '@/hooks/use-sender-names'
import type { MessageRating } from '@/types'

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
  onRate?: (id: string, rating: MessageRating | null) => void
  isOneBot?: boolean
  /** A hosted Claude Code session: the assistant answering is not this app's. */
  isHosted?: boolean
  emojiMap?: EmojiMap
  /** Nicknames for the ids on user rows. Only a group has more than one. */
  senderNames?: SenderNames
  assistantAvatar?: string | null
  /** When the turn before this one ended, whether or not it is on screen —
   *  the transcript's window may have left it unrendered, and a day that
   *  passed between two turns passed either way. Null for the first. */
  previousTurnEndedAt?: number | null
  /** Where the question sits in a run of unanswered questions — see
   *  `questionPositionOf`. Decides its corners, and whether it closes up to
   *  the question before it. */
  questionPosition?: BubblePosition
  className?: string
}

/**
 * One user message and everything the agent produced answering it.
 *
 * A whole turn is a single scroller item, which is what makes a panel closing
 * inside it safe: the scroller re-anchors off the item's `offsetTop`, and an
 * element shrinking internally does not move its own top. The question stays
 * where it is while the answer settles under it.
 */
export const TurnItem = React.memo(function TurnItem({
  turn,
  conversationId,
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
  previousTurnEndedAt = null,
  questionPosition = 'single',
  className,
}: TurnItemProps) {
  const { t } = useTranslation()
  const dateLabel = useDateLabel()
  const assistants = turn.assistantMessages
  const renderError = (
    <div data-slot="turn-render-error" className="text-xs text-danger py-2">
      {t('chat.renderError')}
    </div>
  )

  // The turn's actions belong to whichever row carries its conclusion. A turn
  // that was cut short has no conclusion, so they fall to the last row — leaving
  // an interrupted turn with no way to delete or retry it would be worse than
  // hanging them off a tool call.
  const owner =
    (turn.result && assistants.find((m) => m.id === turn.result?.messageId)) ??
    assistants[assistants.length - 1] ??
    null

  // Deleting anywhere in a turn removes the turn. The backend takes the whole
  // subtree, so aiming at the question rather than the clicked row is what makes
  // the button mean "drop this exchange" rather than "drop the tail of it". A
  // headless turn has no question, so its first answer is the root.
  //
  // Memoised because a fresh closure per render would defeat the group's
  // React.memo, and left undefined when the action is unavailable so the button
  // does not render at all.
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

  // Only the streaming turn can be the one being retried, and it is the last
  // one — the same turn `buildTurns` gave the streaming status to.
  const retry = useConversationStore((s) => s.sessions[conversationId]?.retry ?? null)

  const groups = useMemo(() => buildAssistantGroups(turn, { oneBot: isOneBot }), [turn, isOneBot])
  const copyText = useMemo(() => groupsPlainText(groups), [groups])

  // Panels close on their own as their tools finish. In a turn the reader has
  // scrolled past, that would pull the transcript up under them.
  const heightRef = useHeightCompensation<HTMLDivElement>()

  const startedAt = turnStartedAt(turn)
  const showDate = startedAt != null && (previousTurnEndedAt == null || isDifferentDay(previousTurnEndedAt, startedAt))

  // A question continuing a run of questions closes up to the one before it:
  // the tight corner only reads as "the same speaker, continued" when the two
  // nearly touch, and the six-unit rhythm between turns is a paragraph break.
  // Not past a date separator, which is a break of its own.
  const continuesRun = (questionPosition === 'middle' || questionPosition === 'last') && !showDate
  const question = turn.userMessage && (
    <div data-slot="turn-question" className={cn(continuesRun && '-mt-5')}>
      <ErrorBoundary fallback={renderError}>
        <UserMessage
          message={turn.userMessage}
          position={questionPosition}
          onDelete={onDeleteTurn}
          onEdit={!streaming ? onEdit : undefined}
          isOneBot={isOneBot}
          emojiMap={emojiMap}
          senderNames={senderNames}
        />
      </ErrorBoundary>
    </div>
  )

  // Outside the group's footer on purpose: that fades in on hover, and a pager
  // carries information rather than an action, so it has to stay legible at
  // rest. Negative margins pull it back against the message it belongs to, out
  // of the turn's own six-unit rhythm — it reads as part of that message, not
  // as another block in the exchange.
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
  // viewport moves: the answer has not started, and the reader has long since
  // scrolled past whatever was working. Approving a call lands exactly here —
  // the decision row resolves and the screen goes still, leaving the stop
  // button as the only sign the turn is alive. `buildAssistantGroups` ends the
  // run on a `working` bubble then — the typing indicator, where the answer
  // will appear — and this is what it says.
  const awaiting = awaitingModel(turn)
  const workingLabel = awaiting
    ? retry
      ? t('chat.turn.retrying', { attempt: retry.attempt, max: retry.max })
      : t(workingKey(turn.id))
    : null

  // How the turn ended, when that is worth a line of its own. A finished turn
  // says nothing — the answer is the statement — and a turn waiting on the
  // user is announced by the key that is waiting. A stopped one says so,
  // because without it a sentence that was cut off is a sentence that simply
  // stops; and a crashed one says so in warning colour, since it may have
  // left something half-done that nothing on screen accounts for.
  const statusLine =
    turn.status === 'crashed' || turn.status === 'interrupted' ? (
      <Marker data-slot="turn-status" data-status={turn.status} role="status" className="pl-10 text-xs">
        <MarkerIcon>
          <TurnStatusIcon status={turn.status} />
        </MarkerIcon>
        <MarkerContent className={cn(turn.status === 'crashed' && 'text-warning-soft-foreground')}>
          {t(turn.status === 'crashed' ? 'chat.turn.crashed' : 'chat.turn.interrupted')}
        </MarkerContent>
      </Marker>
    ) : null

  return (
    <div ref={heightRef} data-slot="turn" data-status={turn.status} className={cn('space-y-6', className)}>
      {showDate && (
        <Marker variant="separator" data-slot="turn-date" className="text-xs">
          <MarkerContent>{dateLabel(startedAt)}</MarkerContent>
        </Marker>
      )}
      {question}
      {questionPager}
      {/* The answer has its own anchor so the scroller can put the reader back
          at the start of it when the stream ends. The runs inside it sit at a
          message's internal rhythm, closer than the six-unit gap the turn keeps
          between the question and the answer as a whole. */}
      <MessageScrollerAnchor messageId={answerAnchorId(turn.id)} className="space-y-3">
        {groups.map((group, i) => (
          <ErrorBoundary key={group.id} fallback={renderError}>
            <AssistantGroupView
              group={group}
              turn={turn}
              owner={owner}
              copyText={copyText}
              showFooter={i === groups.length - 1 && !awaiting}
              workingLabel={i === groups.length - 1 ? workingLabel : null}
              onDelete={onDeleteTurn}
              onRegenerate={onRegenerateTurn}
              onRate={onRate}
              isOneBot={isOneBot}
              isHosted={isHosted}
              emojiMap={emojiMap}
              assistantAvatar={assistantAvatar}
            />
          </ErrorBoundary>
        ))}
        {statusLine}
      </MessageScrollerAnchor>
      {answerPager}
    </div>
  )
})
