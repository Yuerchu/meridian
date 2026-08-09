import { create } from 'zustand'
import { produce } from 'immer'
import { api } from '@/api'
import { parseTodoArgs, toDrafts, type TodoArgs } from '@/components/chat/todo-list'
import type { BranchPoint, Conversation, Message, PendingApprovalInfo, Project, ContentBlock, OpenAIToolCall, TodoListView, ToolCallDisplay } from '@/types'

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

function indexApprovals(pending: PendingApprovalInfo[]): ApprovalIndex {
  const out: ApprovalIndex = new Map()
  for (const p of pending) {
    let byCall = out.get(p.assistant_message_id)
    if (!byCall) {
      byCall = new Map()
      out.set(p.assistant_message_id, byCall)
    }
    const bucket = byCall.get(p.provider_call_id)
    if (bucket) bucket.push(p)
    else byCall.set(p.provider_call_id, [p])
  }
  return out
}

/**
 * Rebuild the display blocks of every assistant row from its stored columns.
 *
 * `pending` is what the backend is still holding a turn open for. Without it a
 * call with no tool row is indistinguishable from one that is waiting on the
 * user, and guessing `completed` — which is what this used to do — erases the
 * approval buttons and strands the turn forever.
 */
export function hydrateBlocks(msgs: Message[], pending: PendingApprovalInfo[] = []): Message[] {
  const answers = toolRowsByAssistant(msgs)
  // Consumed as they match, so two calls sharing an id cannot both claim the
  // same approval.
  const waiting = indexApprovals(pending)

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
            blocks.push({
              type: 'tool_call',
              data: {
                call_id: tc.id,
                tool_name: tc.function.name,
                arguments: tc.function.arguments,
                // Answered, waiting, or abandoned — the three cases the
                // transcript alone cannot tell apart.
                status: toolMsg ? 'completed' : stillWaiting ? 'pending' : 'orphaned',
                result: toolMsg?.content,
                approval_id: stillWaiting?.approval_id,
                retry_reason: stillWaiting?.retry_reason,
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
    return m
  })
  return identical ? prev : out
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
}

function defaultSession(): ConversationSession {
  return {
    messages: [],
    streaming: false,
    activeTurnId: null,
    candidateTurnId: null,
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
  }
}

function indexBranches(points: BranchPoint[]): Record<string, BranchPoint> {
  return Object.fromEntries(points.map((p) => [p.message_id, p]))
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

  setActiveId: (id: string | null) => void
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
  ) => void
  handleToolResult: (convId: string, messageId: string, callId: string, result: string, outcome?: string) => void
  /** The answer never landed — the backend has forgotten this request. Drops
   *  the buttons rather than leaving one that cannot work. Takes no
   *  conversation id: the approval id is a UUID, and a tool card does not know
   *  which conversation it is being rendered in. */
  markApprovalOrphaned: (approvalId: string) => void
  handleStreamReset: (convId: string, messageId: string) => void
  /** `turnId` names the run that stopped. A stop for a run this session is not
   *  showing still reloads — the transcript changed either way — but must not
   *  clear the streaming flag or the approvals of the turn that is showing. */
  handleStop: (convId: string, turnId?: string) => void
  handleCompactStart: (convId: string) => void
  handleCompactDone: (convId: string) => void

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
  activeProjectId: null,
  sessions: {},

  setActiveId: (id) => {
    set({ activeId: id })
    if (id) get().markSeen(id)
  },

  setActiveProjectId: (id) => {
    set({ activeProjectId: id, activeId: null })
  },

  refreshConversations: async () => {
    const { activeProjectId } = get()
    let conversations: Conversation[]
    if (activeProjectId) {
      const [active, archived] = await Promise.all([
        api.listConversationsByProject(activeProjectId, false),
        api.listConversationsByProject(activeProjectId, true),
      ])
      conversations = [...active, ...archived]
    } else {
      conversations = await api.listConversations()
    }
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
    // Fetched alongside the transcript, not from it: a tool call with no result
    // row is either waiting on the user or was abandoned when its turn died,
    // and those two are identical in the database.
    const [tree, conv, approvals] = await Promise.all([
      api.loadMessageTree(convId),
      api.getConversation(convId),
      api.listPendingApprovals(convId),
    ])
    // Reconciled outside produce: comparing against immer drafts would pit proxy
    // references against plain ones.
    const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(tree.messages, approvals))
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
      const session = state.sessions[convId]
      // A turn started while these three requests were in flight. Its own
      // events describe the conversation better than this snapshot does, and
      // the approvals it just registered are not in there.
      if (session.generation !== generation) return
      session.messages = mergeSnapshot(session, snapshot)
      session.compactCursor = conv.compact_cursor
      session.branches = indexBranches(tree.branches)
    }))
  },

  /** Show a different version of a step. The reply is the whole new path, so
   *  there is never a frame where the pagers describe messages that are no
   *  longer on screen. */
  switchBranch: async (convId, messageId) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (session) session.switchingBranch = true
    }))
    try {
      const [tree, approvals] = await Promise.all([
        api.switchBranch(convId, messageId),
        api.listPendingApprovals(convId),
      ])
      const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(tree.messages, approvals))
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // Replaced outright, not merged: what is local belongs to the branch
        // being left, and splicing it in would carry messages across.
        session.messages = snapshot
        session.branches = indexBranches(tree.branches)
        session.expandedTurns = {}
      }))
    } finally {
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (session) session.switchingBranch = false
      }))
    }
  },

  beginTurn: (convId, turnId) => {
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
      const session = state.sessions[convId]
      session.streaming = true
      session.activeTurnId = turnId
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
    }))
  },

  handleMessageStart: (convId, messageId, turnId) => {
    set(produce((state: ConversationStore) => {
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
      blocks.push({
        type: 'tool_call',
        data: {
          call_id: callId,
          tool_name: toolName,
          arguments: args,
          status: 'running',
        },
      })
      target._blocks = blocks
    }))
  },

  handleToolApproval: (convId, messageId, approvalId, callId, toolName, retryReason, originCallId) => {
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
      // Only under the assistant row that asked, and only the first card there
      // that has not already been claimed. Scanning the whole transcript — which
      // this used to do — lights up every card sharing the id, and gateways
      // that restart their ids at "0" make that routine; lighting up all of
      // them within one row is the same mistake at smaller scale.
      const target = session.messages.find((m) => m.id === messageId)
      const card = (target?._blocks ?? []).find(
        (b) => b.type === 'tool_call' && b.data.call_id === callId && !b.data.approval_id
          && b.data.status !== 'pending',
      )
      if (card?.type === 'tool_call') {
        card.data.status = 'pending'
        card.data.approval_id = approvalId
        card.data.retry_reason = retryReason
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
      // Same locality and claim-once rules as the approval above: results
      // arrive in the order the calls were made, so the first card still
      // outstanding is the one this answers.
      const target = session.messages.find((m) => m.id === messageId)
      const card = (target?._blocks ?? []).find(
        (b) => b.type === 'tool_call' && b.data.call_id === callId
          && b.data.status !== 'completed' && b.data.status !== 'denied'
          && b.data.status !== 'error',
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
          if (block.type === 'tool_call' && block.data.approval_id === approvalId) {
            block.data.status = 'orphaned'
            block.data.approval_id = undefined
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
    // The whole tree, not just the messages: a turn that regenerated an answer
    // has just created a branch point, and the pager for it has to appear now
    // rather than the next time the conversation is opened.
    api.loadMessageTree(convId).then((tree) => {
      const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(tree.messages))
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // A new stream started while this snapshot was in flight; its own stop
        // handler will reload, so applying the stale snapshot would clobber it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
        session.branches = indexBranches(tree.branches)
      }))
    })
  },

  handleCompactStart: (convId) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (session) session.compacting = true
    }))
  },

  handleCompactDone: (convId) => {
    const generation = get().sessions[convId]?.generation ?? 0
    Promise.all([
      api.loadMessageTree(convId),
      api.getConversation(convId),
      api.listPendingApprovals(convId),
    ]).then(([tree, conv, approvals]) => {
      const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(tree.messages, approvals))
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        session.compacting = false
        // A stream may have advanced while this snapshot was in flight; merge
        // instead of clobbering, and skip entirely if a newer turn superseded it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
        session.branches = indexBranches(tree.branches)
        session.compactCursor = conv.compact_cursor
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
