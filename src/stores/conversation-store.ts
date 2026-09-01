import { create } from 'zustand'
import { produce } from 'immer'
import { api } from '@/api'
import { parseTodoArgs, toDrafts, type TodoArgs } from '@/components/chat/todo-list'
import { parseJsonText, requireExactKeys, requireKnownKeys, requireRecord } from '@/lib/strict-json'
import type {
  AutoReviewVerdictInfoResponse,
  BranchPointInfoResponse,
  UserCommandResultResponse,
  ConversationInfoResponse,
  MessageInfoResponse,
  MessageViewModel,
  PendingApprovalInfoResponse,
  PlanReviewSummaryInfoResponse,
  ProjectInfoResponse,
  ContentBlock,
  OpenAIToolCall,
  SubAgentKind,
  SubAgentRunInfoResponse,
  TodoInfoResponse,
  ToolCallDisplay,
  TurnInfoResponse,
} from '@/types'
import { usePlanReviewStore, type PlanReviewEventInfo } from '@/stores/plan-review-store'

/**
 * Read a checklist out of an `update_todos` call. A list whose steps are all
 * done has already been archived on the backend, so it stops being the active
 * one here too.
 */
function readTodoArgs(args: string): TodoArgs | null {
  const parsed = requireRecord(parseJsonText(args, 'update_todos arguments'), 'update_todos arguments')
  const todoArgs = parseTodoArgs(parsed)
  if (!todoArgs) throw new Error('update_todos arguments do not match the TodoArgs contract')
  return todoArgs.todos.every((t) => t.status === 'completed') ? null : todoArgs
}

/** The calls a finished assistant row records having made, or `null` while it
 *  is still being written. */
function storedCalls(column: unknown[] | null | undefined): OpenAIToolCall[] | null {
  if (column == null) return null
  if (!Array.isArray(column)) throw new Error('message.tool_calls must be an array')
  return column.map((value, index) => {
    const call = requireExactKeys(value, ['id', 'type', 'function'], `message.tool_calls[${index}]`)
    const fn = requireExactKeys(call.function, ['name', 'arguments'], `message.tool_calls[${index}].function`)
    if (
      typeof call.id !== 'string' ||
      !call.id ||
      call.type !== 'function' ||
      typeof fn.name !== 'string' ||
      !fn.name ||
      typeof fn.arguments !== 'string'
    )
      throw new Error(`message.tool_calls[${index}] has invalid field types`)
    requireRecord(
      parseJsonText(fn.arguments, `message.tool_calls[${index}].function.arguments`),
      `message.tool_calls[${index}].function.arguments`,
    )
    return { id: call.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } }
  })
}

const AUTO_REVIEW_OUTCOMES = new Set(['allow', 'deny', 'unreadable'])
const AUTO_REVIEW_RISKS = new Set(['low', 'medium', 'high', 'critical'])
const AUTO_REVIEW_AUTHORIZATIONS = new Set(['unknown', 'low', 'medium', 'high'])
const AUTO_REVIEW_STAGES = new Set(['quick', 'investigate'])

function autoReviewVerdict(value: unknown, label: string): AutoReviewVerdictInfoResponse {
  const verdict = requireExactKeys(
    value,
    ['outcome', 'risk', 'authorization', 'rationale', 'stage', 'model', 'evidence'],
    label,
  )
  if (typeof verdict.outcome !== 'string' || !AUTO_REVIEW_OUTCOMES.has(verdict.outcome)) {
    throw new Error(`${label}.outcome is unknown`)
  }
  if (verdict.risk !== null && (typeof verdict.risk !== 'string' || !AUTO_REVIEW_RISKS.has(verdict.risk))) {
    throw new Error(`${label}.risk is unknown`)
  }
  if (
    verdict.authorization !== null &&
    (typeof verdict.authorization !== 'string' || !AUTO_REVIEW_AUTHORIZATIONS.has(verdict.authorization))
  )
    throw new Error(`${label}.authorization is unknown`)
  if (verdict.stage !== null && (typeof verdict.stage !== 'string' || !AUTO_REVIEW_STAGES.has(verdict.stage))) {
    throw new Error(`${label}.stage is unknown`)
  }
  for (const field of ['rationale', 'model'] as const) {
    if (verdict[field] !== null && typeof verdict[field] !== 'string') {
      throw new Error(`${label}.${field} must be a string or null`)
    }
  }
  if (!Array.isArray(verdict.evidence)) throw new Error(`${label}.evidence must be an array`)
  verdict.evidence.forEach((value, index) => {
    const evidence = requireExactKeys(value, ['tool', 'arguments'], `${label}.evidence[${index}]`)
    if (typeof evidence.tool !== 'string' || typeof evidence.arguments !== 'string') {
      throw new Error(`${label}.evidence[${index}] has invalid field types`)
    }
  })
  return verdict as unknown as AutoReviewVerdictInfoResponse
}

/**
 * Group the tool rows under the assistant message they answered.
 *
 * Scoped to the rows between one assistant message and the next assistant or
 * user message, rather than searched across the whole transcript. Provider call
 * ids are not unique — some OpenAI-compatible gateways restart at `"0"` every
 * request — so a transcript-wide lookup lets a later, still-unanswered call
 * match an earlier round's result and read as completed. That is the same
 * disappearing-approval-card bug wearing a different hat.
 */
function toolRowsByAssistant(msgs: MessageInfoResponse[]): Map<string, MessageInfoResponse[]> {
  const out = new Map<string, MessageInfoResponse[]>()
  let current: string | null = null
  for (const m of msgs) {
    if (m.role === 'assistant') {
      current = m.id
      out.set(m.id, [])
    } else if (m.role === 'user') {
      current = null
    } else if (m.role === 'tool' && current) {
      out.get(current)?.push(m)
    }
  }
  return out
}

/**
 * Approvals under the two things that place a card: which assistant row asked,
 * and which call within it.
 *
 * Nested rather than keyed on the two ids joined together. Both are opaque —
 * the call id arrives straight off the wire — so any separator chosen for a
 * composite key is one some provider is free to put inside an id.
 */
type ApprovalIndex = Map<string, Map<string, PendingApprovalInfoResponse[]>>

/** `bubbled` picks which call id places the card.
 *
 * A delegated run's approval names two: the tool it wants to run, which lives
 * in the sub-agent's conversation, and the `run_agent` call it hangs under
 * here. Indexing it by the former would look for a call this row never made. */
function indexApprovals(pending: PendingApprovalInfoResponse[], nested: boolean): ApprovalIndex {
  const out: ApprovalIndex = new Map()
  for (const p of pending) {
    const key = nested ? p.parent_call_id : p.provider_call_id
    if (nested !== (p.parent_call_id !== null) || !key) continue
    let byCall = out.get(p.assistant_message_id)
    if (!byCall) {
      byCall = new Map()
      out.set(p.assistant_message_id, byCall)
    }
    const bucket = byCall.get(key)
    if (bucket) bucket.push(p)
    else byCall.set(key, [p])
  }
  return out
}

/** The delegated runs of one conversation, under the call that started each. */
function indexRuns(runs: SubAgentRunInfoResponse[]): Map<string, Map<string, SubAgentRunInfoResponse>> {
  const out = new Map<string, Map<string, SubAgentRunInfoResponse>>()
  for (const r of runs) {
    // Both halves or nothing: a run that cannot say which call made it has no
    // card to attach to, and guessing by call id alone puts a second delegation
    // on the first one's card.
    if (!r.spawned_by_message_id || !r.spawned_by_call_id) continue
    let byCall = out.get(r.spawned_by_message_id)
    if (!byCall) {
      byCall = new Map()
      out.set(r.spawned_by_message_id, byCall)
    }
    byCall.set(r.spawned_by_call_id, r)
  }
  return out
}

function indexPlanReviews(
  reviews: PlanReviewSummaryInfoResponse[],
): Map<string, Map<string, PlanReviewSummaryInfoResponse>> {
  const out = new Map<string, Map<string, PlanReviewSummaryInfoResponse>>()
  for (const review of reviews) {
    let byCall = out.get(review.assistant_message_id)
    if (!byCall) {
      byCall = new Map()
      out.set(review.assistant_message_id, byCall)
    }
    byCall.set(review.provider_call_id, review)
  }
  return out
}

function planReviewToolStatus(status: PlanReviewSummaryInfoResponse['status']): ToolCallDisplay['status'] {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'approved':
      return 'completed'
    case 'changes_requested':
      return 'denied'
    case 'orphaned':
      return 'orphaned'
  }
}

/** How a tool row says it went. Null is every row written before the column
 *  existed, and every one of those claimed success. */
function outcomeOf(toolMsg: MessageInfoResponse): ToolCallDisplay['status'] {
  switch (toolMsg.tool_outcome) {
    case null:
    case undefined:
    case 'success':
      return 'completed'
    case 'denied':
      return 'denied'
    case 'error':
      return 'error'
    default:
      throw new Error(`unknown message.tool_outcome: ${String(toolMsg.tool_outcome)}`)
  }
}

/** The ways a turn can have reached an ending. */
const ENDED = new Set(['done', 'cancelled', 'failed', 'interrupted'])
const TURN_STATUSES = new Set(['running', 'waiting_review', ...ENDED])
const TURN_PHASES = new Set(['streaming', 'awaiting_approval', 'running_tool', 'compacting'])
const MESSAGE_ROLES = new Set(['user', 'assistant', 'tool', 'context'])
const MESSAGE_SOURCES = new Set(['voice', 'shell'])
const TOOL_OUTCOMES = new Set(['success', 'denied', 'error'])
const SUB_AGENT_KINDS = new Set<SubAgentKind>(['explore', 'agent'])

const MESSAGE_RESPONSE_KEYS = [
  'id',
  'conversation_id',
  'role',
  'content',
  'provider_id',
  'model_id',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'provider_name',
  'tool_calls',
  'tool_call_id',
  'sort_order',
  'created_at',
  'reasoning_content',
  'rating',
  'is_compact_summary',
  'sender_id',
  'parent_id',
  'compact_anchor_id',
  'source',
  'turn_id',
  'tool_outcome',
  'auto_review',
  'context_items',
] as const

function requireNullableString(value: unknown, label: string): void {
  if (value !== null && typeof value !== 'string') throw new Error(`${label} must be a string or null`)
}

function requireNullableNonNegativeInteger(value: unknown, label: string): void {
  if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) {
    throw new Error(`${label} must be a non-negative integer or null`)
  }
}

