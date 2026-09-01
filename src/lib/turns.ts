import type { ContentBlock, MessageRating, MessageViewModel, ToolCallDisplay, TurnUsageInfoResponse } from '@/types'

/**
 * A turn is one user message plus everything the agent produced in response.
 *
 * The backend has no notion of it: `chat.rs` writes a fresh assistant row per
 * tool-loop iteration, so a single question can leave a dozen rows behind. The
 * boundary is recovered here from `role === 'user'` alone, which is why nothing
 * upstream has to change for the UI to group them.
 *
 * What a turn *looks like* — bubbles, keyboards, which row carries the avatar —
 * is derived a layer up, in `lib/message-groups`. This module only decides what
 * a turn *is*: its identity, its status, and what it cost.
 */

export type TurnStatus =
  /** The agent is still working on this turn. */
  | 'streaming'
  /** Finished with a final answer. */
  | 'complete'
  /** Stopped without one — cancelled, or the model ended on a tool call. */
  | 'interrupted'
  /** Stopped unexpectedly, without ever reaching an ending.
   *
   *  Kept apart from `interrupted`, which is a turn that stopped for a reason
   *  somebody knows — the user pressed Stop, the model quit on a tool call.
   *  This one may have left a file half-written, and the reader has no way to
   *  tell from the transcript.
   *
   *  Says nothing about *why*, because nothing knows: the rule that produces it
   *  is "the backend has no record of this turn ending and is not running it",
   *  which the application being killed satisfies, and so does a task that
   *  panicked or was dropped while the application carried on. Do not build
   *  anything on top of one of those readings.
   *
   *  Read off the backend's record rather than inferred, and decided before
   *  anything else: one that happened to stop after some trailing text would
   *  otherwise render as a clean answer. */
  | 'crashed'
  /** Blocked on the user: an approval, a question, a plan to review. */
  | 'awaiting-input'
  /** Produced no text at all. */
  | 'empty'

export interface TurnResult {
  /** The assistant row carrying the conclusion — rating and regeneration act on it. */
  messageId: string
  /** The concluding prose, joined. What the copy button copies for a turn. */
  text: string
  modelId: string | null
  inputTokens: number | null
  outputTokens: number | null
  rating: MessageRating | null
}

export interface TurnSummary {
  toolCount: number
  thinkingCount: number
  textCount: number
}

export interface Turn {
  /** Stable across regeneration: the user row's id, so switching which answer is
   *  active does not change the turn's identity (and its scroll anchor). */
  id: string
  userMessage: MessageViewModel | null
  assistantMessages: MessageViewModel[]
  result: TurnResult | null
  status: TurnStatus
  /** null when it cannot be derived — rows written before per-message timestamps,
   *  or a turn with no user row to measure from. */
  durationMs: number | null
  summary: TurnSummary
  /** Summed across every assistant row, since only one of them still shows a
   *  count once the intermediate footers are gone. */
  tokens: { input: number | null; output: number | null }
  /** Backend-priced audit summary for the run on the active branch. Null for
   *  rows written before turns were recorded, and while a live turn has not
   *  reached its post-stop snapshot yet. */
  usage: TurnUsageInfoResponse | null
  lastMessageId: string
  firstSortOrder: number
}

/**
 * The scroller id for a turn's answer, as opposed to the turn as a whole.
 *
 * A turn is one scroller row so that collapsing its middle cannot move its own
 * top, but "put me back at the start of the answer" has to name something below
 * the question. Derived rather than stored so both ends agree without threading
 * an id through the tree.
 */
export function answerAnchorId(turnId: string): string {
  return `${turnId}:answer`
}

/**
 * Which of a reply's tool calls are only waiting their turn.
 *
 * The loop dispatches calls one at a time, in the order the model wrote them,
 * and does not start the next until the last has returned. So the first call
 * without a result is the one doing the work — whether it is running or sitting
 * in front of the user — and everything after it has not begun.
 *
 * The transcript cannot say this on its own. All of a reply's calls are written
 * into the assistant row before any of them runs, so a snapshot taken partway
 * through hydrates every unanswered one as `running`: identical spinners, only
 * one of them true.
 *
 * Derived here rather than stored. The answer changes every time a result lands,
 * and a copy living in the blocks would need promoting on each `tool_result` —
 * one more invariant to keep, wrong between the event and the next snapshot.
 * Position is already in the data; this just reads it.
 *
 * Pass `null` for anything in the sequence that is not a tool call, so indexes
 * line up with what the caller is rendering.
 */
export function markQueued(statuses: readonly (ToolCallDisplay['status'] | null)[]): boolean[] {
  let busy = false
  return statuses.map((status) => {
    // Everything else has an outcome, and an outcome means it ran. A call
    // waiting on the conversation above has not run either — it is waiting for
    // an answer like a `pending` one, just not from anyone reading this.
    const unfinished =
      status === 'pending' || status === 'approved' || status === 'running' || status === 'awaiting_parent'
    if (!unfinished) return false
    if (busy) return true
    busy = true
    return false
  })
}

