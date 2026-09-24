import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Alert, Chip, ListBox, Spinner } from '@/components/base'
import { ShimmerText } from '@/components/application/agent-log/agent-log'
import { Ban, CircleCheck, CircleQuestion, Compass, SkipForward, TriangleAlert } from '@keyline-icons/react/two-tone'
import { ToolFields } from '@/components/ui/tool-value'
import { parsePartialObject } from '@/lib/partial-json'
import { BUBBLE_BLOCK } from '@/components/ui/bubble'
import { useTranscriptConversationId } from '@/hooks/use-transcript-conversation'
import { useConversationStore } from '@/stores/conversation-store'
import { parseSubAgentResult, splitTruncation, type SubAgentOutcome, type SubAgentResult } from '@/lib/tool-output'
import { cx } from '@/utils/cx'
import { AskUserBlock, PendingApproval, identifyingArg, toolLabel } from './tool-call-block'
import { useSubAgentSheet } from './sub-agent-sheet-context'
import type { MessageViewModel, ToolCallDisplay } from '@/types'

/**
 * The delegations a bubble made, as one group: a row per run.
 *
 * A `run_agent` call used to be a key like any other, with a panel that held
 * the briefing, a step list and the whole report — three folds deep, and for
 * three runs in one round three of them side by side, none saying which was
 * still going. What the reader wants from a delegation is smaller than that:
 * whether it is still running, what it is doing right now, what it concluded
 * in a sentence, and a way in. So a row carries exactly those, and the way in
 * is the run's own conversation, opened beside the transcript
 * (`sub-agent-sheet.tsx`) rather than re-projected into it — the parent model
 * has the full report already, and the reader who wants it wants the real
 * transcript, keys and all.
 *
 * "What it is doing right now" is read off the run's own session in the
 * store. The global listener writes every conversation's stream into
 * `sessions[id]` whether or not it is open — `handleMessageStart` creates the
 * session — so a live run's latest row is already here, at no extra request.
 * A run reopened after a restart has no session until the sheet loads one,
 * and shows its verdict instead, which is what a finished run shows anyway.
 *
 * A question the run raised is asked under the group, not on the row: a row
 * is a list item and holds no second focusable, and the question is the one
 * thing here that needs buttons.
 */

export interface Delegation {
  description: string
  kind: 'explore' | 'agent'
  prompt: string | null
}

/** The delegation a call is, or null while its arguments are still streaming
 *  in — a call with no description yet is drawn as a plain key until then. */
export function delegationOf(call: ToolCallDisplay): Delegation | null {
  if (call.tool_name !== 'run_agent') return null
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.arguments) as Record<string, unknown>
  } catch {
    return null
  }
  const description = typeof args.description === 'string' ? args.description.trim() : ''
  if (!description) return null
  return {
    description,
    kind: args.agent === 'explore' ? 'explore' : 'agent',
    prompt: typeof args.prompt === 'string' && args.prompt.trim() ? args.prompt.trim() : null,
  }
}

export type SubAgentVerdict = SubAgentOutcome | 'running' | 'interrupted'

/**
 * The run's verdict: the backend's recorded status first, the sentence at the
 * head of the result for rows from before that status was carried.
 *
 * Except that a `running` on an answered call is not something the backend
 * said. `run_agent` blocks until the run ends, and the backend writes the run's
 * terminal status before it returns the report — so by the time this card has a
 * result, the run is over. What is on the card is the guess
 * `handleSubAgentStarted` seeds when the run starts. There is no finish event to
 * retract it: `sub_agent_started` is the only one the backend emits about a run,
 * and the `stop` at the end carries the *run's* conversation id, so the global
 * listener routes it to the run's own session and the parent's card never hears
 * of it. Nothing corrects the guess until the parent turn ends and reloads the
 * whole snapshot — and a turn goes on delegating, calling tools and thinking
 * for minutes after a run comes back, with the group counting a finished run as
 * running on a row already showing its report.
 *
 * So an answered call reads its verdict off the result, which is the backend's
 * own sentence about how the run ended, and is the only word the live path
 * gets. It carries one verdict the recorded status cannot — `aborted`, the loop
 * guard's stop, which is not a `TurnStatus` — which is also why this is not
 * fixed by writing a status back onto the card in the store.
 */