function validateContextItems(message: MessageInfoResponse): void {
  if (!Array.isArray(message.context_items)) throw new Error('message.context_items must be an array')
  if (message.context_items.length > 0 && message.role !== 'user') {
    throw new Error('only user messages may carry context_items')
  }
  message.context_items.forEach((value, index) => {
    const item = requireExactKeys(
      value,
      [
        'id',
        'position',
        'kind',
        'display_path',
        'line_start',
        'line_end',
        'byte_count',
        'line_count',
        'token_count',
        'truncated',
      ],
      `message.context_items[${index}]`,
    )
    if (typeof item.id !== 'string' || !item.id) throw new Error(`message.context_items[${index}].id is invalid`)
    if (item.position !== index) throw new Error(`message.context_items[${index}].position is not contiguous`)
    if (!['project_file', 'project_directory', 'shell_output', 'conversation'].includes(String(item.kind))) {
      throw new Error(`message.context_items[${index}].kind is unknown`)
    }
    requireNullableString(item.display_path, `message.context_items[${index}].display_path`)
    for (const field of ['line_start', 'line_end'] as const) {
      requireNullableNonNegativeInteger(item[field], `message.context_items[${index}].${field}`)
      if (typeof item[field] === 'number' && item[field] <= 0) {
        throw new Error(`message.context_items[${index}].${field} must be positive`)
      }
    }
    for (const field of ['byte_count', 'line_count', 'token_count'] as const) {
      requireNullableNonNegativeInteger(item[field], `message.context_items[${index}].${field}`)
      if (item[field] === null) throw new Error(`message.context_items[${index}].${field} is required`)
    }
    if (typeof item.truncated !== 'boolean')
      throw new Error(`message.context_items[${index}].truncated must be boolean`)
    if (item.kind === 'shell_output') {
      if (item.display_path !== null || item.line_start !== null || item.line_end !== null) {
        throw new Error(`message.context_items[${index}] shell output has file metadata`)
      }
    } else if (typeof item.display_path !== 'string' || !item.display_path) {
      // For a conversation item, `display_path` carries the thread's title.
      throw new Error(`message.context_items[${index}].display_path is required`)
    } else if (item.kind === 'conversation' && (item.line_start !== null || item.line_end !== null)) {
      throw new Error(`message.context_items[${index}] conversation reference has a line range`)
    } else if (item.kind === 'project_directory' && (item.line_start !== null || item.line_end !== null)) {
      throw new Error(`message.context_items[${index}] project directory has a line range`)
    } else if ((item.line_start === null) !== (item.line_end === null)) {
      throw new Error(`message.context_items[${index}] has a partial line range`)
    } else if (
      typeof item.line_start === 'number' &&
      typeof item.line_end === 'number' &&
      item.line_end < item.line_start
    ) {
      throw new Error(`message.context_items[${index}] has an invalid line range`)
    }
  })
}

function validateSnapshotContracts(
  messages: MessageInfoResponse[],
  turns: TurnInfoResponse[],
  runs: SubAgentRunInfoResponse[],
): void {
  for (const message of messages) {
    requireKnownKeys(message, MESSAGE_RESPONSE_KEYS, 'message')
    for (const key of MESSAGE_RESPONSE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(message, key)) {
        throw new Error(`message.${key} is required`)
      }
    }
    if (
      typeof message.id !== 'string' ||
      !message.id ||
      typeof message.conversation_id !== 'string' ||
      !message.conversation_id ||
      typeof message.content !== 'string'
    ) {
      throw new Error('message has invalid required string fields')
    }
    if (!MESSAGE_ROLES.has(message.role)) throw new Error(`unknown message role: ${String(message.role)}`)
    if (typeof message.is_compact_summary !== 'boolean') {
      throw new Error(`message.is_compact_summary must be boolean`)
    }
    for (const field of [
      'provider_id',
      'model_id',
      'provider_name',
      'tool_call_id',
      'reasoning_content',
      'parent_id',
      'compact_anchor_id',
      'turn_id',
    ] as const) {
      requireNullableString(message[field], `message.${field}`)
    }
    for (const field of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'] as const) {
      requireNullableNonNegativeInteger(message[field], `message.${field}`)
    }
    if (!Number.isInteger(message.sort_order) || message.sort_order < 0 || !Number.isFinite(message.created_at)) {
      throw new Error('message has invalid ordering metadata')
    }
    if (message.sender_id !== null && !Number.isSafeInteger(message.sender_id)) {
      throw new Error('message.sender_id must be a safe integer or null')
    }
    if (message.source !== null && !MESSAGE_SOURCES.has(message.source)) {
      throw new Error(`unknown message source: ${String(message.source)}`)
    }
    if (message.source !== null && message.role !== 'user') throw new Error('only user messages may have a source')
    if (message.rating !== null && message.rating !== -1 && message.rating !== 1) {
      throw new Error('message.rating must be -1, 1, or null')
    }
    if (message.rating !== null && message.role !== 'assistant') {
      throw new Error('only assistant messages may have a rating')
    }
    if (message.tool_outcome !== null && !TOOL_OUTCOMES.has(message.tool_outcome)) {
      throw new Error(`unknown message.tool_outcome: ${String(message.tool_outcome)}`)
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id) throw new Error('tool message is missing tool_call_id')
    } else if (message.tool_call_id !== null || message.tool_outcome !== null) {
      throw new Error('non-tool message has tool result fields')
    }
    const calls = storedCalls(message.tool_calls) ?? []
    if (message.role !== 'assistant' && message.tool_calls !== null) {
      throw new Error('non-assistant message has tool_calls')
    }
    const reviews = parseAutoReview(message.auto_review)
    if (message.role !== 'assistant' && message.auto_review !== null) {
      throw new Error('non-assistant message has auto_review')
    }
    const callIds = new Set(calls.map((call) => call.id))
    for (const callId of Object.keys(reviews)) {
      if (!callIds.has(callId)) throw new Error(`message.auto_review.${callId} names an unknown tool call`)
    }
    validateContextItems(message)
  }
  for (const turn of turns) {
    if (!TURN_STATUSES.has(turn.status)) throw new Error(`unknown turn status: ${turn.status}`)
    if (turn.phase !== null && !TURN_PHASES.has(turn.phase)) throw new Error(`unknown turn phase: ${turn.phase}`)
  }
  for (const run of runs) {
    if (run.status !== null && !TURN_STATUSES.has(run.status))
      throw new Error(`unknown sub-agent status: ${run.status}`)
    if (!SUB_AGENT_KINDS.has(run.agent_kind)) {
      throw new Error(`unknown sub-agent kind: ${run.agent_kind}`)
    }
  }
}

/** A tool call that already has its answer.
 *
 *  Both live paths need the same notion of "still outstanding": results and
 *  approvals arrive in the order the calls were made, so the first card without
 *  an answer is the one either of them is talking about. Two spellings of that
 *  would eventually disagree about a row whose gateway restarts its call ids
 *  at "0", which is the case they both exist to get right. */
const ANSWERED = new Set<ToolCallDisplay['status']>(['completed', 'denied', 'error'])

/**
 * What a call with no tool row and nothing waiting on it actually is.
 *
 * Not necessarily abandoned. The registry entry is removed the moment the user
 * decides, and the tool then runs and writes its row some time later — so there
 * is a window, as long as the tool takes, in which a perfectly live call has
 * neither an approval nor a result. Calling that `orphaned` puts a dead-looking
 * card on a tool that is at that moment editing a file.
 *
 * The turn is what tells them apart, and only a turn that positively says it
 * ended earns `orphaned`. A missing record is still inconclusive; an unknown
 * status is a broken first-party contract and is rejected.
 *
 * A row with no `turn_id` predates the record entirely and keeps the reading it
 * has always had.
 */
function unansweredStatus(turnId: string | null | undefined, turns: Map<string, TurnInfoResponse>) {
  if (!turnId) return 'orphaned' as const
  const status = turns.get(turnId)?.status
  if (status !== undefined && !TURN_STATUSES.has(status)) throw new Error(`unknown turn status: ${status}`)
  return status !== undefined && ENDED.has(status) ? ('orphaned' as const) : ('running' as const)
}

/**
 * Rebuild the display blocks of every assistant row from its stored columns.
 *
 * `pending` is what the backend is still holding a turn open for. Without it a
 * call with no tool row is indistinguishable from one that is waiting on the
 * user, and guessing `completed` — which is what this used to do — erases the
 * approval buttons and strands the turn forever.
 *
 * `turns` covers the other half of the same question: `pending` being read
 * after the transcript means a newly registered approval is never missed, but
 * nothing can close the window on the other side, where the approval is already
 * gone and the tool row has not landed yet.
 */
/** The strict `auto_review` column, keyed by call id. */
function parseAutoReview(raw: unknown): Record<string, AutoReviewVerdictInfoResponse> {
  if (raw == null) return {}
  const parsed = requireRecord(raw, 'message.auto_review')
  return Object.fromEntries(
    Object.entries(parsed).map(([callId, value]) => [
      callId,
      autoReviewVerdict(value, `message.auto_review.${callId}`),
    ]),
  )
}

export function hydrateBlocks(
  msgs: MessageInfoResponse[],
  pending: PendingApprovalInfoResponse[] = [],
  turns: TurnInfoResponse[] = [],
  runs: SubAgentRunInfoResponse[] = [],
  planReviews: PlanReviewSummaryInfoResponse[] = [],
): MessageViewModel[] {
  validateSnapshotContracts(msgs, turns, runs)
  const answers = toolRowsByAssistant(msgs)
  // Consumed as they match, so two calls sharing an id cannot both claim the
  // same approval.
  const waiting = indexApprovals(pending, false)
  const bubbled = indexApprovals(pending, true)
  const delegated = indexRuns(runs)
  const reviewedPlans = indexPlanReviews(planReviews)
  const byTurn = new Map(turns.map((t) => [t.id, t]))

  return msgs.map((m) => {
    if (m.role !== 'assistant') return m

    const blocks: ContentBlock[] = []
    if (m.reasoning_content) {
      blocks.push({ type: 'thinking', text: m.reasoning_content })
    }
    if (m.content) {
      blocks.push({ type: 'text', text: m.content })
    }
    if (m.tool_calls) {
      const tcs = storedCalls(m.tool_calls) ?? []
      // Consumed as they match, for the same reason as the approvals.
      const owned = [...(answers.get(m.id) ?? [])]
      const reviewed = parseAutoReview(m.auto_review)
      for (const tc of tcs) {
        const answered = owned.findIndex((tm) => tm.tool_call_id === tc.id)
        const toolMsg = answered >= 0 ? owned.splice(answered, 1)[0] : undefined
        const stillWaiting = toolMsg ? undefined : waiting.get(m.id)?.get(tc.id)?.shift()
        // A question raised inside a delegated run, waiting on whoever is
        // reading this. Independent of the card's own status: `run_agent`
        // is still running, and that is what the card says.
        const nested = toolMsg ? undefined : bubbled.get(m.id)?.get(tc.id)?.shift()
        const run = delegated.get(m.id)?.get(tc.id)
        const planReview = reviewedPlans.get(m.id)?.get(tc.id)
        blocks.push({
          type: 'tool_call',
          data: {
            call_id: tc.id,
            tool_name: tc.function.name,
            arguments: tc.function.arguments,
            // Answered, waiting, still going, or abandoned — none of which
            // the transcript alone can tell apart.
            status: toolMsg
              ? outcomeOf(toolMsg)
              : planReview
                ? planReviewToolStatus(planReview.status)
                : stillWaiting
                  ? stillWaiting.bubbled
                    ? 'awaiting_parent'
                    : 'pending'
                  : unansweredStatus(m.turn_id, byTurn),
            result: toolMsg?.content,
            // Left off when the answer has to come from elsewhere, so that
            // "has an id" and "can be answered here" stay the same thing.
            approval_id: stillWaiting?.bubbled ? undefined : stillWaiting?.approval_id,
            plan_review_id: planReview?.review_id,
            retry_reason: stillWaiting?.retry_reason ?? undefined,
            sub_agent: run?.spawned_turn_id
              ? {
                  conversation_id: run.conversation_id,
                  turn_id: run.spawned_turn_id,
                  kind: run.agent_kind,
                  steps: run.steps,
                }
              : undefined,
            nested_approval: nested
              ? {
                  approval_id: nested.approval_id,
                  call_id: nested.provider_call_id,
                  tool_name: nested.tool_name,
                  arguments: nested.arguments,
                  retry_reason: nested.retry_reason ?? undefined,
                  sub_conversation_id: nested.sub_conversation_id ?? undefined,
                }
              : undefined,
            auto_review: reviewed[tc.id],
          },
        })
        if (toolMsg && outcomeOf(toolMsg) === 'completed' && tc.function.name === 'send_sticker') {
          const sticker = stickerBlockFrom(tc.function.arguments, toolMsg.content)
          if (sticker) blocks.push(sticker)
        }
      }
    }
    return { ...m, _blocks: blocks.length > 0 ? blocks : undefined }
  })
}

