import type { ContentBlock, Message, ToolCallDisplay } from '@/types'

/**
 * A turn is one user message plus everything the agent produced in response.
 *
 * The backend has no notion of it: `chat.rs` writes a fresh assistant row per
 * tool-loop iteration, so a single question can leave a dozen rows behind. The
 * boundary is recovered here from `role === 'user'` alone, which is why nothing
 * upstream has to change for the UI to group them.
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

export type TurnStep =
  | { kind: 'thinking'; messageId: string; blockIndex: number; text: string }
  | { kind: 'text'; messageId: string; blockIndex: number; text: string }
  | { kind: 'tool'; messageId: string; blockIndex: number; data: ToolCallDisplay }
  | { kind: 'sticker'; messageId: string; blockIndex: number; stickerId: string; name?: string }

export interface TurnResult {
  /** The assistant row carrying the conclusion — rating and regeneration act on it. */
  messageId: string
  text: string
  /** Just the concluding blocks. That row's own `_blocks` also hold the steps
   *  leading up to it, which the collapsed region has already rendered. */
  blocks: ContentBlock[]
  modelId: string | null
  inputTokens: number | null
  outputTokens: number | null
  rating: number | null
}

export interface TurnSummary {
  toolCount: number
  thinkingCount: number
  textCount: number
  lastToolName: string | null
}

export interface Turn {
  /** Stable across regeneration: the user row's id, so switching which answer is
   *  active does not change the turn's identity (and its scroll anchor). */
  id: string
  userMessage: Message | null
  assistantMessages: Message[]
  /** Everything leading up to the conclusion. Collapsed by default. */
  steps: TurnStep[]
  /** Steps that must stay reachable even when collapsed, because they are
   *  waiting on the user. */
  pinned: TurnStep[]
  result: TurnResult | null
  status: TurnStatus
  /** null when it cannot be derived — rows written before per-message timestamps,
   *  or a turn with no user row to measure from. */
  durationMs: number | null
  summary: TurnSummary
  /** Summed across every assistant row, since only one of them still shows a
   *  count once the intermediate footers are gone. */
  tokens: { input: number | null; output: number | null }
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
}

/** Tools that block the turn while they wait for a response. `update_todos` is
 *  deliberately absent: the persistent TodoBar already shows that checklist, so
 *  surfacing it again outside the collapsed region is noise. */
const INTERACTIVE_TOOLS = new Set(['ask_user', 'AskUserQuestion', 'enter_plan', 'exit_plan', 'ExitPlanMode'])

function blocksOf(message: Message): ContentBlock[] {
  if (message._blocks && message._blocks.length > 0) return message._blocks
  // Pre-`_blocks` rows, and any row whose stream produced nothing structured.
  return message.content ? [{ type: 'text', text: message.content }] : []
}

function isPinned(step: TurnStep): boolean {
  if (step.kind !== 'tool') return false
  if (step.data.status === 'pending') return true
  // A delegated run asking for permission. The card itself is only `running` —
  // `run_agent` really is — so without this the one thing on screen that needs
  // a person could sit inside a collapsed region.
  if (step.data.nested_approval) return true
  // An interactive tool with no outcome yet is still holding the turn open.
  return INTERACTIVE_TOOLS.has(step.data.tool_name) && step.data.status === 'running'
}

function toStep(block: ContentBlock, messageId: string, blockIndex: number): TurnStep | null {
  if (block.type === 'thinking') return { kind: 'thinking', messageId, blockIndex, text: block.text }
  if (block.type === 'text') return { kind: 'text', messageId, blockIndex, text: block.text }
  if (block.type === 'tool_call') return { kind: 'tool', messageId, blockIndex, data: block.data }
  if (block.type === 'sticker') {
    return { kind: 'sticker', messageId, blockIndex, stickerId: block.sticker_id, name: block.name }
  }
  return null
}

/** Splits the flattened step list into "process" and "conclusion".
 *
 *  The conclusion is the run of text after the last tool call. That mirrors the
 *  agent loop exactly: iterations that call tools are steps, and the model only
 *  signs off in plain text once it stops calling them. A turn with no tool calls
 *  is therefore all conclusion, which is what keeps ordinary Q&A from being
 *  wrapped in a collapse header. */
function splitAtConclusion(steps: TurnStep[]): { process: TurnStep[]; conclusion: TurnStep[] } {
  let lastToolIndex = -1
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === 'tool') {
      lastToolIndex = i
      break
    }
  }
  const tail = steps.slice(lastToolIndex + 1)
  const conclusion = tail.filter((s) => (s.kind === 'text' && s.text.trim()) || s.kind === 'sticker')
  if (conclusion.length === 0) return { process: steps, conclusion: [] }
  // Thinking that trails the last tool call belongs to the process, not the answer.
  const process = steps.slice(0, lastToolIndex + 1).concat(tail.filter((s) => !conclusion.includes(s)))
  return { process, conclusion }
}