export function subAgentOutcome(data: ToolCallDisplay, report: SubAgentResult | null): SubAgentVerdict | null {
  if (data.status === 'running' || data.status === 'approved') return 'running'
  if (data.status === 'error') return 'failed'
  // Not merely "has a result": a denied `run_agent` has one too, and its run
  // never started, so it must keep falling through to `idle`.
  const ended = data.status === 'completed'
  switch (data.sub_agent?.status) {
    case 'running':
    case 'waiting_review':
      if (!ended) return 'running'
      break
    case 'done':
      return 'done'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
    case 'interrupted':
      return 'interrupted'
  }
  // A result the head sentence cannot be read out of, on a call that returned
  // successfully: the tool answered, so it is not still going.
  return report?.outcome ?? (ended ? 'done' : null)
}

export function SubAgentStatusChip({ outcome }: { outcome: SubAgentVerdict }) {
  const { t } = useTranslation()
  const label = t(`chat.tool.panel.status.${outcome}`)
  const icon =
    outcome === 'running' ? (
      <Spinner size="sm" color="current" />
    ) : outcome === 'done' ? (
      <CircleCheck className="size-3" />
    ) : outcome === 'failed' ? (
      <TriangleAlert className="size-3" />
    ) : (
      <Ban className="size-3" />
    )
  return (
    // The attributes ride a span of our own: Chip keeps what it is handed to
    // itself.
    <span data-slot="sub-agent-status" data-outcome={outcome} className="contents">
      <Chip
        size="sm"
        variant="soft"
        color={
          outcome === 'done'
            ? 'success'
            : outcome === 'failed'
              ? 'danger'
              : outcome === 'running'
                ? 'default'
                : 'warning'
        }
      >
        {icon}
        {label}
      </Chip>
    </span>
  )
}

/** Markdown reduced to a line: the first paragraph, with its heading marks,
 *  emphasis and code ticks taken off. For a row, not for reading. */
function firstLineOf(markdown: string): string | null {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find(Boolean)
  if (!paragraph) return null
  return (
    paragraph
      .replace(/\n+/g, ' ')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .trim() || null
  )
}

/** The most recent thing the run did, off its session: the last assistant
 *  row's last block. Null when nothing of the run is in the store. */
function latestStep(t: TFunction, messages: MessageViewModel[] | undefined, turnId: string): string | null {
  if (!messages) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || m.turn_id !== turnId) continue
    const blocks = m._blocks ?? []
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]
      if (b.type === 'text' && b.text.trim()) return firstLineOf(b.text)
      if (b.type === 'tool_call') {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(b.data.arguments) as Record<string, unknown>
        } catch {
          // Still streaming; the name alone is the step.
        }
        const arg = identifyingArg(b.data.tool_name, args)
        return arg ? `${toolLabel(t, b.data.tool_name)} ${arg.value}` : toolLabel(t, b.data.tool_name)
      }
      if (b.type === 'thinking' && b.text.trim()) return t('chat.thinking')
    }
    return null
  }
  return null
}

interface Row {
  call: ToolCallDisplay
  delegation: Delegation
  outcome: SubAgentVerdict | null
  report: SubAgentResult | null
}

function rowsOf(calls: ToolCallDisplay[]): Row[] {
  const rows: Row[] = []
  for (const call of calls) {
    const delegation = delegationOf(call)
    if (!delegation) continue
    const report =
      call.result === undefined || call.status === 'error'
        ? null
        : parseSubAgentResult(splitTruncation(call.result).body)
    rows.push({ call, delegation, outcome: subAgentOutcome(call, report), report })
  }
  return rows
}

type RowState = 'done' | 'running' | 'waiting' | 'failed' | 'idle'

function stateOf(row: Row): RowState {
  if (row.call.nested_approval) return 'waiting'
  switch (row.outcome) {
    case 'running':
      return 'running'
    case 'done':
      return 'done'
    case null:
      return row.call.sub_agent ? 'running' : 'idle'
    default:
      return 'failed'
  }
}

const DOT: Record<RowState, string> = {
  done: 'bg-status-success',
  running: 'bg-status-info ring-4 ring-status-info/20',
  // eslint-disable-next-line no-restricted-syntax -- a live status dot pulses; it is not a placeholder
  waiting: 'bg-status-warning ring-4 ring-status-warning/25 animate-pulse motion-reduce:animate-none',
  failed: 'bg-status-danger',
  idle: 'bg-background-secondary-default',
}

const TICK: Record<RowState, string> = {
  done: 'bg-status-success',
  running: 'bg-status-info',
  waiting: 'bg-status-warning',
  failed: 'bg-status-danger',
  idle: 'bg-background-secondary-default',
}