function stickerBlockFrom(
  argumentsJson: string,
  resultJson?: string,
): Extract<ContentBlock, { type: 'sticker' }> | null {
  for (const raw of [resultJson, argumentsJson]) {
    if (!raw) continue
    try {
      const value = JSON.parse(raw) as { sticker_id?: unknown; name?: unknown }
      if (typeof value.sticker_id === 'string' && value.sticker_id) {
        return {
          type: 'sticker',
          sticker_id: value.sticker_id,
          name: typeof value.name === 'string' ? value.name : undefined,
        }
      }
    } catch {
      /* tool output may be plain text */
    }
  }
  return null
}

/**
 * Reuse the previous object for every row the snapshot did not actually change.
 *
 * A snapshot from the backend deserialises into all-new objects, so assigning it
 * wholesale invalidates `React.memo` for the entire list even when only the last
 * row moved. Reusing the old reference also keeps its `_blocks`, which were built
 * incrementally from the stream.
 *
 * Rows whose stored columns did change still get the snapshot's object, and with
 * it a rebuilt `_blocks` — the streaming assistant row is the usual case, since
 * `handleReasoning` writes only to `_blocks` while the DB row carries
 * `reasoning_content`. That one row reorders on reload; the history above it does
 * not, which is what matters for list identity.
 */
export function reconcileMessages(prev: MessageViewModel[], next: MessageViewModel[]): MessageViewModel[] {
  if (prev.length === 0) return next
  const byId = new Map(prev.map((m) => [m.id, m]))
  let identical = prev.length === next.length
  const out = next.map((m, i) => {
    const old = byId.get(m.id)
    if (old && sameStoredFields(old, m) && samePlanReviewProjection(old, m)) {
      if (prev[i] !== old) identical = false
      return old
    }
    identical = false
    return old ? keepAnswered(old, m) : m
  })
  return identical ? prev : out
}

function planReviewProjection(message: MessageViewModel): string[] {
  return (message._blocks ?? []).flatMap((block) =>
    block.type === 'tool_call' && block.data.plan_review_id
      ? [`${block.data.call_id}\0${block.data.plan_review_id}\0${block.data.status}`]
      : [],
  )
}

