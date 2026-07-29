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
  /** Blocked on the user: an approval, a question, a plan to review. */
  | 'awaiting-input'
  /** Produced no text at all. */
  | 'empty'

export type TurnStep =
  | { kind: 'thinking'; messageId: string; blockIndex: number; text: string }
  | { kind: 'text'; messageId: string; blockIndex: number; text: string }
  | { kind: 'tool'; messageId: string; blockIndex: number; data: ToolCallDisplay }

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

export interface BuildTurnsContext {
  /** Whether the conversation has a stream in flight; only the last turn can be
   *  the one streaming. */
  streaming?: boolean
}

/** Tools that block the turn while they wait for a response. `update_todos` is
 *  deliberately absent: the persistent TodoBar already shows that checklist, so
 *  surfacing it again outside the collapsed region is noise. */
const INTERACTIVE_TOOLS = new Set(['ask_user', 'enter_plan', 'exit_plan'])

function blocksOf(message: Message): ContentBlock[] {
  if (message._blocks && message._blocks.length > 0) return message._blocks
  // Pre-`_blocks` rows, and any row whose stream produced nothing structured.
  return message.content ? [{ type: 'text', text: message.content }] : []
}

function isPinned(step: TurnStep): boolean {
  if (step.kind !== 'tool') return false
  if (step.data.status === 'pending') return true
  // An interactive tool with no outcome yet is still holding the turn open.
  return INTERACTIVE_TOOLS.has(step.data.tool_name) && step.data.status === 'running'
}

function toStep(block: ContentBlock, messageId: string, blockIndex: number): TurnStep | null {
  if (block.type === 'thinking') return { kind: 'thinking', messageId, blockIndex, text: block.text }
  if (block.type === 'text') return { kind: 'text', messageId, blockIndex, text: block.text }
  if (block.type === 'tool_call') return { kind: 'tool', messageId, blockIndex, data: block.data }
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
  const conclusion = tail.filter((s) => s.kind === 'text' && s.text.trim())
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
    } else {
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

  return groups.map((g, i) => finalize(g, i === groups.length - 1 && ctx.streaming === true))
}

function finalize(group: OpenTurn, isStreaming: boolean): Turn {
  const { userMessage, assistantMessages } = group

  const flat: TurnStep[] = []
  for (const m of assistantMessages) {
    blocksOf(m).forEach((block, blockIndex) => {
      const step = toStep(block, m.id, blockIndex)
      if (step) flat.push(step)
    })
  }

  const pinned = flat.filter(isPinned)
  const { process, conclusion } = splitAtConclusion(flat.filter((s) => !isPinned(s)))

  const resultOwner = conclusion.length > 0
    ? assistantMessages.find((m) => m.id === conclusion[conclusion.length - 1].messageId) ?? null
    : null

  const result: TurnResult | null = resultOwner
    ? {
        messageId: resultOwner.id,
        text: conclusion.map((s) => (s.kind === 'text' ? s.text : '')).join('\n\n').trim(),
        blocks: conclusion.flatMap((s) => (s.kind === 'text' ? [{ type: 'text' as const, text: s.text }] : [])),
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
  else if (isStreaming) status = 'streaming'
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
 *  Reasoning alone does not count; it already collapses itself. */
export function hasCollapsibleProcess(turn: Turn): boolean {
  return turn.summary.toolCount > 0 || turn.pinned.length > 0
}