function SubAgentRowLine({ row, state }: { row: Row; state: RowState }) {
  const { t } = useTranslation()
  const run = row.call.sub_agent
  const messages = useConversationStore((s) => (run ? s.sessions[run.conversation_id]?.messages : undefined))
  const live = useMemo(
    () => (run && state === 'running' ? latestStep(t, messages, run.turn_id) : null),
    [t, messages, run, state],
  )

  let text: string | null
  let tone: 'live' | 'warn' | 'plain' = 'plain'
  if (state === 'waiting' && row.call.nested_approval) {
    text = t('chat.subAgent.waitingFor', { tool: toolLabel(t, row.call.nested_approval.tool_name) })
    tone = 'warn'
  } else if (state === 'running') {
    text = live ?? t('chat.tool.panel.status.running')
    tone = 'live'
  } else if (state === 'idle') {
    text = t('chat.subAgent.notStarted')
  } else if (row.call.status === 'error' && row.call.result) {
    text = firstLineOf(row.call.result)
  } else {
    text = row.report ? firstLineOf(row.report.body) : null
    if (!text && row.outcome) text = t(`chat.tool.panel.status.${row.outcome}`)
  }
  if (!text) return null
  return (
    <div
      data-slot="sub-agent-row-line"
      data-tone={tone}
      className={cx(
        'truncate text-caption-1-regular',
        tone === 'warn' ? 'text-status-warning-soft-foreground' : 'text-text-secondary',
      )}
    >
      {tone === 'live' ? <ShimmerText>{text}</ShimmerText> : text}
    </div>
  )
}

