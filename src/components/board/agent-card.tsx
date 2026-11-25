// One card: collapsed to a status line, or open in place with everything
// needed to answer it. Nothing here opens an overlay — the point of the board
// is that every agent stays in view while you answer one.
import './agent-card.css'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as RacButton } from 'react-aria-components'
import { ArrowRight, ChevronDown, GitBranch, Message } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import type { ConfirmOptions } from '@/hooks/use-confirm'
import { TranscriptConversationProvider } from '@/hooks/use-transcript-conversation'
import { titleIfTruncated } from '@/lib/truncation'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import { useBoardStore } from '@/stores/board-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { BoardTaskInfoResponse, ToolCallDisplay } from '@/types'
import type { AgentState } from './agent-state'
import { ConversationComposer, StartComposer } from './card-composer'
import { InlineDecision } from './inline-decision'
import { StateIcon } from './state-icon'

/** What git said about the card's worktree: a branch, still detached
 *  (`name: null`), or nothing it could answer — a worktree git cannot read
 *  says nothing about a branch, and the card shows no badge rather than a
 *  "no branch yet" that would be a guess. */
type BranchReading = { kind: 'unread' } | { kind: 'read'; name: string | null } | { kind: 'unreadable' }

/** Asked again when the agent's state changes, which is when a branch could
 *  have appeared. */