export interface BuildTurnsContext {
  /** Whether the conversation has a stream in flight; only the last turn can be
   *  the one streaming. */
  streaming?: boolean
  /** Turns the backend says stopped without ever reaching an ending.
   *
   *  Nothing here could work this out. A turn cut off mid-answer leaves rows
   *  indistinguishable from one that simply ended on a tool call, and the
   *  difference — whether a file may be half-written — is only knowable from
   *  the backend's own record of what was running. */
  crashedTurnIds?: ReadonlySet<string>
  /** Cost summaries keyed by the backend's run id. Kept as a map so this pure
   *  transcript builder does not need to understand `TurnInfoResponse` statuses. */
  usageByTurnId?: ReadonlyMap<string, TurnUsageInfoResponse>
}

/** Tools that block the turn while they wait for a response. `update_todos` is
 *  deliberately absent: the persistent TodoBar already shows that checklist, so
 *  treating it as a question would hold the turn open for nobody. */
const INTERACTIVE_TOOLS = new Set(['ask_user', 'AskUserQuestion', 'enter_plan', 'exit_plan', 'ExitPlanMode'])

/** The blocks a row renders as. Pre-`_blocks` rows, and any row whose stream
 *  produced nothing structured, read their `content` as one text block. */
export function blocksOf(message: MessageViewModel): ContentBlock[] {
  if (message._blocks && message._blocks.length > 0) return message._blocks
  return message.content ? [{ type: 'text', text: message.content }] : []
}

/**
 * A call that is holding the turn open until a person answers.
 *
 * Three shapes, and the second is the easy one to miss. A delegated run asking
 * for permission leaves its own card merely `running` — `run_agent` really is —
 * so without `nested_approval` the one thing on screen that needs a person
 * would look like work in progress. An interactive tool with no outcome yet is
 * the third: `ask_user` sits at `running` for as long as the form is open.
 */
export function isBlockingCall(data: ToolCallDisplay): boolean {
  if (data.status === 'pending') return true
  if (data.nested_approval) return true
  return INTERACTIVE_TOOLS.has(data.tool_name) && data.status === 'running'
}

/**
 * The text after the last tool call, which is the model signing off.
 *
 * That mirrors the agent loop exactly: rounds that call tools are process, and
 * the model only concludes in plain text once it stops calling them. A turn
 * with no tool calls is therefore all conclusion.
 *
 * A turn blocked on the user has not concluded, whatever text follows its last
 * *unblocked* call: what it said before the blocked call was introducing that
 * call, not answering the question. Reading it as a conclusion would put the
 * introduction after the thing it introduces, and move it again once the call
 * is approved and the turn carries on past it.
 */
function findConclusion(messages: MessageViewModel[]): { messageId: string; text: string } | null {
  let owner: MessageViewModel | null = null
  const tail: string[] = []
  for (const m of messages) {
    for (const block of blocksOf(m)) {
      if (block.type === 'tool_call') {
        if (isBlockingCall(block.data)) return null
        owner = null
        tail.length = 0
      } else if (block.type === 'text' && block.text.trim()) {
        owner = m
        tail.push(block.text)
      } else if (block.type === 'sticker') {
        // A sticker sent after its tool call is an answer with no words in it.
        owner = m
      }
    }
  }
  if (!owner) return null
  return { messageId: owner.id, text: tail.join('\n\n').trim() }
}

function summarize(messages: MessageViewModel[]): TurnSummary {
  let toolCount = 0
  let thinkingCount = 0
  let textCount = 0
  for (const m of messages) {
    for (const block of blocksOf(m)) {
      if (block.type === 'tool_call') toolCount += 1
      else if (block.type === 'thinking') thinkingCount += 1
      else if (block.type === 'text' && block.text.trim()) textCount += 1
    }
  }
  return { toolCount, thinkingCount, textCount }
}

function hasBlockingCall(messages: MessageViewModel[]): boolean {
  return messages.some((m) => blocksOf(m).some((b) => b.type === 'tool_call' && isBlockingCall(b.data)))
}

interface OpenTurn {
  userMessage: MessageViewModel | null
  assistantMessages: MessageViewModel[]
}

export function buildTurns(messages: MessageViewModel[], ctx: BuildTurnsContext = {}): Turn[] {
  const groups: OpenTurn[] = []
  let current: OpenTurn | null = null

  for (const m of messages) {
    if (m.role === 'user') {
      current = { userMessage: m, assistantMessages: [] }
      groups.push(current)
    } else if (m.role === 'assistant') {
      if (!current) {
        // A conversation can open with an assistant row (a greeting, or history
        // whose user rows were compacted away).
        current = { userMessage: null, assistantMessages: [] }
        groups.push(current)
      }
      current.assistantMessages.push(m)
    }
  }

  const crashed = ctx.crashedTurnIds
  const usage = ctx.usageByTurnId
  return groups.map((g, i) => {
    const turnId = crashed === undefined && usage === undefined ? null : pathTurnId(g)
    return finalize(
      g,
      i === groups.length - 1 && ctx.streaming === true,
      turnId !== null && crashed?.has(turnId) === true,
      turnId === null ? null : (usage?.get(turnId) ?? null),
    )
  })
}

