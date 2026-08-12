import { create } from 'zustand'
import { produce } from 'immer'
import { api } from '@/api'
import { parseTodoArgs, toDrafts, type TodoArgs } from '@/components/chat/todo-list'
import type { BranchPoint, Conversation, Message, PendingApprovalInfo, Project, ContentBlock, OpenAIToolCall, SubAgentRunView, TodoListView, ToolCallDisplay, TurnRecord } from '@/types'

/**
 * Read a checklist out of an `update_todos` call. A list whose steps are all
 * done has already been archived on the backend, so it stops being the active
 * one here too.
 */
function readTodoArgs(args: string): TodoArgs | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const todoArgs = parseTodoArgs(parsed as Record<string, unknown>)
  if (!todoArgs) return null
  return todoArgs.todos.every((t) => t.status === 'completed') ? null : todoArgs
}

/** The calls a finished assistant row records having made, or `null` while it
 *  is still being written. */
function storedCalls(column: string | null | undefined): OpenAIToolCall[] | null {
  if (!column) return null
  try {
    const parsed = JSON.parse(column) as OpenAIToolCall[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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
function toolRowsByAssistant(msgs: Message[]): Map<string, Message[]> {
  const out = new Map<string, Message[]>()
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
type ApprovalIndex = Map<string, Map<string, PendingApprovalInfo[]>>

/** `bubbled` picks which call id places the card.
 *
 * A delegated run's approval names two: the tool it wants to run, which lives
 * in the sub-agent's conversation, and the `run_agent` call it hangs under
 * here. Indexing it by the former would look for a call this row never made. */
function indexApprovals(pending: PendingApprovalInfo[], nested: boolean): ApprovalIndex {
  const out: ApprovalIndex = new Map()
  for (const p of pending) {
    const key = nested ? p.parent_call_id : p.provider_call_id
    if (nested !== (p.parent_call_id !== undefined) || !key) continue
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
function indexRuns(runs: SubAgentRunView[]): Map<string, Map<string, SubAgentRunView>> {
  const out = new Map<string, Map<string, SubAgentRunView>>()
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

/** How a tool row says it went. Null is every row written before the column
 *  existed, and every one of those claimed success. */
function outcomeOf(toolMsg: Message): ToolCallDisplay['status'] {
  switch (toolMsg.tool_outcome) {
    case 'denied':
      return 'denied'
    case 'error':
      return 'error'
    default:
      return 'completed'
  }
}

/** The ways a turn can have reached an ending. Anything outside this set —
 *  including a status written by a later build — is not evidence that one did. */
const ENDED = new Set(['done', 'cancelled', 'failed', 'interrupted'])

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
 * ended earns `orphaned`. Everything else — a record this build cannot find,
 * a status a later one invented — is treated as still going. The two mistakes
 * are not the same size: reading a live call as dead is a wrong answer sitting
 * on screen with no buttons, while reading a dead one as live corrects itself
 * the moment anything reloads.
 *
 * A row with no `turn_id` predates the record entirely and keeps the reading it
 * has always had.
 */
function unansweredStatus(turnId: string | null | undefined, turns: Map<string, TurnRecord>) {
  if (!turnId) return 'orphaned' as const
  const status = turns.get(turnId)?.status
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
export function hydrateBlocks(
  msgs: Message[],
  pending: PendingApprovalInfo[] = [],
  turns: TurnRecord[] = [],
  runs: SubAgentRunView[] = [],
): Message[] {
  const answers = toolRowsByAssistant(msgs)
  // Consumed as they match, so two calls sharing an id cannot both claim the
  // same approval.
  const waiting = indexApprovals(pending, false)
  const bubbled = indexApprovals(pending, true)
  const delegated = indexRuns(runs)
  const byTurn = new Map(turns.map((t) => [t.id, t]))

  return msgs.map((m) => {
    if (m.role !== 'assistant') return m

    if (m.schema_version >= 2) {
      const blocks: ContentBlock[] = []
      if (m.reasoning_content) {
        blocks.push({ type: 'thinking', text: m.reasoning_content })
      }
      if (m.content) {
        blocks.push({ type: 'text', text: m.content })
      }
      if (m.tool_calls) {
        try {
          const tcs = JSON.parse(m.tool_calls) as OpenAIToolCall[]
          // Consumed as they match, for the same reason as the approvals.
          const owned = [...(answers.get(m.id) ?? [])]
          for (const tc of tcs) {
            const answered = owned.findIndex((tm) => tm.tool_call_id === tc.id)
            const toolMsg = answered >= 0 ? owned.splice(answered, 1)[0] : undefined
            const stillWaiting = toolMsg ? undefined : waiting.get(m.id)?.get(tc.id)?.shift()
            // A question raised inside a delegated run, waiting on whoever is
            // reading this. Independent of the card's own status: `run_agent`
            // is still running, and that is what the card says.
            const nested = toolMsg ? undefined : bubbled.get(m.id)?.get(tc.id)?.shift()
            const run = delegated.get(m.id)?.get(tc.id)
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
                  : stillWaiting
                    ? stillWaiting.bubbled ? 'awaiting_parent' : 'pending'
                    : unansweredStatus(m.turn_id, byTurn),
                result: toolMsg?.content,
                // Left off when the answer has to come from elsewhere, so that
                // "has an id" and "can be answered here" stay the same thing.
                approval_id: stillWaiting?.bubbled ? undefined : stillWaiting?.approval_id,
                retry_reason: stillWaiting?.retry_reason,
                sub_agent: run?.spawned_turn_id
                  ? {
                    conversation_id: run.conversation_id,
                    turn_id: run.spawned_turn_id,
                    kind: run.agent_kind ?? undefined,
                    steps: run.steps,
                  }
                  : undefined,
                nested_approval: nested
                  ? {
                    approval_id: nested.approval_id,
                    call_id: nested.provider_call_id,
                    tool_name: nested.tool_name,
                    arguments: nested.arguments,
                    retry_reason: nested.retry_reason,
                    sub_conversation_id: nested.sub_conversation_id,
                  }
                  : undefined,
              },
            })
          }
        } catch { /* ignore */ }
      }
      return { ...m, _blocks: blocks.length > 0 ? blocks : undefined }
    }

    if (m.tool_calls) {
      try {
        const blocks = JSON.parse(m.tool_calls) as ContentBlock[]
        return { ...m, _blocks: blocks }
      } catch { /* ignore */ }
    }
    return m
  })
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
export function reconcileMessages(prev: Message[], next: Message[]): Message[] {
  if (prev.length === 0) return next
  const byId = new Map(prev.map((m) => [m.id, m]))
  let identical = prev.length === next.length
  const out = next.map((m, i) => {
    const old = byId.get(m.id)
    if (old && sameStoredFields(old, m)) {
      if (prev[i] !== old) identical = false
      return old
    }
    identical = false
    return old ? keepAnswered(old, m) : m
  })
  return identical ? prev : out
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
function keepAnswered(local: Message, fresh: Message): Message {
  const answered = (local._blocks ?? []).filter(
    (b): b is Extract<ContentBlock, { type: 'tool_call' }> =>
      b.type === 'tool_call' && ANSWERED.has(b.data.status),
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
function sameStoredFields(a: Message, b: Message): boolean {
  for (const key of Object.keys(b) as (keyof Message)[]) {
    if (key === '_blocks') continue
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Where a waiting card lives and what it is asking about. Everything needed to
 *  redraw it, keyed elsewhere by the `approval_id` that answers it. */
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
  messages: Message[]
  streaming: boolean
  /** Which run of a turn is streaming here, so a stop event can be told from
   *  someone else's. Null when nothing is running, and also for a turn that
   *  died before it wrote its first message — those send a stop with no id and
   *  are accepted on that basis. */
  activeTurnId: string | null
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
  compactCursor: number | null
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
  branches: Record<string, BranchPoint>
  /** True while a switch is in flight, so the pager cannot be clicked again
   *  before the new path lands. */
  switchingBranch: boolean
  /** How each run of the agent loop ended, as the backend judged it.
   *
   *  Not derivable here. A turn that stopped without recording an ending leaves
   *  rows that look exactly like a turn that ended on a tool call, and only the
   *  backend's live register of what is running can say which. Empty until the
   *  first snapshot lands, which reads as "no opinion" everywhere. */
  turns: TurnRecord[]
}

function defaultSession(): ConversationSession {
  return {
    messages: [],
    streaming: false,
    activeTurnId: null,
    candidateTurnId: null,
    retry: null,
    compacting: false,
    error: null,
    fulfilledUnseen: false,
    pendingApprovals: {},
    pendingAsks: {},
    compactCursor: null,
    generation: 0,
    activeTodos: null,
    expandedTurns: {},
    branches: {},
    switchingBranch: false,
    turns: [],
  }
}

function indexBranches(points: BranchPoint[]): Record<string, BranchPoint> {
  return Object.fromEntries(points.map((p) => [p.message_id, p]))
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
function adoptLiveTurn(session: ConversationSession, turns: TurnRecord[]): void {
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
function mergeSnapshot(session: ConversationSession, snapshot: Message[]): Message[] {
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
  let lastAssistant: Message | undefined
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

function findAssistantMsg(msgs: Message[], messageId?: string): number {
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
  conversations: Conversation[]
  activeId: string | null
  projects: Project[]
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

  /** Where the reader came from, innermost last. Empty whenever they are
   *  looking at something they picked from the sidebar.
   *
   *  An explicit stack rather than following `parent_conversation_id` back up:
   *  the two answer different questions. The parent link says who spawned this,
   *  which is not necessarily who was on screen a moment ago. */
  navigationStack: string[]

  setActiveId: (id: string | null) => void
  /** Drill into a conversation, remembering the way back. */
  openConversation: (id: string) => void
  goBack: () => void
  setActiveProjectId: (id: string | null) => void
  refreshConversations: () => Promise<Conversation[]>
  refreshProjects: () => Promise<void>

  ensureSession: (convId: string) => void
  loadMessages: (convId: string) => Promise<void>
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
  handleMessageStart: (convId: string, messageId: string, turnId?: string) => void
  handleText: (convId: string, messageId: string, content: string) => void
  handleReasoning: (convId: string, messageId: string, content: string) => void
  handleToolCall: (convId: string, messageId: string, callId: string, toolName: string, args: string) => void
  handleToolApproval: (
    convId: string,
    messageId: string,
    approvalId: string,
    callId: string,
    toolName: string,
    retryReason?: string,
    originCallId?: string,
    /** Set when a delegated run is asking. The card is the `run_agent` block
     *  named by this, and the question goes inside it — `callId` names a tool
     *  in the sub-agent's conversation, which this row never called. */
    bubble?: { parentCallId: string; arguments: string; subConversationId?: string },
  ) => void
  /** A delegated run now exists. Arrives as soon as its conversation is
   *  written, not when it finishes, because the card has to be able to link to
   *  it and count its steps for the whole time it is running. */
  handleSubAgentStarted: (
    convId: string,
    messageId: string,
    callId: string,
    run: { conversationId: string; turnId: string; kind?: string },
  ) => void
  /** The nested question has an answer, or can no longer get one. Cross-
   *  conversation events cannot do this: the sub-agent's tool result is emitted
   *  on its own conversation, which the parent's session never sees. */
  resolveNestedApproval: (convId: string, approvalId: string) => void
  handleToolResult: (convId: string, messageId: string, callId: string, result: string, outcome?: string) => void
  /** The answer never landed — the backend has forgotten this request. Drops
   *  the buttons rather than leaving one that cannot work. Takes no
   *  conversation id: the approval id is a UUID, and a tool card does not know
   *  which conversation it is being rendered in. */
  markApprovalOrphaned: (approvalId: string) => void
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

  refreshConversations: async () => {
    const { activeProjectId } = get()
    // One query either way. Concatenating a second, archived result used to
    // leave two separately-sorted runs in one list — invisible while a row
    // showed nothing but its title, and plainly wrong now that each carries a
    // timestamp and a pin marker. The other branch never included archived
    // conversations to begin with, so this also settles which of the two was
    // right.
    // TODO: archived conversations are currently unreachable in the UI. There
    // is no archive/unarchive command either — `is_archived` is only ever read
    // while rendering. Both belong in one change.
    const conversations: Conversation[] = activeProjectId
      ? await api.listConversationsByProject(activeProjectId, false)
      : await api.listConversations()
    set({ conversations })
    return conversations
  },

  refreshProjects: async () => {
    const projects = await api.listProjects()
    set({ projects })
  },

  ensureSession: (convId) => {
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
    }))
  },

  loadMessages: async (convId) => {
    const generation = get().sessions[convId]?.generation ?? 0
    // One request, because these four things only mean anything together. A
    // tool call with no result row is either waiting on the user, still running,
    // or was abandoned when its turn died — identical in the database, and told
    // apart only by the approvals and the turn records that came back with it.
    const snap = await api.conversationSnapshot(convId)
    // Reconciled outside produce: comparing against immer drafts would pit proxy
    // references against plain ones.
    const snapshot = reconcileMessages(
      get().sessions[convId]?.messages ?? [],
      hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs),
    )
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
      const session = state.sessions[convId]
      // A turn started while the request was in flight. Its own events describe
      // the conversation better than this snapshot does, and the approvals it
      // just registered are not in there.
      if (session.generation !== generation) return
      session.messages = mergeSnapshot(session, snapshot)
      session.compactCursor = snap.conversation.compact_cursor
      session.branches = indexBranches(snap.tree.branches)
      session.turns = snap.turns
      adoptLiveTurn(session, snap.turns)
    }))
  },

  /** Show a different version of a step. The reply is the whole new path, so
   *  there is never a frame where the pagers describe messages that are no
   *  longer on screen. */
  switchBranch: async (convId, messageId) => {
    const generation = get().sessions[convId]?.generation ?? 0
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (session) session.switchingBranch = true
    }))
    let superseded = false
    try {
      // The switch moves the head; the snapshot afterwards is what the new path
      // actually is. Sequential rather than parallel because the second reads
      // what the first wrote — which is also what makes the window here wider
      // than anywhere else, hence the guard below.
      await api.switchBranch(convId, messageId)
      const snap = await api.conversationSnapshot(convId)
      const snapshot = reconcileMessages(
        get().sessions[convId]?.messages ?? [],
        hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs),
      )
      set(produce((state: ConversationStore) => {
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
        session.branches = indexBranches(snap.tree.branches)
        session.turns = snap.turns
        adoptLiveTurn(session, snap.turns)
        session.expandedTurns = {}
      }))
    } finally {
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.switchingBranch = false
      }))
    }
    // The head really did move, so what is on screen is a path the server no
    // longer agrees with. Read it again under whatever generation is current
    // now — `loadMessages` merges, which is what a live turn needs, and takes
    // its own generation so this cannot loop.
    if (superseded) await get().loadMessages(convId)
  },

  beginTurn: (convId, turnId) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  abortTurn: (convId, turnId, error) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  handleMessageStart: (convId, messageId, turnId) => {
    set(produce((state: ConversationStore) => {
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
        tool_calls: null,
        tool_call_id: null,
        sort_order: session.messages.length,
        created_at: Date.now(),
        reasoning_content: null,
        rating: null,
        schema_version: 2,
        is_compact_summary: 0,
      })
    }))
  },

  handleText: (convId, messageId, content) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  handleReasoning: (convId, messageId, content) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  handleToolCall: (convId, messageId, callId, toolName, args) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  handleToolApproval: (convId, messageId, approvalId, callId, toolName, retryReason, originCallId, bubble) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      const entry: PendingApprovalEntry = {
        providerCallId: callId,
        messageId,
        originCallId,
        toolName,
        retryReason,
      }
      if (toolName === 'ask_user') {
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
            arguments: bubble.arguments,
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
        (b) => b.type === 'tool_call' && b.data.call_id === callId
          && !ANSWERED.has(b.data.status)
          && (retryReason !== undefined || (!b.data.approval_id && b.data.status !== 'pending')),
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
    }))
  },

  handleSubAgentStarted: (convId, messageId, callId, run) => {
    set(produce((state: ConversationStore) => {
      // Seeded even when there is no session to draw into: the counter is keyed
      // by turn and read by whichever card ends up rendering, and a run whose
      // parent is not open still writes rows the moment it starts.
      state.subAgentSteps[run.turnId] = state.subAgentSteps[run.turnId] ?? 0
      const session = state.sessions[convId]
      if (!session) return
      const target = session.messages.find((m) => m.id === messageId)
      const card = (target?._blocks ?? []).find(
        (b) => b.type === 'tool_call' && b.data.call_id === callId,
      )
      if (card?.type === 'tool_call') {
        card.data.sub_agent = {
          conversation_id: run.conversationId,
          turn_id: run.turnId,
          kind: run.kind,
          steps: 0,
        }
      }
    }))
  },

  resolveNestedApproval: (convId, approvalId) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  handleToolResult: (convId, messageId, callId, result, outcome) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      const status: ToolCallDisplay['status'] =
        outcome === 'denied' ? 'denied'
          : outcome === 'error' ? 'error'
            : 'completed'
      // Same locality rule as the approval above, and the same notion of still
      // outstanding: results arrive in the order the calls were made, so the
      // first card without an answer is the one this answers.
      const target = session.messages.find((m) => m.id === messageId)
      const card = (target?._blocks ?? []).find(
        (b) => b.type === 'tool_call' && b.data.call_id === callId
          && !ANSWERED.has(b.data.status),
      )
      if (card?.type === 'tool_call') {
        // Retire the entry this card was waiting on, not every entry sharing
        // the call id — a sibling call may still have one outstanding.
        if (card.data.approval_id) {
          delete session.pendingApprovals[card.data.approval_id]
          delete session.pendingAsks[card.data.approval_id]
        }
        card.data.status = status
        card.data.result = result
        card.data.approval_id = undefined
        // The checklist bar tracks the arguments of the last successful call;
        // a rejected one left the stored list untouched.
        if (card.data.tool_name === 'update_todos' && status === 'completed') {
          session.activeTodos = readTodoArgs(card.data.arguments)
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
    }))
  },

  markApprovalOrphaned: (approvalId) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  setActiveTodos: (convId, todos) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (session) session.activeTodos = todos
    }))
  },

  // The streamed tool events are gone after a reload or a conversation switch,
  // so the bar comes back from the database instead.
  loadActiveTodos: async (convId) => {
    // Declared without an initialiser: the catch returns, so the only way to
    // reach the use below is through the successful assignment.
    let view: TodoListView | null
    try {
      view = await api.getActiveTodoList(convId)
    } catch {
      return
    }
    get().setActiveTodos(
      convId,
      view ? { title: view.list.title, todos: toDrafts(view.items) } : null,
    )
  },

  handleRetry: (convId, attempt, max, delayMs) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      // Not scoped to a turn: the event names the assistant row, and a session
      // that is not showing that row is not showing the header this appears in
      // either. The next thing to happen on any turn clears it.
      if (session) session.retry = { attempt, max, delayMs }
    }))
  },

  handleStreamReset: (convId, messageId) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      const idx = findAssistantMsg(session.messages, messageId)
      if (idx < 0) return
      const target = session.messages[idx]
      target.content = ''
      target._blocks = undefined
    }))
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
    set(produce((state: ConversationStore) => {
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
          if (block.type === 'tool_call' && block.data.approval_id === id) {
            block.data.status = 'orphaned'
            block.data.approval_id = undefined
          }
        }
      }
      session.pendingApprovals = {}
      session.pendingAsks = {}
      if (convId !== state.activeId) {
        session.fulfilledUnseen = true
      }
    }))
    // The whole snapshot, not just the messages: a turn that regenerated an
    // answer has just created a branch point, and the pager for it has to
    // appear now rather than the next time the conversation is opened. The turn
    // records matter here more than anywhere — this is the moment a turn ends,
    // and how it ended is what says whether the calls above are abandoned or
    // were simply never going to be answered by anyone.
    api.conversationSnapshot(convId).then((snap) => {
      const snapshot = reconcileMessages(
        get().sessions[convId]?.messages ?? [],
        hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs),
      )
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // A new stream started while this snapshot was in flight; its own stop
        // handler will reload, so applying the stale snapshot would clobber it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
        session.branches = indexBranches(snap.tree.branches)
        session.turns = snap.turns
      }))
    })
  },

  handleCompactStart: (convId) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (session) session.compacting = true
    }))
  },

  handleCompactDone: (convId, midTurn) => {
    if (midTurn) {
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.compacting = false
      }))
      return
    }
    const generation = get().sessions[convId]?.generation ?? 0
    api.conversationSnapshot(convId).then((snap) => {
      const snapshot = reconcileMessages(
        get().sessions[convId]?.messages ?? [],
        hydrateBlocks(snap.tree.messages, snap.pending_approvals, snap.turns, snap.sub_agent_runs),
      )
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        session.compacting = false
        // A stream may have advanced while this snapshot was in flight; merge
        // instead of clobbering, and skip entirely if a newer turn superseded it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
        session.branches = indexBranches(snap.tree.branches)
        session.compactCursor = snap.conversation.compact_cursor
        session.turns = snap.turns
      }))
    }).catch(() => {
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.compacting = false
      }))
    })
  },

  setStreaming: (convId, value) => {
    set(produce((state: ConversationStore) => {
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
    }))
  },

  setCompacting: (convId, value) => {
    set(produce((state: ConversationStore) => {
      if (state.sessions[convId]) {
        state.sessions[convId].compacting = value
      }
    }))
  },

  setError: (convId, error) => {
    set(produce((state: ConversationStore) => {
      if (state.sessions[convId]) {
        state.sessions[convId].error = error
      }
    }))
  },

  markSeen: (convId) => {
    set(produce((state: ConversationStore) => {
      if (state.sessions[convId]) {
        state.sessions[convId].fulfilledUnseen = false
      }
    }))
  },

  setTurnExpanded: (convId, turnId, expanded) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (session) session.expandedTurns[turnId] = expanded
    }))
  },
}))