function summarize(steps: TurnStep[]): TurnSummary {
  let toolCount = 0
  let thinkingCount = 0
  let textCount = 0
  let lastToolName: string | null = null
  for (const s of steps) {
    if (s.kind === 'tool') {
      toolCount += 1
      lastToolName = s.data.tool_name
    } else if (s.kind === 'thinking') {
      thinkingCount += 1
    } else if (s.kind === 'text') {
      textCount += 1
    }
  }
  return { toolCount, thinkingCount, textCount, lastToolName }
}

interface OpenTurn {
  userMessage: Message | null
  assistantMessages: Message[]
}

export function buildTurns(messages: Message[], ctx: BuildTurnsContext = {}): Turn[] {
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
  return groups.map((g, i) => {
    const turnId = crashed === undefined ? null : pathTurnId(g)
    return finalize(g, i === groups.length - 1 && ctx.streaming === true, turnId !== null && crashed!.has(turnId))
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

function finalize(group: OpenTurn, isStreaming: boolean, didCrash: boolean): Turn {
  const { userMessage, assistantMessages } = group

  const flat: TurnStep[] = []
  for (const m of assistantMessages) {
    blocksOf(m).forEach((block, blockIndex) => {
      const step = toStep(block, m.id, blockIndex)
      if (step) flat.push(step)
    })
  }

  const pinned = flat.filter(isPinned)
  // A turn blocked on the user has not concluded: whatever it said before the
  // blocked call was introducing that call, not answering the question. Reading
  // the conclusion off the remaining steps would find that text sitting after
  // the last *unblocked* tool and render it below the approval it introduces —
  // the wrong way round. It also keeps the text from moving once the call is
  // approved and the turn carries on past it.
  const { process, conclusion } =
    pinned.length > 0 ? { process: flat.filter((s) => !isPinned(s)), conclusion: [] } : splitAtConclusion(flat)

  const resultOwner =
    conclusion.length > 0
      ? (assistantMessages.find((m) => m.id === conclusion[conclusion.length - 1].messageId) ?? null)
      : null

  const result: TurnResult | null = resultOwner
    ? {
        messageId: resultOwner.id,
        text: conclusion
          .map((s) => (s.kind === 'text' ? s.text : ''))
          .join('\n\n')
          .trim(),
        blocks: conclusion.flatMap<ContentBlock>((s) =>
          s.kind === 'text'
            ? [{ type: 'text' as const, text: s.text }]
            : s.kind === 'sticker'
              ? [{ type: 'sticker' as const, sticker_id: s.stickerId, name: s.name }]
              : [],
        ),
        modelId: resultOwner.model_id,
        inputTokens: resultOwner.input_tokens,
        outputTokens: resultOwner.output_tokens,
        rating: resultOwner.rating,
      }
    : null

  const summary = summarize(process)
  const last = assistantMessages[assistantMessages.length - 1] ?? userMessage

  let status: TurnStatus
  if (pinned.length > 0) status = 'awaiting-input'
  // Ahead of `result`, which is the whole point of having it: a turn cut off
  // just after writing a paragraph has text sitting past its last tool call,
  // and read from the transcript alone that is indistinguishable from an
  // answer. It would collapse itself with a tick beside it and say nothing
  // about the tool that may have run.
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
    steps: process,
    pinned,
    result,
    status,
    durationMs: elapsed(userMessage, last),
    summary,
    tokens: sumTokens(assistantMessages),
    lastMessageId: last?.id ?? '',
    firstSortOrder: userMessage?.sort_order ?? assistantMessages[0]?.sort_order ?? 0,
  }
}

/** Null rather than 0 when nothing reported usage, so the footer can tell
 *  "no data" apart from "cost nothing". */
function sumTokens(messages: Message[]): { input: number | null; output: number | null } {
  let input: number | null = null
  let output: number | null = null
  for (const m of messages) {
    if (m.input_tokens != null) input = (input ?? 0) + m.input_tokens
    if (m.output_tokens != null) output = (output ?? 0) + m.output_tokens
  }
  return { input, output }
}

/** Rows written before per-message timestamps all share the turn's start time,
 *  so a zero difference means "unknown", not "instant". Callers show a step
 *  count instead of claiming 0s. */
function elapsed(first: Message | null, last: Message | null | undefined): number | null {
  if (!first || !last) return null
  const ms = last.created_at - first.created_at
  return ms > 0 ? ms : null
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

/** Whether this turn is worth collapsing at all.
 *
 *  Ordinary question-and-answer is not: a "Worked for 3s" header above a
 *  two-line reply buries it behind a click for nothing. Tool calls are what make
 *  a turn worth collapsing, and they are also what makes it multi-round in the
 *  first place — the agent loop only writes another assistant row when the last
 *  one called tools. Pinned calls count too: they are excluded from `steps`, so
 *  a turn whose only tool is still awaiting approval would otherwise look bare.
 *  Reasoning alone does not count; it already collapses itself.
 *
 *  A turn that crashed always counts, tools or no tools. The header is the only
 *  place that says so — without it a turn cut off part way through a sentence
 *  renders as a sentence that simply stops, which is exactly the reading this
 *  status exists to prevent. */
export function hasCollapsibleProcess(turn: Turn): boolean {
  return turn.summary.toolCount > 0 || turn.pinned.length > 0 || turn.status === 'crashed'
}