function useWorktreeBranch(conversationId: string | null, hasWorktree: boolean, stateKind: AgentState['kind']) {
  const [branch, setBranch] = useState<BranchReading>({ kind: 'unread' })
  useEffect(() => {
    if (conversationId === null || !hasWorktree) return
    let cancelled = false
    api.workspace.getGitStatus({ conversation_id: conversationId }).then(
      (status) => {
        if (cancelled) return
        setBranch(status.state === 'ok' ? { kind: 'read', name: status.branch } : { kind: 'unreadable' })
      },
      () => {
        if (!cancelled) setBranch({ kind: 'unreadable' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [conversationId, hasWorktree, stateKind])
  return branch
}

/** The call a waiting question is about, as the transcript holds it: the real
 *  block carries what the queue entry does not (its diff, an escalation). */
function useWaitingCall(conversationId: string | null, item: AttentionItem | null): ToolCallDisplay | null {
  return useConversationStore((s) => {
    if (conversationId === null || item === null || item.kind === 'plan_review') return null
    const messages = s.sessions[conversationId]?.messages
    if (!messages) return null
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const block of messages[i]._blocks ?? []) {
        if (block.type === 'tool_call' && block.data.approval_id === item.approvalId) return block.data
      }
    }
    return null
  })
}

function StatusLine({ state }: { state: AgentState }) {
  const { t } = useTranslation()
  let label: string
  let detail: string | null = null
  switch (state.kind) {
    case 'idle':
      return null
    case 'working':
      label = t('board.state.working')
      detail = state.step
      break
    case 'approval':
      label = t('board.state.approval')
      break
    case 'question':
      label = t('board.state.question')
      break
    case 'failed':
      label = t('board.state.failed')
      detail = state.reason
      break
    case 'finished':
      label = state.stopped ? t('board.state.stopped') : t('board.state.finished')
      detail = state.summary
      break
  }
  return (
    <div
      data-slot="board-card-status"
      data-state={state.kind}
      data-stopped={state.kind === 'finished' && state.stopped ? true : undefined}
      className="m-board-card__status"
    >
      <span className="m-board-card__status-label">
        <StateIcon state={state} />
        {label}
      </span>
      {detail && (
        <span onPointerEnter={titleIfTruncated} className="m-board-card__status-detail">
          {detail}
        </span>
      )}
    </div>
  )
}

function reloadBoard() {
  return useBoardStore.getState().load()
}

/** After the card row is gone: reload the board, and if it had a conversation,
 *  refresh the sidebar and leave that transcript if it is open. `board-updated`
 *  only reloads cards; deleting the conversation does not announce itself. */
export async function settleAfterCardDeleted(conversationId: string | null) {
  await reloadBoard()
  if (conversationId === null) return
  await useConversationStore.getState().refreshConversations()
  if (useConversationStore.getState().activeId === conversationId) {
    useConversationStore.getState().setActiveId(null)
  }
}

export interface AgentCardProps {
  task: BoardTaskInfoResponse
  state: AgentState
  expanded: boolean
  focused: boolean
  onToggle: () => void
  onOpenConversation: (conversationId: string) => void
  onError: (error: string) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

export function AgentCard({
  task,
  state,
  expanded,
  focused,
  onToggle,
  onOpenConversation,
  onError,
  confirm,
}: AgentCardProps) {
  const { t } = useTranslation()
  const conversationId = task.conversation_id
  const waiting = state.kind === 'approval' || state.kind === 'question' ? state.item : null
  const call = useWaitingCall(conversationId, waiting)
  const branch = useWorktreeBranch(conversationId, task.worktree_path !== null, state.kind)
  const openReview = usePlanReviewStore((s) => s.openReview)
  const busy = state.kind === 'working' || state.kind === 'approval' || state.kind === 'question'
  const toReview = task.stage === 'running'
  const toDone = task.stage === 'review' && task.worktree_path === null
  const asking = waiting !== null
  const showToReview = toReview && !busy && conversationId !== null && (expanded || state.kind === 'finished')
  const showToDone = toDone && !busy && conversationId !== null && (expanded || state.kind === 'finished')
  const showRemoveWorktree =
    task.worktree_path !== null &&
    !busy &&
    (expanded || state.kind === 'finished' || task.stage === 'done' || task.stage === 'review')
  const showDelete = task.worktree_path === null && (expanded || task.conversation_id === null)

  const move = async (stage: 'review' | 'done') => {
    try {
      const { tasks } = useBoardStore.getState()
      await api.board.updateTask({
        id: task.id,
        position: { stage, index: tasks.filter((c) => c.stage === stage).length },
      })
    } catch (err) {
      onError(t('board.error.move', { error: String(err) }))
    }
  }

  const removeWorktree = async () => {
    try {
      await api.board.deleteTaskWorktree({ id: task.id })
      await reloadBoard()
    } catch (err) {
      onError(t('board.error.removeWorktree', { error: String(err) }))
    }
  }

  const removeCard = async () => {
    if (
      !(await confirm({
        description: t('board.card.deleteConfirm', { title: task.title }),
        confirmLabel: t('board.card.delete'),
        tone: 'danger',
      }))
    ) {
      return
    }
    try {
      await api.board.deleteTask({ id: task.id })
      await settleAfterCardDeleted(task.conversation_id)
    } catch (err) {
      onError(t('board.error.delete', { error: String(err) }))
    }
  }

  return (
    <article
      role="listitem"
      data-slot="board-card"
      data-card-id={task.id}
      data-state={state.kind}
      data-asking={asking || undefined}
      data-focused={focused || undefined}
      className="m-board-card"
    >
      <RacButton
        aria-expanded={expanded}
        aria-label={
          expanded ? t('board.card.collapse', { title: task.title }) : t('board.card.expand', { title: task.title })
        }
        onPress={onToggle}
        className="m-board-card__header"
      >
        <span className="m-board-card__title-row">
          <span className="m-board-card__title">{task.title}</span>
          <ChevronDown aria-hidden className="m-board-card__chevron" />
        </span>
        {(task.agent_kind !== null || branch.kind === 'read') && (
          <span className="m-board-card__meta">
            {task.agent_kind !== null && (
              <Badge size="sm">
                {task.agent_kind === 'claude_code' ? t('board.agent.claudeCode') : t('board.agent.native')}
              </Badge>
            )}
            {branch.kind === 'read' && (
              <span className="m-board-card__branch">
                <GitBranch aria-hidden className="m-board-card__branch-icon" />
                {branch.name !== null ? (
                  <span className="m-board-card__branch-name">{branch.name}</span>
                ) : (
                  <span className="m-board-card__branch-detached">{t('board.branch.detached')}</span>
                )}
              </span>
            )}
          </span>
        )}
      </RacButton>

      <div className="m-board-card__body">
        <StatusLine state={state} />
        {task.worktree_removed_at !== null && (
          <span className="m-board-card__note">{t('board.card.worktreeRemoved')}</span>
        )}

        {waiting && !expanded && <InlineDecision item={waiting} onOpen={onToggle} />}

        {expanded && (
          <div data-slot="board-card-detail" className="m-board-card__detail">
            {waiting?.kind === 'plan_review' && (
              <Button size="sm" onPress={() => openReview(waiting.reviewId)}>
                {t('chat.plan.reviewReady')}
              </Button>
            )}
            {waiting && waiting.kind !== 'plan_review' && conversationId !== null && (
              <TranscriptConversationProvider value={conversationId}>
                {call ? (
                  <ToolCallBlock data={call} />
                ) : (
                  <span className="m-board-card__note">{t('board.card.notLoaded')}</span>
                )}
              </TranscriptConversationProvider>
            )}
            {conversationId !== null && (
              <div className="m-board-card__open-conversation">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Message />}
                  onPress={() => onOpenConversation(conversationId)}
                >
                  {t('board.card.openConversation')}
                </Button>
              </div>
            )}
          </div>
        )}

        {(showToReview || showToDone || showRemoveWorktree || showDelete) && (
          <div className="m-board-card__actions">
            {showToReview && (
              <Button size="sm" variant="secondary" iconRight={<ArrowRight />} onPress={() => void move('review')}>
                {t('board.card.toReview')}
              </Button>
            )}
            {showToDone && (
              <Button size="sm" variant="secondary" iconRight={<ArrowRight />} onPress={() => void move('done')}>
                {t('board.card.toDone')}
              </Button>
            )}
            {showRemoveWorktree && (
              <Button size="sm" variant="secondary" onPress={() => void removeWorktree()}>
                {t('board.card.removeWorktree')}
              </Button>
            )}
            {showDelete && (
              <Button size="sm" variant="secondary" onPress={() => void removeCard()}>
                {t('board.card.delete')}
              </Button>
            )}
          </div>
        )}

        {task.stage !== 'done' &&
          task.worktree_removed_at === null &&
          (conversationId === null ? (
            <StartComposer task={task} onError={onError} />
          ) : (
            <ConversationComposer task={task} conversationId={conversationId} state={state} onError={onError} />
          ))}
      </div>
    </article>
  )
}