function samePlanReviewProjection(a: MessageViewModel, b: MessageViewModel): boolean {
  const left = planReviewProjection(a)
  const right = planReviewProjection(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * A row the snapshot supersedes keeps whatever it already knew the answer to.
 *
 * The snapshot's cards are rebuilt from the database, and the database is
 * behind: a result is announced to the window before its row is written, and
 * the whole round's calls are written before any of them runs. So a read taken
 * mid-round describes calls as still going that this window has already been
 * told finished — and told once, because the event does not come again. Taking
 * the snapshot's word for it reverts a finished card to "running" for good:
 * once the turn ends the row's stored columns stop changing, so every later
 * reload reuses this same object.
 *
 * Only ever forwards. A card that has an outcome here keeps it; nothing else is
 * carried over, because for everything else the database is the one that knows.
 * Results do not un-happen, which is what makes the direction safe to assume
 * without either side carrying a timestamp.
 *
 * Matched by consuming, not by lookup: two cards under one row can share an id
 * once a snapshot and a live event have both put one there, and the second must
 * not claim the first's answer.
 */
function keepAnswered(local: MessageViewModel, fresh: MessageViewModel): MessageViewModel {
  const answered = (local._blocks ?? []).filter(
    (b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call' && ANSWERED.has(b.data.status),
  )
  if (answered.length === 0 || !fresh._blocks) return fresh
  const taken = new Set<number>()
  let carried = false
  const blocks = fresh._blocks.map((b) => {
    if (b.type !== 'tool_call' || ANSWERED.has(b.data.status)) return b
    const at = answered.findIndex((c, i) => !taken.has(i) && c.data.call_id === b.data.call_id)
    if (at < 0) return b
    taken.add(at)
    carried = true
    const was = answered[at].data
    return {
      ...b,
      data: { ...b.data, status: was.status, result: was.result, approval_id: undefined },
    }
  })
  return carried ? { ...fresh, _blocks: blocks } : fresh
}

/** Compares every persisted column, ignoring the front-end-only `_blocks`. Keys
 *  are read off the snapshot so columns the TS type does not declare yet still
 *  count. */
function sameStoredFields(a: MessageViewModel, b: MessageViewModel): boolean {
  for (const key of Object.keys(b) as (keyof MessageViewModel)[]) {
    if (key === '_blocks') continue
    if (key === 'tool_calls' || key === 'auto_review' || key === 'context_items') {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
      continue
    }
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Where a waiting card lives and what it is asking about. Everything needed to
 *  redraw it, keyed elsewhere by the `approval_id` that answers it. */
/**
 * One question waiting on a person, held where a conversation's session cannot
 * hide it.
 *
 * `pendingApprovals` on a session answers "which id is this card waiting for",
 * and is only ever written for a conversation somebody has opened —
 * `ensureSession` runs when `ChatView` mounts, and `handleToolApproval` returns
 * early without one. That is the right shape for a card and the wrong shape for
 * a queue: the whole reason a queue exists is the conversations nobody is
 * looking at, and those are exactly the ones with no session.
 *
 * So this is the answer to "what is waiting on you", indexed by `approval_id`
 * and carrying enough to draw the question outside any transcript. It is
 * populated for every conversation, open or not.
 */
interface ToolAttentionItem {
  conversationId: string
  approvalId: string
  providerCallId: string
  messageId: string
  toolName: string
  /** What the call was made with, as JSON. Kept here rather than read off the
   *  transcript for the same reason the backend sends it: the row may be in a
   *  conversation this client has never loaded. */
  arguments: string
  retryReason?: string
  /** `ask` is a question with a form behind it, which no queue row can answer —
   *  it offers a way in instead. Split here rather than by comparing the tool
   *  name at each call site. */
  kind: 'approval' | 'ask'
  /** Set when a delegated run is asking. The question is filed under the
   *  parent, but the call's result and stop land on this conversation. */
  subConversationId?: string
}

export type PlanReviewAttentionStage = 'review' | 'delivery_queued' | 'delivery_attention'

interface PlanReviewAttentionItem {
  conversationId: string
  /** Kept as the common queue key; for this variant it is the review id, not
   *  an ApprovalWaiter address. */
  approvalId: string
  reviewId: string
  documentId: string
  revisionId: string
  turnId: string
  /** Why this review is in the global queue. A submitted plan needs a review;
   *  a settled one stays here only while its continuation has not made it back
   *  to the agent. Kept separate from the conversation barrier because a
   *  dispatched delivery blocks new work without asking the user to act. */
  stage: PlanReviewAttentionStage
  kind: 'plan_review'
}

export type AttentionItem = ToolAttentionItem | PlanReviewAttentionItem

export function isAskTool(name: string): boolean {
  return name === 'ask_user' || name === 'AskUserQuestion'
}

export interface PendingApprovalEntry {
  providerCallId: string
  /** The assistant row the card sits under. Needed because a provider call id
   *  does not identify one on its own once it repeats. */
  messageId: string
  /** The call this one retries, for sandbox escalations. */
  originCallId?: string
  toolName: string
  retryReason?: string
}

export interface ConversationSession {
  messages: MessageViewModel[]
  streaming: boolean
  /** Authoritative conversation-wide plan barrier from the latest snapshot.
   *  Unlike a review card, it does not depend on the active transcript path. */
  planReviewBarrier: boolean
  /** Which run of a turn is streaming here, so a stop event can be told from
   *  someone else's. Null when nothing is running, and also for a turn that
   *  died before it wrote its first message — those send a stop with no id and
   *  are accepted on that basis. */
  activeTurnId: string | null
  /** A literal `!` command is not a model turn, but it still owns the composer
   *  and Stop button while the backend process is alive. Kept on the session
   *  so switching conversations cannot forget it. */
  activeShellTurnId: string | null
  /** A durable result revision per shell message. Cards subscribe to this
   *  narrow signal and rehydrate raw output only after the matching finish. */
  shellResultKeys: Record<string, string>
  /** A turn belonging to somebody else — a QQ session answering the same
   *  conversation — that announced itself while this window still had an
   *  optimistic turn of its own outstanding.
   *
   *  Held rather than acted on, because at that moment it is genuinely unknown
   *  which of the two owns the conversation: the local id was minted before the
   *  request was sent, and the backend has not answered yet. If the local
   *  request comes back refused, this is what was running all along and it
   *  takes over; if the local turn writes its own first message, the local one
   *  won and this is discarded. */
  candidateTurnId: string | null
  /** The request is being sent again after a failure, and this is which go.
   *
   *  Set before the backoff rather than after it, because the wait is the part
   *  anyone is actually sitting through: a turn that says nothing for it is
   *  indistinguishable from one that has hung, which is what a fixed "working…"
   *  made it look like.
   *
   *  Cleared by the first sign the new attempt is alive — text, reasoning or a
   *  tool call — and at every turn boundary. Not by the `reset` that follows it:
   *  that one only marks the end of the wait, and the request it precedes can
   *  itself take a while. */
  retry: { attempt: number; max: number; delayMs: number } | null
  compacting: boolean
  error: string | null
  fulfilledUnseen: boolean
  /** Keyed by `approval_id`. A record rather than the single slot this used to
   *  be: nothing stops a turn from having two questions outstanding, and the
   *  old slot silently dropped the first one. */
  pendingApprovals: Record<string, PendingApprovalEntry>
  pendingAsks: Record<string, PendingApprovalEntry>
  generation: number
  /** The checklist the model is working through, or null when there is none. */
  activeTodos: TodoArgs | null
  /** Turns the user opened or closed by hand, keyed by turn id. Absent means
   *  "follow the automatic policy"; once a turn appears here it keeps whatever
   *  the user chose. Lives on the session so the choice survives switching
   *  conversations and back. */
  expandedTurns: Record<string, boolean>
  /** Steps on the path with more than one version, keyed by the version
   *  currently shown. Empty until something has been regenerated. */
  branches: Record<string, BranchPointInfoResponse>
  /** True while a switch is in flight, so the pager cannot be clicked again
   *  before the new path lands. */
  switchingBranch: boolean
  /** How each run of the agent loop ended, as the backend judged it.
   *
   *  Not derivable here. A turn that stopped without recording an ending leaves
   *  rows that look exactly like a turn that ended on a tool call, and only the
   *  backend's live register of what is running can say which. Empty until the
   *  first snapshot lands, which reads as "no opinion" everywhere. */
  turns: TurnInfoResponse[]
}

function defaultSession(): ConversationSession {
  return {
    messages: [],
    streaming: false,
    planReviewBarrier: false,
    activeTurnId: null,
    activeShellTurnId: null,
    shellResultKeys: {},
    candidateTurnId: null,
    retry: null,
    compacting: false,
    error: null,
    fulfilledUnseen: false,
    pendingApprovals: {},
    pendingAsks: {},
    generation: 0,
    activeTodos: null,
    expandedTurns: {},
    branches: {},
    switchingBranch: false,
    turns: [],
  }
}

/**
 * Take a question out of the queue, wherever it was answered.
 *
 * Called from every path that retires an approval, including the ones that run
 * for a conversation with no session — those are the paths that used to leave
 * nothing behind, because the only record was on the session. A no-op for an id
 * that was never queued, which is the common case: the queue skips the
 * conversation the reader is already looking at.
 */
function retireAttention(state: ConversationStore, approvalId: string) {
  if (!state.attention[approvalId]) return
  delete state.attention[approvalId]
  state.attentionOrder = state.attentionOrder.filter((id) => id !== approvalId)
}

function planReviewAttentionStage(
  review: Pick<PlanReviewSummaryInfoResponse, 'status' | 'delivery_state'>,
): PlanReviewAttentionStage | null {
  if (review.status === 'pending') return 'review'
  if (review.delivery_state === 'queued') return 'delivery_queued'
  if (review.delivery_state === 'held' || review.delivery_state === 'in_doubt') return 'delivery_attention'
  return null
}

function applyPlanReviewAttention(
  state: ConversationStore,
  conversationId: string,
  reviews: PlanReviewSummaryInfoResponse[],
) {
  const current = Object.values(state.attention).filter(
    (item): item is PlanReviewAttentionItem => item.kind === 'plan_review' && item.conversationId === conversationId,
  )
  const required = new Set(
    reviews.filter((review) => planReviewAttentionStage(review) !== null).map((review) => review.review_id),
  )
  for (const item of current) {
    if (!required.has(item.reviewId)) retireAttention(state, item.approvalId)
  }
  for (const review of reviews) {
    const stage = planReviewAttentionStage(review)
    if (stage === null) continue
    state.attention[review.review_id] = {
      approvalId: review.review_id,
      reviewId: review.review_id,
      conversationId: review.conversation_id,
      documentId: review.document_id,
      revisionId: review.revision_id,
      turnId: review.turn_id,
      stage,
      kind: 'plan_review',
    }
    if (!state.attentionOrder.includes(review.review_id)) state.attentionOrder.push(review.review_id)
  }
}

function applyPendingApprovals(session: ConversationSession, pending: PendingApprovalInfoResponse[]) {
  session.pendingApprovals = {}
  session.pendingAsks = {}
  for (const row of pending) {
    if (row.bubbled) continue
    const entry: PendingApprovalEntry = {
      providerCallId: row.provider_call_id,
      messageId: row.assistant_message_id,
      originCallId: row.origin_call_id ?? undefined,
      toolName: row.tool_name,
      retryReason: row.retry_reason ?? undefined,
    }
    if (isAskTool(row.tool_name)) session.pendingAsks[row.approval_id] = entry
    else session.pendingApprovals[row.approval_id] = entry
  }
}

function dropNested(state: ConversationStore, approvalId: string) {
  for (const session of Object.values(state.sessions)) {
    for (const m of session.messages) {
      for (const b of m._blocks ?? []) {
        if (b.type === 'tool_call' && b.data.nested_approval?.approval_id === approvalId) {
          b.data.nested_approval = undefined
        }
      }
    }
  }
}

function indexBranches(points: BranchPointInfoResponse[]): Record<string, BranchPointInfoResponse> {
  const entries = points.map((value, pointIndex) => {
    const point = requireExactKeys(
      value,
      ['message_id', 'index', 'total', 'sibling_ids'],
      `message tree.branches[${pointIndex}]`,
    )
    if (typeof point.message_id !== 'string' || !point.message_id) {
      throw new Error(`message tree.branches[${pointIndex}].message_id is invalid`)
    }
    if (!Number.isInteger(point.index) || !Number.isInteger(point.total) || (point.total as number) < 2) {
      throw new Error(`message tree.branches[${pointIndex}] has invalid pagination`)
    }
    const index = point.index as number
    const total = point.total as number
    if (!Array.isArray(point.sibling_ids) || point.sibling_ids.some((id) => typeof id !== 'string' || !id)) {
      throw new Error(`message tree.branches[${pointIndex}].sibling_ids is invalid`)
    }
    if (
      point.sibling_ids.length !== total ||
      index < 0 ||
      index >= total ||
      point.sibling_ids[index] !== point.message_id ||
      new Set(point.sibling_ids).size !== point.sibling_ids.length
    ) {
      throw new Error(`message tree.branches[${pointIndex}] is inconsistent`)
    }
    return [point.message_id, point as unknown as BranchPointInfoResponse] as const
  })
  if (new Set(entries.map(([messageId]) => messageId)).size !== entries.length) {
    throw new Error('message tree.branches contains duplicate message ids')
  }
  return Object.fromEntries(entries)
}

/**
 * Follow a turn this session never saw start.
 *
 * `streaming` is set when this window sends and cleared when the stop for that
 * turn arrives, which covers the whole life of a turn — but only for the window
 * that sent it. A session built after the fact knows nothing: a reload during a
 * long answer, or opening a conversation another window (or a QQ session) is
 * already answering. The composer would be unlocked, the turn would render as a
 * finished empty answer, and the send it invites is one the backend refuses with
 * "this conversation is already answering".
 *
 * `running` in a snapshot is exactly the signal needed, and is stronger than the
 * stored column: the backend replaces it with `interrupted` for any turn its
 * coordinator is not currently holding, so a row left behind by a killed process
 * never reads this way. A `running` turn is one somebody is running now.
 *
 * Adopts, never releases: a snapshot fetched between `beginTurn` and the backend
 * writing the turn record shows nothing running, and unlocking on that would
 * undo the lock the send just took. Ending a turn stays the stop event's job.
 *
 * And it keeps out of the way of a session that is already following one. A
 * window with its own turn outstanding may well see somebody else's named here —
 * that is the same ambiguity `handleMessageStart` refuses to resolve, because at
 * that moment the local id was minted before the request went out and nobody
 * knows which of the two holds the conversation. Overwriting from a snapshot
 * would resolve it by guessing, and hand the wrong turn's stop the power to
 * unlock the composer.
 */
function adoptLiveTurn(session: ConversationSession, turns: TurnInfoResponse[]): void {
  if (session.streaming) return
  // The most recent, on the off chance there is more than one. The coordinator
  // allows a conversation only one live turn, so this is belt and braces.
  const running = turns.filter((t) => t.status === 'running')
  const live = running[running.length - 1]
  if (!live) return
  session.streaming = true
  session.activeTurnId = live.id
}

// A DB snapshot can be stale while a stream is in flight: the streaming assistant
// row still has empty content in the DB, and a just-sent user bubble may not be
// persisted yet. Keep the local versions of those instead of overwriting them.
function mergeSnapshot(session: ConversationSession, snapshot: MessageViewModel[]): MessageViewModel[] {
  if (!session.streaming) return snapshot
  const local = session.messages
  const snapshotIds = new Set(snapshot.map((m) => m.id))
  const merged = snapshot.map((m) => {
    if (m.role === 'assistant' && !m.content && !m.tool_calls) {
      const lm = local.find((x) => x.id === m.id)
      if (lm?._blocks?.length) return lm
    }
    return m
  })
  const persistedUserContents = new Set(snapshot.filter((m) => m.role === 'user').map((m) => m.content))
  let lastAssistant: MessageViewModel | undefined
  for (let i = local.length - 1; i >= 0; i--) {
    if (local[i].role === 'assistant') {
      lastAssistant = local[i]
      break
    }
  }
  for (const lm of local) {
    if (snapshotIds.has(lm.id)) continue
    if (lm.id.startsWith('temp-user-')) {
      if (!persistedUserContents.has(lm.content)) merged.push(lm)
    } else if (lm === lastAssistant && lm._blocks?.length) {
      merged.push(lm)
    }
  }
  return merged
}

function findAssistantMsg(msgs: MessageViewModel[], messageId?: string): number {
  if (messageId) {
    const idx = msgs.findIndex((m) => m.id === messageId)
    if (idx >= 0) return idx
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return i
  }
  return -1
}

export interface ConversationStore {
  conversations: ConversationInfoResponse[]
  activeId: string | null
  projects: ProjectInfoResponse[]
  activeProjectId: string | null

  sessions: Record<string, ConversationSession>

  /** How many iterations each delegated run has taken, keyed by the run's turn.
   *
   *  Not per session, and not counted off the sub-agent's message list: that
   *  list also holds whatever the user typed into the run afterwards, and the
   *  card is reporting on one delegation rather than on a conversation. Keyed
   *  by turn, only runs that have announced themselves are counted, so this
   *  cannot fill up with every turn in the app. */
  subAgentSteps: Record<string, number>

  /** Every question waiting on a person, keyed by `approval_id`. See
   *  `AttentionItem` for why this is not on the session. */
  attention: Record<string, AttentionItem>
  /** The order they are offered in. Separate from `attention` because the queue
   *  can be reordered without anything about the questions changing: deferring
   *  one moves it to the end and nothing else. */
  attentionOrder: string[]

  /** Where the reader came from, innermost last. Empty whenever they are
   *  looking at something they picked from the sidebar.
   *
   *  An explicit stack rather than following `parent_conversation_id` back up:
   *  the two answer different questions. The parent link says who spawned this,
   *  which is not necessarily who was on screen a moment ago. */
  // TODO: this is a second navigation stack. `stores/nav-store.ts` owns the
  // real one — routes plus in-screen guards, with `lib/history-bridge.ts` as
  // the only writer of `window.history` and the only listener of `popstate`,
  // tied together by `depth === stack.length - 1 + guards.length`. Two stacks
  // means one back gesture with two truths: the system back key on mobile
  // unwinds nav-store's and leaves this one where it was.
  //
  // Fix is to drill in through nav-store — most likely a `NavEntry` variant
  // carrying the conversation id — and delete these three. Read the depth
  // invariant before adding a level to it: getting that wrong is a back key
  // that goes somewhere nobody asked for.
  //
  // Left standing for now because the only way to notice is the system back key
  // on a phone, and the whole navigation layer is about to be rewritten with
  // HeroUI Pro.
  navigationStack: string[]

  setActiveId: (id: string | null) => void
  /** Drill into a conversation, remembering the way back. */
  openConversation: (id: string) => void
  goBack: () => void
  setActiveProjectId: (id: string | null) => void
  refreshConversations: () => Promise<ConversationInfoResponse[]>
  refreshProjects: () => Promise<void>
  resyncAfterReconnect: () => Promise<void>

  ensureSession: (convId: string) => void
  /** Reload the active path and live shell lease. False means a newer event
   *  superseded the response before it could be applied. */
  loadMessages: (convId: string) => Promise<boolean>
  switchBranch: (convId: string, messageId: string) => Promise<void>

  /** Lock the composer and name the turn in one step, before the request goes
   *  out. Naming it only when the first message arrives would leave a stretch —
   *  lease, assistant, provider config, possibly a whole compaction — where the
   *  session is streaming under no id at all, and any stop landing there, the
   *  previous turn's included, would be taken for this one's. */
  beginTurn: (convId: string, turnId: string) => void
  /** The request never got off the ground. Identity-checked like a stop: a
   *  rejection that lands after the user has already resent must not unlock the
   *  composer on the turn that replaced it — nor report its failure against it,
   *  which is why the message is written here rather than by a separate
   *  `setError` the caller makes first. */
  abortTurn: (convId: string, turnId: string, error?: string) => void
  beginShellCommand: (convId: string, turnId: string) => void
  abortShellCommand: (convId: string, turnId: string, error?: string) => void
  finishShellCommand: (result: UserCommandResultResponse) => void
  handleMessageStart: (convId: string, messageId: string, turnId?: string) => void
  handleUserMessage: (convId: string, messageId: string, content: string) => void
  handleText: (convId: string, messageId: string, content: string) => void
  handleReasoning: (convId: string, messageId: string, content: string) => void
  handleToolCall: (convId: string, messageId: string, callId: string, toolName: string, args: string) => void
  /** A card already drawn now knows what it is. Hosted ACP sessions announce a
   *  call as soon as one is coming, which can be before its arguments have
   *  finished streaming — so the first draw can say "Terminal" with nothing in
   *  it. Safe to match by id there, and only there: an ACP `toolCallId` is
   *  unique within its session, while a provider call id is not. */
  reviseToolCall: (convId: string, messageId: string, callId: string, toolName: string, args: string) => void
  handleToolApproval: (
    convId: string,
    messageId: string,
    approvalId: string,
    callId: string,
    toolName: string,
    /** What the call was made with. Recorded even for a conversation with no
     *  session, which is why it is not optional: the queue draws from it, and a
     *  row that can only say "run_command" is a yes/no about nothing. */
    args: string,
    retryReason?: string,
    originCallId?: string,
    /** Set when a delegated run is asking. The card is the `run_agent` block
     *  named by this, and the question goes inside it — `callId` names a tool
     *  in the sub-agent's conversation, which this row never called. */
    bubble?: { parentCallId: string; subConversationId?: string },
  ) => void
  handlePlanReviewEvent: (event: PlanReviewEventInfo) => void
  /** A delegated run now exists. Arrives as soon as its conversation is
   *  written, not when it finishes, because the card has to be able to link to
   *  it and count its steps for the whole time it is running. */
  handleSubAgentStarted: (
    convId: string,
    messageId: string,
    callId: string,
    run: { conversationId: string; turnId: string; kind: SubAgentKind },
  ) => void
  /** The nested question has an answer, or can no longer get one. Cross-
   *  conversation events cannot do this: the sub-agent's tool result is emitted
   *  on its own conversation, which the parent's session never sees. */
  resolveNestedApproval: (convId: string, approvalId: string) => void
  handleToolResult: (convId: string, messageId: string, callId: string, result: string, outcome?: string) => void
  /** A tool call the automatic reviewer decided instead of the user. Arrives
   *  for calls that were never drawn as pending — nobody was asked — so it is
   *  the only event that will ever say why one of them was refused. */
  handleAutoReview: (convId: string, messageId: string, callId: string, verdict: AutoReviewVerdictInfoResponse) => void
  /** The answer never landed — the backend has forgotten this request. Drops
   *  the buttons rather than leaving one that cannot work. Takes no
   *  conversation id: the approval id is a UUID, and a tool card does not know
   *  which conversation it is being rendered in. */
  markApprovalOrphaned: (approvalId: string) => void
  /** An answer has been sent. Takes the question out of the queue and off
   *  whichever card was offering it, without touching the call's status — the
   *  tool is about to run, and its result is what says how it went.
   *
   *  Called rather than waited for, because for a delegated run no event will
   *  ever arrive to do it. The question is filed under the conversation it was
   *  *asked* in (the parent's, see `approval_adapter.rs`) while its result and
   *  its stop are emitted on the sub-agent's own conversation, and both
   *  `handleToolResult` and `handleStop` retire by conversation. Left to them,
   *  a delegated approval answered anywhere would sit in the queue for the rest
   *  of the session with the sidebar insisting its parent needs attention.
   *
   *  Also right for an ordinary approval, where the result *will* arrive: it
   *  can be minutes away — `run_command` — and none of that time is time
   *  anybody is being asked for anything. */
  /** Nobody answered inside the deadline, so the question is over.
   *
   *  Distinct from `retireAnsweredApproval`, which only clears the queue: that
   *  one leaves an ordinary card holding its `approval_id` because the question
   *  is still owed. Here it is not, so the card is settled too — left `pending`
   *  with no id it would draw as `requires-action`, demanding an answer that
   *  can no longer reach anybody. */
  handleApprovalExpired: (convId: string, approvalId: string) => void
  retireAnsweredApproval: (approvalId: string) => void
  /** Not now — move it to the end of the queue and offer the next one.
   *
   *  Deliberately not a dismissal. The question is still outstanding and the
   *  sidebar still says so; going round the queue brings it back. A queue whose
   *  only way past an item is answering it stops being usable at three items,
   *  and one where "later" meant "gone" would make a mis-click cost a turn. */
  deferAttention: (approvalId: string) => void
  /** Rebuild the queue from the backend's live register.
   *
   *  Every entry in it was announced by an event that is not replayed, so a
   *  window that reloaded or a client that has just connected has no other way
   *  to learn about a conversation that is holding a turn open. Reconciles both
   *  ways, but only against what was queued when the request went out — events
   *  landing while it is in flight are newer than the answer. */
  loadAllPending: () => Promise<void>
  /** The request failed and is going again. Arrives before the backoff, so what
   *  it describes is the wait as well as the attempt. */
  handleRetry: (convId: string, attempt: number, max: number, delayMs: number) => void
  handleStreamReset: (convId: string, messageId: string) => void
  /** `turnId` names the run that stopped. A stop for a run this session is not
   *  showing still reloads — the transcript changed either way — but must not
   *  clear the streaming flag or the approvals of the turn that is showing. */
  handleStop: (convId: string, turnId?: string) => void
  handleCompactStart: (convId: string) => void
  /** `midTurn` marks a compaction that only rewrote the request in memory. It
   *  wrote nothing, so re-reading the transcript would return what is already
   *  on screen -- at the cost of a full snapshot of a conversation big enough
   *  to have needed compacting, in the middle of a stream. */
  handleCompactDone: (convId: string, midTurn?: boolean) => void

  setStreaming: (convId: string, value: boolean) => void
  setCompacting: (convId: string, value: boolean) => void
  setError: (convId: string, error: string | null) => void
  setActiveTodos: (convId: string, todos: TodoArgs | null) => void
  loadActiveTodos: (convId: string) => Promise<void>
  markSeen: (convId: string) => void
  setTurnExpanded: (convId: string, turnId: string, expanded: boolean) => void
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  activeId: null,
  projects: [],
  subAgentSteps: {},
  attention: {},
  attentionOrder: [],
  navigationStack: [],
  activeProjectId: null,
  sessions: {},

  setActiveId: (id) => {
    // A sideways move, so the way back to wherever the reader had drilled down
    // from no longer means anything.
    set({ activeId: id, navigationStack: [] })
    if (id) get().markSeen(id)
  },

  openConversation: (id) => {
    const { activeId } = get()
    set((s) => ({
      activeId: id,
      navigationStack: activeId ? [...s.navigationStack, activeId] : s.navigationStack,
    }))
    get().markSeen(id)
  },

  goBack: () => {
    const stack = get().navigationStack
    const to = stack[stack.length - 1]
    if (!to) return
    set({ activeId: to, navigationStack: stack.slice(0, -1) })
    get().markSeen(to)
  },

  setActiveProjectId: (id) => {
    set({ activeProjectId: id, activeId: null, navigationStack: [] })
  },

  /**
   * Rebuild from the server after a connection came back.
   *
   * Events are not replayed, so anything that happened while the socket was
   * down is simply gone — and the one that matters is `stop`. Missing it leaves
   * a session marked `streaming` for ever: the composer stays locked and the
   * transcript keeps waiting for an answer that arrived while nobody was
   * listening.
   *
   * Clearing the flag first is what makes the reload able to fix it.
   * `adoptLiveTurn` returns early when a session already claims to be
   * streaming — correct when a live stream is feeding it, wrong here, where
   * that claim is exactly the thing that cannot be trusted. Cleared, the
   * snapshot's turn records decide instead: still `running` and it comes back,
   * finished and it does not.
   */
  resyncAfterReconnect: async () => {
    const { activeId } = get()
    set(
      produce((state: ConversationStore) => {
        for (const session of Object.values(state.sessions)) {
          session.streaming = false
          session.activeTurnId = null
          session.candidateTurnId = null
        }
      }),
    )
    await get().refreshConversations()
    if (activeId) await get().loadMessages(activeId)
  },

  refreshConversations: async () => {
    // Every conversation, never a project's slice of them. The sidebar nests
    // them under their project rather than filtering to one, so a slice would
    // draw a tree with most of its branches missing.
    //
    // It also closes half of a hole several readers had: `use-turn-settings`,
    // the header title and the notification title all look the active
    // conversation up in this array, so opening one from outside the selected
    // project — the command palette reaches any of them — used to find nothing
    // and fall back to defaults. The other half, sub-agent conversations, is
    // filtered out in SQL and still missing; see the TODO in
    // `use-turn-settings.ts`.
    //
    // TODO: archived conversations are currently unreachable in the UI. There
    // is no archive/unarchive command either — `is_archived` is only ever read
    // while rendering. Both belong in one change.
    const conversations: ConversationInfoResponse[] = await api.listConversations()
    set({ conversations })
    return conversations
  },

  refreshProjects: async () => {
    const projects = await api.listProjects()
    set({ projects })
  },

  ensureSession: (convId) => {
    set(
      produce((state: ConversationStore) => {
        if (!state.sessions[convId]) {
          state.sessions[convId] = defaultSession()
        }
      }),
    )
  },

  loadMessages: async (convId) => {
    const generation = get().sessions[convId]?.generation ?? 0
    // One request, because these four things only mean anything together. A
    // tool call with no result row is either waiting on the user, still running,
    // or was abandoned when its turn died — identical in the database, and told
    // apart only by the approvals and the turn records that came back with it.
    const [snap, activeShellTurnId] = await Promise.all([
      api.conversationSnapshot({ conversationId: convId }),
      api.activeUserShellTurn(convId),
    ])
    // Reconciled outside produce: comparing against immer drafts would pit proxy
    // references against plain ones.
    const snapshot = reconcileMessages(
      get().sessions[convId]?.messages ?? [],
      hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs, snap.plan_reviews),
    )
    let applied = false
    set(
      produce((state: ConversationStore) => {
        if (!state.sessions[convId]) {
          state.sessions[convId] = defaultSession()
        }
        const session = state.sessions[convId]
        // A turn started while the request was in flight. Its own events describe
        // the conversation better than this snapshot does, and the approvals it
        // just registered are not in there.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
        session.planReviewBarrier = snap.plan_review_barrier
        session.branches = indexBranches(snap.tree.branches)
        session.turns = snap.turns
        session.activeShellTurnId = activeShellTurnId
        adoptLiveTurn(session, snap.turns)
        applyPendingApprovals(session, snap.pending_approvals)
        applyPlanReviewAttention(state, convId, snap.plan_reviews)
        applied = true
      }),
    )
    if (applied) usePlanReviewStore.getState().rememberSummaries(snap.plan_reviews)
    return applied
  },

  /** Show a different version of a step. The reply is the whole new path, so
   *  there is never a frame where the pagers describe messages that are no
   *  longer on screen. */
  switchBranch: async (convId, messageId) => {
    const generation = get().sessions[convId]?.generation ?? 0
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.switchingBranch = true
      }),
    )
    let superseded = false
    try {
      // The switch moves the head; the snapshot afterwards is what the new path
      // actually is. Sequential rather than parallel because the second reads
      // what the first wrote — which is also what makes the window here wider
      // than anywhere else, hence the guard below.
      await api.switchBranch({ conversationId: convId, messageId })
      const snap = await api.conversationSnapshot({ conversationId: convId })
      const snapshot = reconcileMessages(
        get().sessions[convId]?.messages ?? [],
        hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs, snap.plan_reviews),
      )
      let applied = false
      set(
        produce((state: ConversationStore) => {
          const session = state.sessions[convId]
          if (!session) return
          // A turn started across two round trips. This snapshot predates it, and
          // this path assigns outright rather than merging — so applying it would
          // not just be stale, it would delete the rows that turn has already
          // streamed in.
          if (session.generation !== generation) {
            superseded = true
            return
          }
          // Replaced outright, not merged: what is local belongs to the branch
          // being left, and splicing it in would carry messages across.
          session.messages = snapshot
          session.planReviewBarrier = snap.plan_review_barrier
          session.branches = indexBranches(snap.tree.branches)
          session.turns = snap.turns
          adoptLiveTurn(session, snap.turns)
          applyPendingApprovals(session, snap.pending_approvals)
          applyPlanReviewAttention(state, convId, snap.plan_reviews)
          session.expandedTurns = {}
          applied = true
        }),
      )
      if (applied) usePlanReviewStore.getState().rememberSummaries(snap.plan_reviews)
    } finally {
      set(
        produce((state: ConversationStore) => {
          const session = state.sessions[convId]
          if (session) session.switchingBranch = false
        }),
      )
    }
    // The head really did move, so what is on screen is a path the server no
    // longer agrees with. Read it again under whatever generation is current
    // now — `loadMessages` merges, which is what a live turn needs, and takes
    // its own generation so this cannot loop.
    if (superseded) await get().loadMessages(convId)
  },

  beginTurn: (convId, turnId) => {
    set(
      produce((state: ConversationStore) => {
        if (!state.sessions[convId]) {
          state.sessions[convId] = defaultSession()
        }
        const session = state.sessions[convId]
        session.streaming = true
        session.activeTurnId = turnId
        session.retry = null
        // The guard means "a turn started while your request was in flight", and
        // this is where a turn starts. Leaving it to the first `message_start`
        // would let a reload fetched before the user sent — the one the previous
        // turn's stop kicked off, say — pass the check and land on top of the
        // bubble they have just added.
        session.generation += 1
        session.error = null
      }),
    )
  },

  abortTurn: (convId, turnId, error) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // Somebody else's failure. The turn on screen is not the one that just
        // rejected: unlocking the composer would invite a send the backend would
        // only refuse, and writing the message would report a dead turn's error
        // against a live one.
        if (session.activeTurnId !== null && session.activeTurnId !== turnId) return
        if (error !== undefined) session.error = error
        // Refused because somebody else had the conversation, and that somebody
        // has already announced itself. The composer stays locked and the session
        // follows the turn that actually owns it — this is the answer the user is
        // about to see arriving.
        if (session.candidateTurnId) {
          session.activeTurnId = session.candidateTurnId
          session.candidateTurnId = null
          return
        }
        session.streaming = false
        session.activeTurnId = null
        session.retry = null
      }),
    )
  },

  beginShellCommand: (convId, turnId) => {
    set(
      produce((state: ConversationStore) => {
        if (!state.sessions[convId]) state.sessions[convId] = defaultSession()
        const session = state.sessions[convId]
        if (session.activeShellTurnId !== turnId) session.generation += 1
        session.activeShellTurnId = turnId
        session.error = null
      }),
    )
  },

  abortShellCommand: (convId, turnId, error) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session || session.activeShellTurnId !== turnId) return
        session.activeShellTurnId = null
        session.generation += 1
        if (error !== undefined) session.error = error
      }),
    )
  },

  finishShellCommand: (result) => {
    set(
      produce((state: ConversationStore) => {
        if (!state.sessions[result.conversation_id]) state.sessions[result.conversation_id] = defaultSession()
        const session = state.sessions[result.conversation_id]
        session.shellResultKeys ||= {}
        const resultKey = [
          result.turn_id,
          result.retry_without_sandbox ? 'retry' : 'sandbox',
          result.status,
          result.exit_code ?? '',
          result.timed_out ? 'timeout' : '',
          result.truncated ? 'truncated' : '',
          result.duration_ms,
        ].join(':')
        if (session.shellResultKeys[result.message_id] !== resultKey) {
          session.shellResultKeys[result.message_id] = resultKey
          // A finish can race the first post-reload hydrate, when this session
          // does not know the active shell id yet. The durable result is still
          // a newer fact and must invalidate that older active-id query.
          session.generation += 1
        }
        if (session.activeShellTurnId !== result.turn_id) return
        session.activeShellTurnId = null
      }),
    )
  },

  handleMessageStart: (convId, messageId, turnId) => {
    set(
      produce((state: ConversationStore) => {
        // One iteration of a delegated run. Only runs that announced themselves
        // have a key here, so ordinary turns are not counted and the map stays
        // the size of the delegations this session has seen.
        if (turnId && state.subAgentSteps[turnId] !== undefined) {
          state.subAgentSteps[turnId] += 1
        }
        if (!state.sessions[convId]) {
          state.sessions[convId] = defaultSession()
        }
        const session = state.sessions[convId]
        // A message_start naming a turn this session is not showing does not get
        // to take the session: the id on screen may belong to a turn that is
        // still streaming, and letting this one in would hand the stop that
        // follows it the power to end that turn.
        //
        // But it is not necessarily stale either. The local id is minted before
        // the request goes out, so it may name a turn the backend has not
        // accepted — and this event may be the turn that actually holds the
        // conversation. So it is remembered, and `abortTurn` promotes it if the
        // local request comes back refused.
        //
        // The row is recorded either way: text for it may be behind it in the
        // queue, and with no row to find, `findAssistantMsg` would append that
        // text to whatever row happens to be last.
        const foreign = turnId && session.activeTurnId && session.activeTurnId !== turnId
        if (foreign) {
          session.candidateTurnId = turnId
        } else {
          session.streaming = true
          // Left alone when the event carries no id, rather than cleared: an
          // unnamed turn is not evidence that the named one ended.
          if (turnId) session.activeTurnId = turnId
          // Our own turn wrote a message, so it did get the conversation and
          // whatever was being held cannot have had it.
          session.candidateTurnId = null
          session.generation += 1
        }
        session.messages.push({
          id: messageId,
          conversation_id: convId,
          role: 'assistant',
          content: '',
          provider_id: null,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          cache_write_tokens: null,
          provider_name: null,
          tool_calls: null,
          tool_call_id: null,
          sort_order: session.messages.length,
          created_at: Date.now(),
          reasoning_content: null,
          rating: null,
          is_compact_summary: false,
          sender_id: null,
          parent_id: null,
          compact_anchor_id: null,
          source: null,
          turn_id: null,
          tool_outcome: null,
          auto_review: null,
          context_items: [],
        })
      }),
    )
  },

  // A message from the *user* that this window did not send: a queued
  // interjection, delivered into a turn that was already running.
  //
  // The composer appends what it sends itself, so nothing else needs this — but
  // an interjection is sent by the runner, minutes after it was typed and
  // possibly from another device. Without it the agent visibly changes course
  // with nothing on screen to say why, until the conversation is reloaded.
  handleUserMessage: (convId, messageId, content) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // The backend writes the row once and may announce it more than once —
        // a resync after a reconnect replays nothing, but `queue-updated` and
        // this can both land for the same delivery.
        if (session.messages.some((m) => m.id === messageId)) return
        session.messages.push({
          id: messageId,
          conversation_id: convId,
          role: 'user',
          content,
          provider_id: null,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          cache_write_tokens: null,
          provider_name: null,
          tool_calls: null,
          tool_call_id: null,
          sort_order: session.messages.length,
          created_at: Date.now(),
          reasoning_content: null,
          rating: null,
          is_compact_summary: false,
          sender_id: null,
          parent_id: null,
          compact_anchor_id: null,
          source: null,
          turn_id: null,
          tool_outcome: null,
          auto_review: null,
          context_items: [],
        })
      }),
    )
  },

  handleText: (convId, messageId, content) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        const idx = findAssistantMsg(session.messages, messageId)
        if (idx < 0) return
        const target = session.messages[idx]
        const blocks = target._blocks ?? []
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text') {
          last.text += content
        } else {
          blocks.push({ type: 'text', text: content })
        }
        target._blocks = blocks
        target.content += content
        session.retry = null
      }),
    )
  },

  handleReasoning: (convId, messageId, content) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        const idx = findAssistantMsg(session.messages, messageId)
        if (idx < 0) return
        const target = session.messages[idx]
        const blocks = target._blocks ?? []
        const last = blocks[blocks.length - 1]
        if (last?.type === 'thinking') {
          last.text += content
        } else {
          blocks.push({ type: 'thinking', text: content })
        }
        target._blocks = blocks
        session.retry = null
      }),
    )
  },

  handleToolCall: (convId, messageId, callId, toolName, args) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        const idx = findAssistantMsg(session.messages, messageId)
        if (idx < 0) return
        const target = session.messages[idx]
        const blocks = target._blocks ?? []
        target._blocks = blocks
        session.retry = null
        // The card may be here already. A reload that read the database after
        // this row's `tool_calls` column was written rebuilds every card in the
        // round from it, and that snapshot can be applied after this event was
        // sent and before it was handled. Pushing regardless leaves a second copy
        // that nothing will ever answer: results go to the first unanswered card
        // with the id, and the rebuilt one is always ahead of this.
        //
        // But two cards can also share an id honestly — gateways that number
        // their calls per request repeat "0" within one, and the tests below
        // hold that behaviour — so this cannot be a lookup by id. The column
        // decides instead: it is written once, with every call the round made,
        // and a row carrying it has had all of them drawn already. A row still
        // being streamed into has no column yet, which is the whole live path.
        //
        // Malformed is not the same as present: hydration would have drawn
        // nothing from it, so there is nothing here to duplicate.
        if (storedCalls(target.tool_calls)) return
        blocks.push({
          type: 'tool_call',
          data: {
            call_id: callId,
            tool_name: toolName,
            arguments: args,
            status: 'running',
          },
        })
      }),
    )
  },

  reviseToolCall: (convId, messageId, callId, toolName, args) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        const idx = findAssistantMsg(session.messages, messageId)
        if (idx < 0) return
        const target = session.messages[idx]
        // The first card with this id that has not been answered. Unanswered
        // matters: a revision arriving late must not reopen a call that has
        // already produced its result.
        const card = (target._blocks ?? []).find(
          (b) => b.type === 'tool_call' && b.data.call_id === callId && !ANSWERED.has(b.data.status),
        )
        if (card?.type !== 'tool_call') return
        card.data.tool_name = toolName
        card.data.arguments = args
      }),
    )
  },

  handleToolApproval: (convId, messageId, approvalId, callId, toolName, args, retryReason, originCallId, bubble) => {
    set(
      produce((state: ConversationStore) => {
        // Before the session check below, and that ordering is the point: a
        // conversation nobody has opened has no session, and it is precisely
        // those conversations the queue exists for. Everything after this line
        // is about a card that may not exist.
        if (!state.attention[approvalId]) {
          state.attention[approvalId] = {
            conversationId: convId,
            approvalId,
            providerCallId: callId,
            messageId,
            toolName,
            arguments: args,
            retryReason,
            kind: isAskTool(toolName) ? 'ask' : 'approval',
            subConversationId: bubble?.subConversationId,
          }
          state.attentionOrder.push(approvalId)
        }

        const session = state.sessions[convId]
        if (!session) return
        const entry: PendingApprovalEntry = {
          providerCallId: callId,
          messageId,
          originCallId,
          toolName,
          retryReason,
        }
        if (isAskTool(toolName)) {
          session.pendingAsks[approvalId] = entry
        } else {
          session.pendingApprovals[approvalId] = entry
        }
        // A delegated run's question. It goes inside the `run_agent` card rather
        // than onto one of its own: the call it names happened in another
        // conversation, and this row has no block for it.
        if (bubble) {
          const parent = session.messages.find((m) => m.id === messageId)
          const host = (parent?._blocks ?? []).find(
            (b) => b.type === 'tool_call' && b.data.call_id === bubble.parentCallId,
          )
          if (host?.type === 'tool_call') {
            host.data.nested_approval = {
              approval_id: approvalId,
              call_id: callId,
              tool_name: toolName,
              arguments: args,
              retry_reason: retryReason,
              sub_conversation_id: bubble.subConversationId,
            }
          }
          return
        }
        // Only under the assistant row that asked, and only a card still
        // outstanding — scanning the whole transcript, which this used to do,
        // lights up every card sharing the id, and gateways that restart theirs
        // at "0" make that routine.
        //
        // Past that the two kinds of question want different cards. A first ask
        // wants one nobody has claimed, so two asks in a row land on two cards.
        // A sandbox escalation is the second question about a call that was
        // already approved and has already run: its card is claimed by
        // construction, so asking for an unclaimed one finds nothing and leaves
        // the card saying "running" while the backend waits for an answer the
        // user is never offered. Reopening the conversation used to be the only
        // way out, because hydration matches on the call id and does not care who
        // claimed it.
        const target = session.messages.find((m) => m.id === messageId)
        const card = (target?._blocks ?? []).find(
          (b) =>
            b.type === 'tool_call' &&
            b.data.call_id === callId &&
            !ANSWERED.has(b.data.status) &&
            (retryReason !== undefined || (!b.data.approval_id && b.data.status !== 'pending')),
        )
        if (card?.type === 'tool_call') {
          // Whatever it was holding has been answered and acted on already — that
          // is how the call got as far as being refused. Leaving the entry would
          // keep the sidebar claiming this conversation needs attention twice.
          if (card.data.approval_id) {
            delete session.pendingApprovals[card.data.approval_id]
            delete session.pendingAsks[card.data.approval_id]
          }
          card.data.status = 'pending'
          card.data.approval_id = approvalId
          card.data.retry_reason = retryReason
        }
      }),
    )
  },

  handlePlanReviewEvent: (event) => {
    const barrier = Object.values(usePlanReviewStore.getState().summaries).some(
      (review) =>
        review.conversation_id === event.conversation_id &&
        (review.status === 'pending' ||
          review.delivery_state === 'queued' ||
          review.delivery_state === 'dispatched' ||
          review.delivery_state === 'held' ||
          review.delivery_state === 'in_doubt'),
    )
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[event.conversation_id]
        if (session) {
          session.generation += 1
          session.planReviewBarrier = barrier
        }
        const stage = planReviewAttentionStage(event)
        if (stage === null) {
          retireAttention(state, event.review_id)
          return
        }
        state.attention[event.review_id] = {
          approvalId: event.review_id,
          reviewId: event.review_id,
          conversationId: event.conversation_id,
          documentId: event.document_id,
          revisionId: event.revision_id,
          turnId: event.turn_id,
          stage,
          kind: 'plan_review',
        }
        if (!state.attentionOrder.includes(event.review_id)) state.attentionOrder.push(event.review_id)
      }),
    )
  },

  handleSubAgentStarted: (convId, messageId, callId, run) => {
    set(
      produce((state: ConversationStore) => {
        // Seeded even when there is no session to draw into: the counter is keyed
        // by turn and read by whichever card ends up rendering, and a run whose
        // parent is not open still writes rows the moment it starts.
        state.subAgentSteps[run.turnId] = state.subAgentSteps[run.turnId] ?? 0
        const session = state.sessions[convId]
        if (!session) return
        const target = session.messages.find((m) => m.id === messageId)
        const card = (target?._blocks ?? []).find((b) => b.type === 'tool_call' && b.data.call_id === callId)
        if (card?.type === 'tool_call') {
          card.data.sub_agent = {
            conversation_id: run.conversationId,
            turn_id: run.turnId,
            kind: run.kind,
            steps: 0,
          }
        }
      }),
    )
  },

  resolveNestedApproval: (convId, approvalId) => {
    set(
      produce((state: ConversationStore) => {
        retireAttention(state, approvalId)
        const session = state.sessions[convId]
        if (!session) return
        delete session.pendingApprovals[approvalId]
        delete session.pendingAsks[approvalId]
        for (const m of session.messages) {
          for (const b of m._blocks ?? []) {
            if (b.type === 'tool_call' && b.data.nested_approval?.approval_id === approvalId) {
              b.data.nested_approval = undefined
            }
          }
        }
      }),
    )
  },

  handleToolResult: (convId, messageId, callId, result, outcome) => {
    set(
      produce((state: ConversationStore) => {
        // Ahead of the session check, like the queueing in `handleToolApproval`
        // and for the same reason: a conversation nobody opened queued its
        // question here, and a result is the only thing that will ever retire
        // it. Matched on the pair, not the call id — provider call ids repeat.
        for (const [id, item] of Object.entries(state.attention)) {
          if (item.kind === 'plan_review') continue
          if (item.providerCallId !== callId) continue
          if (item.conversationId === convId && item.messageId === messageId) {
            retireAttention(state, id)
            continue
          }
          // Delegated: asked on the parent, result emitted on the sub-agent.
          if (item.subConversationId === convId) {
            retireAttention(state, id)
            dropNested(state, id)
          }
        }
        const session = state.sessions[convId]
        if (!session) return
        const status: ToolCallDisplay['status'] =
          outcome === 'denied' ? 'denied' : outcome === 'error' ? 'error' : 'completed'
        // Same locality rule as the approval above, and the same notion of still
        // outstanding: results arrive in the order the calls were made, so the
        // first card without an answer is the one this answers.
        const target = session.messages.find((m) => m.id === messageId)
        const card = (target?._blocks ?? []).find(
          (b) => b.type === 'tool_call' && b.data.call_id === callId && !ANSWERED.has(b.data.status),
        )
        if (card?.type === 'tool_call') {
          // Retire the entry this card was waiting on, not every entry sharing
          // the call id — a sibling call may still have one outstanding.
          if (card.data.approval_id) {
            delete session.pendingApprovals[card.data.approval_id]
            delete session.pendingAsks[card.data.approval_id]
          }
          if (card.data.nested_approval) {
            retireAttention(state, card.data.nested_approval.approval_id)
            delete session.pendingApprovals[card.data.nested_approval.approval_id]
            delete session.pendingAsks[card.data.nested_approval.approval_id]
            card.data.nested_approval = undefined
          }
          card.data.status = status
          card.data.result = result
          card.data.approval_id = undefined
          // The checklist bar tracks the arguments of the last successful call;
          // a rejected one left the stored list untouched.
          if (card.data.tool_name === 'update_todos' && status === 'completed') {
            session.activeTodos = readTodoArgs(card.data.arguments)
          }
          if (card.data.tool_name === 'send_sticker' && status === 'completed') {
            const sticker = stickerBlockFrom(card.data.arguments, result)
            if (
              sticker &&
              !target?._blocks?.some((block) => block.type === 'sticker' && block.sticker_id === sticker.sticker_id)
            ) {
              target?._blocks?.push(sticker)
            }
          }
        } else {
          // No card left to update — the transcript was rebuilt without one.
          // Retire whatever was waiting on this call anyway, or the sidebar keeps
          // claiming the conversation needs attention.
          for (const [id, entry] of Object.entries(session.pendingApprovals)) {
            if (entry.messageId === messageId && entry.providerCallId === callId) {
              delete session.pendingApprovals[id]
            }
          }
          for (const [id, entry] of Object.entries(session.pendingAsks)) {
            if (entry.messageId === messageId && entry.providerCallId === callId) {
              delete session.pendingAsks[id]
            }
          }
        }
      }),
    )
  },

  handleAutoReview: (convId, messageId, callId, verdict) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // No `ANSWERED` filter here, unlike the approval and result handlers:
        // this card was never pending. Nobody was asked, so it went straight
        // from `running` to whatever the verdict made of it, and the verdict
        // arrives before the result that will settle its status.
        const target = session.messages.find((m) => m.id === messageId)
        const card = (target?._blocks ?? []).find((b) => b.type === 'tool_call' && b.data.call_id === callId)
        if (card?.type === 'tool_call') card.data.auto_review = verdict
      }),
    )
  },

  markApprovalOrphaned: (approvalId) => {
    set(
      produce((state: ConversationStore) => {
        // Unconditional, and before the loop: the loop can only reach sessions,
        // and the queue holds questions from conversations that have none.
        retireAttention(state, approvalId)
        for (const session of Object.values(state.sessions)) {
          const entry = session.pendingApprovals[approvalId] ?? session.pendingAsks[approvalId]
          if (!entry) continue
          delete session.pendingApprovals[approvalId]
          delete session.pendingAsks[approvalId]
          // Written to the store rather than to the card's own state: a card that
          // only remembers this locally goes back to offering a dead button the
          // next time the transcript reloads.
          const target = session.messages.find((m) => m.id === entry.messageId)
          for (const block of target?._blocks ?? []) {
            if (block.type !== 'tool_call') continue
            if (block.data.approval_id === approvalId) {
              block.data.status = 'orphaned'
              block.data.approval_id = undefined
            }
            // A delegated run's question. The card it sits in is the `run_agent`
            // call, which is not itself orphaned — only the question is, so it
            // goes and the card carries on saying what it is doing.
            if (block.data.nested_approval?.approval_id === approvalId) {
              block.data.nested_approval = undefined
            }
          }
          return
        }
      }),
    )
  },

  handleApprovalExpired: (convId, approvalId) => {
    set(
      produce((state: ConversationStore) => {
        // Ahead of the session check, like every other path that retires a
        // question: the ones that go unanswered are mostly in conversations
        // nobody has opened, so there is no session to find.
        retireAttention(state, approvalId)
        dropNested(state, approvalId)

        const session = state.sessions[convId]
        if (!session) return
        // Unlike `retireAnsweredApproval`, this *does* settle the card. That
        // one deliberately leaves an ordinary card holding its `approval_id`,
        // because the question is still owed and only the toast is going away.
        // Here the question is over: leaving the id behind would keep the card
        // at `pending`, which draws as `requires-action` — a demand for an
        // answer with no way left to give one.
        const entry = session.pendingApprovals[approvalId] ?? session.pendingAsks[approvalId]
        delete session.pendingApprovals[approvalId]
        delete session.pendingAsks[approvalId]
        const target = entry ? session.messages.find((m) => m.id === entry.messageId) : undefined
        for (const block of target?._blocks ?? []) {
          if (block.type !== 'tool_call') continue
          if (block.data.approval_id === approvalId) {
            block.data.status = 'orphaned'
            block.data.approval_id = undefined
          }
        }
      }),
    )
  },

  retireAnsweredApproval: (approvalId) => {
    set(
      produce((state: ConversationStore) => {
        retireAttention(state, approvalId)
        // Nested buttons on every session that drew them. Ordinary cards are
        // left holding `approval_id`: clearing it would leave `pending` with
        // no way to answer. `handleStop` now also scans those cards, so the
        // pending-table copy of a nested id can go.
        dropNested(state, approvalId)
      }),
    )
  },

  deferAttention: (approvalId) => {
    set(
      produce((state: ConversationStore) => {
        if (!state.attention[approvalId]) return
        state.attentionOrder = [...state.attentionOrder.filter((id) => id !== approvalId), approvalId]
      }),
    )
  },

  loadAllPending: async () => {
    // What the answer is allowed to have an opinion about. Anything queued after
    // this line is newer than the register that is about to be read, and being
    // absent from it says nothing.
    const current = get()
    const asked = new Set(current.attentionOrder.filter((id) => current.attention[id]?.kind !== 'plan_review'))
    const rows = await api.allPendingApprovals().catch(() => null)
    // A queue that cannot be fetched is left as it is. Emptying it here would
    // turn one failed call into a set of questions nobody is told about, and the
    // events that filled it were right when they arrived.
    if (!rows) return
    set(
      produce((state: ConversationStore) => {
        for (const row of rows) {
          if (state.attention[row.approval_id]) continue
          state.attention[row.approval_id] = {
            conversationId: row.conversation_id,
            approvalId: row.approval_id,
            providerCallId: row.provider_call_id,
            messageId: row.assistant_message_id,
            toolName: row.tool_name,
            arguments: row.arguments,
            retryReason: row.retry_reason ?? undefined,
            kind: isAskTool(row.tool_name) ? 'ask' : 'approval',
            subConversationId: row.sub_conversation_id ?? undefined,
          }
          state.attentionOrder.push(row.approval_id)
        }
        // The answer *is* the register, so anything it does not mention has no
        // turn waiting on it — its turn ended while nothing was listening, which
        // is the state this call exists to reconcile. Restricted to what was
        // already queued when the request went out: an approval that arrived
        // while it was in flight is younger than the answer, and deleting it
        // here would drop a live question every time a reconnect raced an event.
        const live = new Set(rows.map((r) => r.approval_id))
        for (const id of Object.keys(state.attention)) {
          if (asked.has(id) && !live.has(id)) retireAttention(state, id)
        }
      }),
    )
  },

  setActiveTodos: (convId, todos) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.activeTodos = todos
      }),
    )
  },

  // The streamed tool events are gone after a reload or a conversation switch,
  // so the bar comes back from the database instead.
  loadActiveTodos: async (convId) => {
    // Declared without an initialiser: the catch returns, so the only way to
    // reach the use below is through the successful assignment.
    let view: TodoInfoResponse | null
    try {
      view = await api.getActiveTodoList(convId)
    } catch {
      return
    }
    get().setActiveTodos(convId, view ? { title: view.list.title, todos: toDrafts(view.items) } : null)
  },

  handleRetry: (convId, attempt, max, delayMs) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        // Not scoped to a turn: the event names the assistant row, and a session
        // that is not showing that row is not showing the header this appears in
        // either. The next thing to happen on any turn clears it.
        if (session) session.retry = { attempt, max, delayMs }
      }),
    )
  },

  handleStreamReset: (convId, messageId) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        const idx = findAssistantMsg(session.messages, messageId)
        if (idx < 0) return
        const target = session.messages[idx]
        target.content = ''
        target._blocks = undefined
      }),
    )
  },

  handleStop: (convId, turnId) => {
    const session0 = get().sessions[convId]
    const generation = session0?.generation ?? 0
    // A stop for a run this session never started, or started and moved past.
    // The transcript still changed, so the reload below runs — but the turn on
    // screen is somebody else's and its streaming state is not ours to clear.
    // An id-less stop is always ours: the backend sends one when a turn dies
    // before writing anything, and refusing it would leave the composer
    // disabled for good.
    const mine = !turnId || !session0?.activeTurnId || session0.activeTurnId === turnId
    set(
      produce((state: ConversationStore) => {
        // The turn is over, so nothing is listening for this conversation's
        // questions any more — including the ones queued for a conversation
        // with no session, which the block below cannot reach. `mine` is always
        // true without a session: there is no turn on screen for the stop to
        // belong to somebody else than.
        if (mine) {
          for (const [id, item] of Object.entries(state.attention)) {
            if (item.kind === 'plan_review') continue
            if (item.conversationId === convId || item.subConversationId === convId) {
              retireAttention(state, id)
              dropNested(state, id)
            }
          }
        }
        const session = state.sessions[convId]
        if (!session) return
        if (!mine) {
          // A turn that was being held in case the local one turned out not to
          // own the conversation. It has ended, so there is nothing to hand over
          // to; the reload below still runs, because the transcript changed.
          if (turnId && session.candidateTurnId === turnId) session.candidateTurnId = null
          return
        }
        // The local turn ended before it ever wrote a message, and another turn
        // announced itself while it was in flight. Same handover as a refusal:
        // that one has the conversation and the composer stays locked.
        if (session.candidateTurnId) {
          session.activeTurnId = session.candidateTurnId
          session.candidateTurnId = null
          return
        }
        session.streaming = false
        session.activeTurnId = null
        session.retry = null
        // The turn is over, so nothing is listening for these answers any more.
        // Clearing the entries without touching the cards used to leave a pair of
        // buttons that looked live and did nothing when pressed.
        for (const [id, entry] of [
          ...Object.entries(session.pendingApprovals),
          ...Object.entries(session.pendingAsks),
        ]) {
          const target = session.messages.find((m) => m.id === entry.messageId)
          for (const block of target?._blocks ?? []) {
            if (block.type !== 'tool_call') continue
            if (block.data.approval_id === id) {
              block.data.status = 'orphaned'
              block.data.approval_id = undefined
            }
            if (block.data.nested_approval?.approval_id === id) {
              block.data.nested_approval = undefined
            }
          }
        }
        for (const m of session.messages) {
          for (const block of m._blocks ?? []) {
            if (block.type !== 'tool_call') continue
            if (block.data.approval_id) {
              block.data.status = 'orphaned'
              block.data.approval_id = undefined
            }
            if (block.data.nested_approval) {
              dropNested(state, block.data.nested_approval.approval_id)
              retireAttention(state, block.data.nested_approval.approval_id)
              block.data.nested_approval = undefined
            }
          }
        }
        session.pendingApprovals = {}
        session.pendingAsks = {}
        if (convId !== state.activeId) {
          session.fulfilledUnseen = true
        }
      }),
    )
    // The whole snapshot, not just the messages: a turn that regenerated an
    // answer has just created a branch point, and the pager for it has to
    // appear now rather than the next time the conversation is opened. The turn
    // records matter here more than anywhere — this is the moment a turn ends,
    // and how it ended is what says whether the calls above are abandoned or
    // were simply never going to be answered by anyone.
    api.conversationSnapshot({ conversationId: convId }).then((snap) => {
      const snapshot = reconcileMessages(
        get().sessions[convId]?.messages ?? [],
        hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs, snap.plan_reviews),
      )
      let applied = false
      set(
        produce((state: ConversationStore) => {
          const session = state.sessions[convId]
          if (!session) return
          // A new stream started while this snapshot was in flight; its own stop
          // handler will reload, so applying the stale snapshot would clobber it.
          if (session.generation !== generation) return
          session.messages = mergeSnapshot(session, snapshot)
          session.planReviewBarrier = snap.plan_review_barrier
          session.branches = indexBranches(snap.tree.branches)
          session.turns = snap.turns
          applyPendingApprovals(session, snap.pending_approvals)
          applyPlanReviewAttention(state, convId, snap.plan_reviews)
          applied = true
        }),
      )
      if (applied) usePlanReviewStore.getState().rememberSummaries(snap.plan_reviews)
    })
  },

  handleCompactStart: (convId) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.compacting = true
      }),
    )
  },

  handleCompactDone: (convId, midTurn) => {
    if (midTurn) {
      set(
        produce((state: ConversationStore) => {
          const session = state.sessions[convId]
          if (session) session.compacting = false
        }),
      )
      return
    }
    const generation = get().sessions[convId]?.generation ?? 0
    api
      .conversationSnapshot({ conversationId: convId })
      .then((snap) => {
        const snapshot = reconcileMessages(
          get().sessions[convId]?.messages ?? [],
          hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs, snap.plan_reviews),
        )
        let applied = false
        set(
          produce((state: ConversationStore) => {
            const session = state.sessions[convId]
            if (!session) return
            session.compacting = false
            // A stream may have advanced while this snapshot was in flight; merge
            // instead of clobbering, and skip entirely if a newer turn superseded it.
            if (session.generation !== generation) return
            session.messages = mergeSnapshot(session, snapshot)
            session.planReviewBarrier = snap.plan_review_barrier
            session.branches = indexBranches(snap.tree.branches)
            session.turns = snap.turns
            applyPlanReviewAttention(state, convId, snap.plan_reviews)
            applied = true
          }),
        )
        if (applied) usePlanReviewStore.getState().rememberSummaries(snap.plan_reviews)
      })
      .catch(() => {
        set(
          produce((state: ConversationStore) => {
            const session = state.sessions[convId]
            if (session) session.compacting = false
          }),
        )
      })
  },

  setStreaming: (convId, value) => {
    set(
      produce((state: ConversationStore) => {
        if (!state.sessions[convId]) {
          state.sessions[convId] = defaultSession()
        }
        state.sessions[convId].streaming = value
        // Turning streaming off by hand — a request that failed before the turn
        // ever started — must not leave an id behind, or the next stop would be
        // measured against a run that no longer exists.
        if (!value) {
          state.sessions[convId].activeTurnId = null
          state.sessions[convId].candidateTurnId = null
        }
      }),
    )
  },

  setCompacting: (convId, value) => {
    set(
      produce((state: ConversationStore) => {
        if (state.sessions[convId]) {
          state.sessions[convId].compacting = value
        }
      }),
    )
  },

  setError: (convId, error) => {
    set(
      produce((state: ConversationStore) => {
        if (state.sessions[convId]) {
          state.sessions[convId].error = error
        }
      }),
    )
  },

  markSeen: (convId) => {
    set(
      produce((state: ConversationStore) => {
        if (state.sessions[convId]) {
          state.sessions[convId].fulfilledUnseen = false
        }
      }),
    )
  },

  setTurnExpanded: (convId, turnId, expanded) => {
    set(
      produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.expandedTurns[turnId] = expanded
      }),
    )
  },
}))
