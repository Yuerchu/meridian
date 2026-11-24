import './sub-agent-group.css'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ListBox, ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Ban, CircleCheck, CircleQuestion, Compass, SkipForward, TriangleAlert } from '@keyline-icons/react/two-tone'
import { ToolFields } from '@/components/ui/tool-value'
import { parsePartialObject } from '@/lib/partial-json'
import { isAskTool, toolUi } from '@/lib/tool-catalog'
import { BUBBLE_BLOCK } from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
import { useTranscriptConversationId } from '@/hooks/use-transcript-conversation'
import { useConversationStore } from '@/stores/conversation-store'
import { parseSubAgentResult, splitTruncation, type SubAgentOutcome, type SubAgentResult } from '@/lib/tool-output'
import { AskUserBlock, PendingApproval, toolLabel } from './tool-call-block'
import { firstLineOf, latestStep } from './latest-step'
import { useSubAgentSheet } from './sub-agent-sheet-context'
import type { ToolCallDisplay } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

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
  if (toolUi(call.tool_name)?.block !== 'delegate') return null
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
      <span aria-hidden>
        <Spinner size="sm" />
      </span>
    ) : outcome === 'done' ? (
      <CircleCheck className="m-sub-agent-group__badge-icon" />
    ) : outcome === 'failed' ? (
      <TriangleAlert className="m-sub-agent-group__badge-icon" />
    ) : (
      <Ban className="m-sub-agent-group__badge-icon" />
    )
  return (
    <span data-slot="sub-agent-status" data-outcome={outcome} className="m-sub-agent-group__status">
      <Badge
        size="sm"
        tone={
          outcome === 'done'
            ? 'success'
            : outcome === 'failed'
              ? 'danger'
              : outcome === 'running'
                ? 'neutral'
                : 'warning'
        }
      >
        {icon}
        {label}
      </Badge>
    </span>
  )
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
    <div data-slot="sub-agent-row-line" data-tone={tone} className="m-sub-agent-group__row-line">
      {tone === 'live' ? <span className="m-sub-agent-group__shimmer">{text}</span> : text}
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
    <div data-slot="sub-agent-group" data-bubble-block="" className={joinClasses(BUBBLE_BLOCK, 'm-sub-agent-group')}>
      <div data-slot="sub-agent-group-header" className="m-sub-agent-group__header">
        <span data-slot="sub-agent-group-title" className="m-sub-agent-group__title">
          {t('chat.subAgent.group', { count: rows.length })}
        </span>
        {summary.length > 0 && <span data-slot="sub-agent-group-summary">{summary.join(' · ')}</span>}
        <span data-slot="sub-agent-group-ticks" aria-hidden className="m-sub-agent-group__ticks">
          {states.map((state, i) => (
            <i key={i} data-slot="sub-agent-group-tick" data-state={state} className="m-sub-agent-group__tick" />
          ))}
        </span>
      </div>
      <div className="m-sub-agent-group__list">
        <ListBox
          aria-label={t('chat.subAgent.listLabel')}
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
              <ListBoxItem
                key={row.call.call_id}
                id={row.call.call_id}
                textValue={row.delegation.description}
                isDisabled={!row.call.sub_agent}
                data-state={state}
              >
                <div data-slot="sub-agent-row" className="m-sub-agent-group__row">
                  <span
                    data-slot="sub-agent-row-dot"
                    data-state={state}
                    aria-hidden
                    className="m-sub-agent-group__dot"
                  />
                  <span data-slot="sub-agent-row-kind" className="m-sub-agent-group__kind">
                    {readOnly ? (
                      <Compass aria-hidden className="m-sub-agent-group__kind-icon" />
                    ) : (
                      <SkipForward aria-hidden className="m-sub-agent-group__kind-icon" />
                    )}
                    {t(`chat.subAgent.${row.delegation.kind}`)}
                  </span>
                  <span data-slot="sub-agent-row-body" className="m-sub-agent-group__row-body">
                    <span
                      data-slot="sub-agent-row-title"
                      onPointerEnter={titleIfTruncated}
                      className="m-sub-agent-group__row-title"
                    >
                      {row.delegation.description}
                    </span>
                    <SubAgentRowLine row={row} state={state} />
                  </span>
                  <span data-slot="sub-agent-row-end" className="m-sub-agent-group__row-end">
                    {row.outcome && row.outcome !== 'running' && <SubAgentStatusChip outcome={row.outcome} />}
                    <LiveSteps run={row.call.sub_agent} fallback={steps} />
                  </span>
                </div>
              </ListBoxItem>
            )
          })}
        </ListBox>
      </div>

      {rows.map((row) => {
        const nested = row.call.nested_approval
        if (!nested) return null
        // The question the run raised. Asked here because this is where
        // somebody is looking — its own conversation may never be opened.
        return (
          <div key={nested.approval_id} data-slot="sub-agent-question" className="m-sub-agent-group__question">
            <div data-slot="sub-agent-question-header" className="m-sub-agent-group__question-header">
              <CircleQuestion className="m-sub-agent-group__question-icon" />
              <span data-slot="sub-agent-question-text">
                {row.delegation.description} · {t('chat.subAgent.asksFor', { tool: nested.tool_name })}
              </span>
            </div>
            {isAskTool(nested.tool_name) ? (
              <AskUserBlock
                data={{
                  call_id: nested.call_id,
                  tool_name: nested.tool_name,
                  arguments: nested.arguments,
                  status: 'pending',
                  approval_id: nested.approval_id,
                  retry: nested.retry,
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
                  retry={nested.retry}
                  onAnswered={() => conversationId && resolveNested(conversationId, nested.approval_id)}
                />
              </>
            )}
          </div>
        )
      })}

      {rows.map((row) =>
        row.report?.stranded ? (
          <div key={row.call.call_id} className="m-sub-agent-group__stranded">
            <Alert data-slot="sub-agent-stranded" tone="warning">
              {row.report.stranded}
            </Alert>
          </div>
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
    <span data-slot="sub-agent-row-steps" className="m-sub-agent-group__steps">
      {t('chat.subAgent.steps', { count: steps })}
    </span>
  )
}
