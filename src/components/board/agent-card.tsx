// One card: collapsed to a status line, or open in place with everything
// needed to answer it. Nothing here opens an overlay — the point of the board
// is that every agent stays in view while you answer one.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as RacButton } from 'react-aria-components'
import { ArrowRight, ChevronDown, GitBranch, Message } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { Button, Chip, Kanban } from '@/components/base'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import { TranscriptConversationProvider } from '@/hooks/use-transcript-conversation'
import { titleIfTruncated } from '@/lib/truncation'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import { useBoardStore } from '@/stores/board-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { BoardTaskInfoResponse, ToolCallDisplay } from '@/types'
import { cx } from '@/utils/cx'
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
    api.workspaceGitStatus({ conversationId }).then(
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
  let tone = 'text-text-secondary'
  switch (state.kind) {
    case 'idle':
      return null
    case 'working':
      label = t('board.state.working')
      detail = state.step
      tone = 'text-status-info-soft-foreground'
      break
    case 'approval':
      label = t('board.state.approval')
      tone = 'text-status-warning-soft-foreground'
      break
    case 'question':
      label = t('board.state.question')
      tone = 'text-status-warning-soft-foreground'
      break
    case 'failed':
      label = t('board.state.failed')
      detail = state.reason
      tone = 'text-status-danger-soft-foreground'
      break
    case 'finished':
      label = state.stopped ? t('board.state.stopped') : t('board.state.finished')
      detail = state.summary
      tone = state.stopped ? 'text-text-secondary' : 'text-status-success-soft-foreground'
      break
  }
  return (
    <div data-slot="board-card-status" className="flex min-w-0 flex-col gap-0.5">
      <span className={cx('flex items-center gap-1.5 text-caption-1-medium', tone)}>
        <StateIcon state={state} />
        {label}
      </span>
      {detail && (
        <span onPointerEnter={titleIfTruncated} className="truncate pl-5.5 text-caption-1-regular text-text-secondary">
          {detail}
        </span>
      )}
    </div>
  )
}

export interface AgentCardProps {
  task: BoardTaskInfoResponse
  state: AgentState
  expanded: boolean
  focused: boolean
  onToggle: () => void
  onOpenConversation: (conversationId: string) => void
  onError: (error: string) => void
}

export function AgentCard({ task, state, expanded, focused, onToggle, onOpenConversation, onError }: AgentCardProps) {
  const { t } = useTranslation()
  const conversationId = task.conversation_id
  const waiting = state.kind === 'approval' || state.kind === 'question' ? state.item : null
  const call = useWaitingCall(conversationId, waiting)
  const branch = useWorktreeBranch(conversationId, task.worktree_path !== null, state.kind)
  const openReview = usePlanReviewStore((s) => s.openReview)
  const busy = state.kind === 'working' || state.kind === 'approval' || state.kind === 'question'
  const advance = task.stage === 'running' ? 'review' : task.stage === 'review' ? 'done' : null
  const asking = waiting !== null

  const move = async (stage: 'review' | 'done') => {
    try {
      const { tasks } = useBoardStore.getState()
      await api.boardTaskMove({ id: task.id, stage, index: tasks.filter((c) => c.stage === stage).length })
    } catch (err) {
      onError(t('board.error.move', { error: String(err) }))
    }
  }

  return (
    <Kanban.Card
      id={task.id}
      textValue={task.title}
      data-card-id={task.id}
      data-state={state.kind}
      className={cx(
        'flex flex-col gap-2.5 p-0 transition-shadow duration-150',
        asking && 'border-status-warning',
        state.kind === 'failed' && 'border-status-danger',
        focused && 'ring-2 ring-border-focus-ring',
      )}
    >
      <RacButton
        aria-expanded={expanded}
        aria-label={
          expanded ? t('board.card.collapse', { title: task.title }) : t('board.card.expand', { title: task.title })
        }
        onPress={onToggle}
        className="flex w-full flex-col gap-1.5 rounded-xl p-2.5 pb-0 text-left outline-none data-focus-visible:ring-2 data-focus-visible:ring-border-focus-ring"
      >
        <span className="flex w-full items-start gap-1.5">
          <span className="min-w-0 flex-1 text-body-2-medium text-text-primary">{task.title}</span>
          <ChevronDown
            aria-hidden
            className={cx(
              'mt-0.5 size-4 shrink-0 text-text-secondary transition-transform duration-150',
              expanded && 'rotate-180',
            )}
          />
        </span>
        {(task.agent_kind !== null || branch.kind === 'read') && (
          <span className="flex min-w-0 items-center gap-1.5 text-caption-1-regular text-text-secondary">
            {task.agent_kind !== null && (
              <Chip size="sm" variant="soft">
                {task.agent_kind === 'claude_code' ? t('board.agent.claudeCode') : t('board.agent.native')}
              </Chip>
            )}
            {branch.kind === 'read' && (
              <span className="flex min-w-0 items-center gap-1">
                <GitBranch aria-hidden className="size-3.5 shrink-0" />
                {branch.name !== null ? (
                  <span className="truncate font-mono">{branch.name}</span>
                ) : (
                  <span className="text-status-warning-soft-foreground">{t('board.branch.detached')}</span>
                )}
              </span>
            )}
          </span>
        )}
      </RacButton>

      <div className="flex flex-col gap-2.5 px-2.5 pb-2.5">
        <StatusLine state={state} />
        {task.worktree_removed_at !== null && (
          <span className="text-caption-1-regular text-text-secondary">{t('board.card.worktreeRemoved')}</span>
        )}

        {waiting && !expanded && <InlineDecision item={waiting} onOpen={onToggle} />}

        {expanded && (
          <div data-slot="board-card-detail" className="flex flex-col gap-2.5">
            {waiting?.kind === 'plan_review' && (
              <Button size="small" onPress={() => openReview(waiting.reviewId)}>
                {t('chat.plan.reviewReady')}
              </Button>
            )}
            {waiting && waiting.kind !== 'plan_review' && conversationId !== null && (
              <TranscriptConversationProvider value={conversationId}>
                {call ? (
                  <ToolCallBlock data={call} />
                ) : (
                  <span className="text-caption-1-regular text-text-secondary">{t('board.card.notLoaded')}</span>
                )}
              </TranscriptConversationProvider>
            )}
            {conversationId !== null && (
              <Button
                size="small"
                variant="secondary"
                leadingIcon={Message}
                className="w-fit"
                onPress={() => onOpenConversation(conversationId)}
              >
                {t('board.card.openConversation')}
              </Button>
            )}
          </div>
        )}

        {advance !== null && !busy && conversationId !== null && (expanded || state.kind === 'finished') && (
          <div className="flex justify-end">
            <Button size="small" variant="secondary" trailingIcon={ArrowRight} onPress={() => void move(advance)}>
              {advance === 'review' ? t('board.card.toReview') : t('board.card.toDone')}
            </Button>
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
    </Kanban.Card>
  )
}