export function SubAgentGroup({ calls }: { calls: ToolCallDisplay[] }) {
  const { t } = useTranslation()
  const sheet = useSubAgentSheet()
  const openConversation = useConversationStore((s) => s.openConversation)
  const resolveNested = useConversationStore((s) => s.resolveNestedApproval)
  // The conversation this group is drawn in, which is the one holding the
  // `run_agent` row and therefore the `nested_approval` to retire. Today it is
  // always the window's — a delegated run is handed no way to delegate
  // (`commands/sub_agent.rs` passes `sub_agents: None`), so a group cannot
  // appear inside the sub-agent sheet. That is somebody else's invariant
  // though, and reading it from the transcript costs nothing and stops this
  // from being the thing that breaks if nesting is ever allowed.
  const conversationId = useTranscriptConversationId()
  const rows = useMemo(() => rowsOf(calls), [calls])
  if (rows.length === 0) return null

  const states = rows.map(stateOf)
  const count = (state: RowState) => states.filter((s) => s === state).length
  const summary = [
    count('done') > 0 && t('chat.subAgent.count.done', { count: count('done') }),
    count('running') > 0 && t('chat.subAgent.count.running', { count: count('running') }),
    count('waiting') > 0 && t('chat.subAgent.count.waiting', { count: count('waiting') }),
    count('failed') > 0 && t('chat.subAgent.count.failed', { count: count('failed') }),
  ].filter((s): s is string => typeof s === 'string')

  const open = (row: Row) => {
    const run = row.call.sub_agent
    if (!run) return
    if (sheet)
      sheet.open({
        conversationId: run.conversation_id,
        turnId: run.turn_id,
        title: row.delegation.description,
        kind: row.delegation.kind,
      })
    else openConversation(run.conversation_id)
  }

  return (
    // A block of the bubble like any other, which is what it always looked
    // like — a head row over its contents, in the bubble's own fill — while
    // being an item on a keyboard. Now it says so, and `bubble.tsx` gives it
    // the fill, the radius and the shared corners the rest of them get.
    <div
      data-slot="sub-agent-group"
      data-bubble-block=""
      className={cx(BUBBLE_BLOCK, 'flex w-full flex-col text-caption-1-regular')}
    >
      <div
        data-slot="sub-agent-group-header"
        className="flex items-center gap-2 border-b border-border-button-default/50 px-3 py-1.5 text-text-secondary"
      >
        <span data-slot="sub-agent-group-title" className="text-caption-1-medium text-text-primary">
          {t('chat.subAgent.group', { count: rows.length })}
        </span>
        {summary.length > 0 && <span data-slot="sub-agent-group-summary">{summary.join(' · ')}</span>}
        <span data-slot="sub-agent-group-ticks" aria-hidden className="ml-auto flex gap-0.5">
          {states.map((state, i) => (
            <i
              key={i}
              data-slot="sub-agent-group-tick"
              data-state={state}
              className={cx('block h-1 w-4 rounded-sm', TICK[state])}
            />
          ))}
        </span>
      </div>
      <ListBox
        aria-label={t('chat.subAgent.listLabel')}
        className="p-1"
        onAction={(key) => {
          const row = rows.find((r) => r.call.call_id === String(key))
          if (row) open(row)
        }}
      >
        {rows.map((row, i) => {
          const state = states[i]
          const readOnly = row.delegation.kind === 'explore'
          const steps = Math.max(row.call.sub_agent?.steps ?? 0, row.report?.steps ?? 0)
          return (
            <ListBox.Item
              key={row.call.call_id}
              id={row.call.call_id}
              textValue={row.delegation.description}
              isDisabled={!row.call.sub_agent}
              data-state={state}
              className="rounded-lg px-2 py-1.5"
            >
              <div
                data-slot="sub-agent-row"
                className="grid w-full min-w-0 grid-cols-[auto_auto_1fr_auto] items-center gap-2.5"
              >
                <span
                  data-slot="sub-agent-row-dot"
                  aria-hidden
                  className={cx('block size-2 rounded-full', DOT[state])}
                />
                <span
                  data-slot="sub-agent-row-kind"
                  className="flex items-center gap-1 text-caption-1-medium text-text-primary"
                >
                  {readOnly ? (
                    <Compass aria-hidden className="size-3.5 text-text-secondary" />
                  ) : (
                    <SkipForward aria-hidden className="size-3.5 text-text-secondary" />
                  )}
                  {t(`chat.subAgent.${row.delegation.kind}`)}
                </span>
                <span data-slot="sub-agent-row-body" className="min-w-0">
                  <span data-slot="sub-agent-row-title" className="block truncate text-body-regular text-text-primary">
                    {row.delegation.description}
                  </span>
                  <SubAgentRowLine row={row} state={state} />
                </span>
                <span data-slot="sub-agent-row-end" className="flex items-center gap-2 text-text-secondary">
                  {row.outcome && row.outcome !== 'running' && <SubAgentStatusChip outcome={row.outcome} />}
                  <LiveSteps run={row.call.sub_agent} fallback={steps} />
                </span>
              </div>
            </ListBox.Item>
          )
        })}
      </ListBox>

      {rows.map((row) => {
        const nested = row.call.nested_approval
        if (!nested) return null
        // The question the run raised. Asked here because this is where
        // somebody is looking — its own conversation may never be opened.
        return (
          <div
            key={nested.approval_id}
            data-slot="sub-agent-question"
            className="space-y-2 border-t border-border-button-default/50 px-3 py-2"
          >
            <div data-slot="sub-agent-question-header" className="flex items-start gap-1.5 px-0.5 text-text-secondary">
              <CircleQuestion className="size-3.5 shrink-0" />
              <span data-slot="sub-agent-question-text">
                {row.delegation.description} · {t('chat.subAgent.asksFor', { tool: nested.tool_name })}
              </span>
            </div>
            {nested.tool_name === 'ask_user' || nested.tool_name === 'AskUserQuestion' ? (
              <AskUserBlock
                data={{
                  call_id: nested.call_id,
                  tool_name: nested.tool_name,
                  arguments: nested.arguments,
                  status: 'pending',
                  approval_id: nested.approval_id,
                  retry_reason: nested.retry_reason,
                }}
                chromeless
                onAnswered={() => conversationId && resolveNested(conversationId, nested.approval_id)}
              />
            ) : (
              <>
                {/* What it wants to run, as fields: this is what is being
                    approved, and it used to be the raw JSON of the call. */}
                <ToolFields entries={Object.entries(parsePartialObject(nested.arguments) ?? {})} />
                <PendingApproval
                  key={nested.approval_id}
                  approvalId={nested.approval_id}
                  retryReason={nested.retry_reason}
                  onAnswered={() => conversationId && resolveNested(conversationId, nested.approval_id)}
                />
              </>
            )}
          </div>
        )
      })}

      {rows.map((row) =>
        row.report?.stranded ? (
          <Alert key={row.call.call_id} data-slot="sub-agent-stranded" status="warning" className="m-2 mt-0">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{row.report.stranded}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null,
      )}
    </div>
  )
}

/** Steps counted live while the run goes; the snapshot's count is what
 *  survives a reload. */
function LiveSteps({ run, fallback }: { run: ToolCallDisplay['sub_agent']; fallback: number }) {
  const { t } = useTranslation()
  const live = useConversationStore((s) => (run ? s.subAgentSteps[run.turn_id] : undefined))
  const steps = Math.max(live ?? 0, fallback)
  if (steps === 0) return null
  return (
    <span data-slot="sub-agent-row-steps" className="tabular-nums">
      {t('chat.subAgent.steps', { count: steps })}
    </span>
  )
}