/** Which run of the agent loop produced the answer currently on this path.
 *
 *  The answer's own rows, not the question's. Regenerating writes a new
 *  assistant row under the *same* user row, so after a crashed answer is
 *  regenerated the group holds a question belonging to the turn that died and
 *  an answer belonging to the one that succeeded. Asking whether any row of the
 *  group crashed marks the good answer as crashed and never stops doing so.
 *
 *  The last assistant row with an id, because a turn's rows are written in
 *  order and the last is the one that owns how it ended. Only when there is no
 *  answer at all — a turn cut off before the model said anything — does the
 *  question have to speak for it. */
function pathTurnId(group: OpenTurn): string | null {
  for (let i = group.assistantMessages.length - 1; i >= 0; i--) {
    const id = group.assistantMessages[i].turn_id
    if (id) return id
  }
  return group.assistantMessages.length > 0 ? null : (group.userMessage?.turn_id ?? null)
}

function finalize(group: OpenTurn, isStreaming: boolean, didCrash: boolean, usage: TurnUsageInfoResponse | null): Turn {
  const { userMessage, assistantMessages } = group

  const blocked = hasBlockingCall(assistantMessages)
  const conclusion = findConclusion(assistantMessages)
  const resultOwner = conclusion ? (assistantMessages.find((m) => m.id === conclusion.messageId) ?? null) : null

  const result: TurnResult | null =
    resultOwner && conclusion
      ? {
          messageId: resultOwner.id,
          text: conclusion.text,
          modelId: resultOwner.model_id,
          inputTokens: resultOwner.input_tokens,
          outputTokens: resultOwner.output_tokens,
          rating: resultOwner.rating,
        }
      : null

  const summary = summarize(assistantMessages)
  const last = assistantMessages[assistantMessages.length - 1] ?? userMessage

  let status: TurnStatus
  if (blocked) status = 'awaiting-input'
  // Ahead of `result`, which is the whole point of having it: a turn cut off
  // just after writing a paragraph has text sitting past its last tool call,
  // and read from the transcript alone that is indistinguishable from an
  // answer. It would draw a tick beside itself and say nothing about the tool
  // that may have run.
  //
  // Behind `isStreaming`, which is the fresher signal. Turn records are read
  // when a conversation is opened or a turn ends; a live stream is being
  // watched right now.
  else if (isStreaming) status = 'streaming'
  else if (didCrash) status = 'crashed'
  else if (result) status = 'complete'
  else if (summary.toolCount > 0) status = 'interrupted'
  else status = 'empty'

  return {
    id: userMessage?.id ?? assistantMessages[0]?.id ?? 'empty-turn',
    userMessage,
    assistantMessages,
    result,
    status,
    durationMs: elapsed(userMessage, last),
    summary,
    tokens: sumTokens(assistantMessages),
    usage,
    lastMessageId: last?.id ?? '',
    firstSortOrder: userMessage?.sort_order ?? assistantMessages[0]?.sort_order ?? 0,
  }
}

/** Null rather than 0 when nothing reported usage, so the footer can tell
 *  "no data" apart from "cost nothing". */
function sumTokens(messages: MessageViewModel[]): { input: number | null; output: number | null } {
  let input: number | null = null
  let output: number | null = null
  for (const m of messages) {
    if (m.input_tokens != null) input = (input ?? 0) + m.input_tokens
    if (m.output_tokens != null) output = (output ?? 0) + m.output_tokens
  }
  return { input, output }
}

/** Rows written before per-message timestamps all share the turn's start time,
 *  so a zero difference means "unknown", not "instant". Callers show nothing
 *  instead of claiming 0s. */
function elapsed(first: MessageViewModel | null, last: MessageViewModel | null | undefined): number | null {
  if (!first || !last) return null
  const ms = last.created_at - first.created_at
  return ms > 0 ? ms : null
}

/** When the turn began, for the date separator above it. Null for rows written
 *  before per-message timestamps, whose clock reads zero. */
export function turnStartedAt(turn: Turn): number | null {
  const ts = turn.userMessage?.created_at ?? turn.assistantMessages[0]?.created_at ?? 0
  return ts > 0 ? ts : null
}

/** When the turn's last row was written — what the next turn compares its own
 *  start against to decide whether a day has passed between them. */
export function turnEndedAt(turn: Turn): number | null {
  const last = turn.assistantMessages[turn.assistantMessages.length - 1] ?? turn.userMessage
  const ts = last?.created_at ?? 0
  return ts > 0 ? ts : null
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 1) return `${ms}ms`
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}
