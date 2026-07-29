import { create } from 'zustand'
import { produce } from 'immer'
import { api } from '@/api'
import { parseTodoArgs, toDrafts, type TodoArgs } from '@/components/chat/todo-list'
import type { BranchPoint, Conversation, Message, Project, ContentBlock, OpenAIToolCall, TodoListView, ToolCallDisplay } from '@/types'

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

export function hydrateBlocks(msgs: Message[]): Message[] {
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
          for (const tc of tcs) {
            const toolMsg = msgs.find((tm) => tm.role === 'tool' && tm.tool_call_id === tc.id)
            blocks.push({
              type: 'tool_call',
              data: {
                call_id: tc.id,
                tool_name: tc.function.name,
                arguments: tc.function.arguments,
                status: 'completed',
                result: toolMsg?.content,
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

export interface ConversationSession {
  messages: Message[]
  streaming: boolean
  compacting: boolean
  error: string | null
  fulfilledUnseen: boolean
  pendingApproval: string | null
  pendingAskUser: string | null
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
    compacting: false,
    error: null,
    fulfilledUnseen: false,
    pendingApproval: null,
    pendingAskUser: null,
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

  handleMessageStart: (convId: string, messageId: string) => void
  handleText: (convId: string, messageId: string, content: string) => void
  handleReasoning: (convId: string, messageId: string, content: string) => void
  handleToolCall: (convId: string, messageId: string, callId: string, toolName: string, args: string) => void
  handleToolApproval: (
    convId: string,
    messageId: string,
    callId: string,
    toolName: string,
    args: string,
    escalation?: { originCallId: string; retryReason?: string },
  ) => void
  handleToolResult: (convId: string, callId: string, result: string, outcome?: string) => void
  handleStreamReset: (convId: string, messageId: string) => void
  handleStop: (convId: string) => void
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
    const [tree, conv] = await Promise.all([
      api.loadMessageTree(convId),
      api.getConversation(convId),
    ])
    // Reconciled outside produce: comparing against immer drafts would pit proxy
    // references against plain ones.
    const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(tree.messages))
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
      const session = state.sessions[convId]
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
      const tree = await api.switchBranch(convId, messageId)
      const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(tree.messages))
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

  handleMessageStart: (convId, messageId) => {
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
      const session = state.sessions[convId]
      session.streaming = true
      session.generation += 1
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

  handleToolApproval: (convId, _messageId, callId, toolName, _args, escalation) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      if (toolName === 'ask_user') {
        session.pendingAskUser = callId
      } else {
        session.pendingApproval = callId
      }
      // Escalation approvals use a synthetic "<id>:retry" call id; the block
      // to update is the original call.
      const targetId = escalation?.originCallId ?? callId
      for (const msg of session.messages) {
        if (!msg._blocks) continue
        for (const block of msg._blocks) {
          if (block.type === 'tool_call' && block.data.call_id === targetId) {
            block.data.status = 'pending'
            if (escalation) {
              (block.data as ToolCallDisplay).escalation_call_id = callId
              ;(block.data as ToolCallDisplay).retry_reason = escalation.retryReason
            }
          }
        }
      }
    }))
  },

  handleToolResult: (convId, callId, result, outcome) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      if (session.pendingApproval === callId || session.pendingApproval === `${callId}:retry`) {
        session.pendingApproval = null
      }
      if (session.pendingAskUser === callId) session.pendingAskUser = null
      const status: ToolCallDisplay['status'] =
        outcome === 'denied' ? 'denied'
          : outcome === 'error' ? 'error'
            : 'completed'
      for (const msg of session.messages) {
        if (!msg._blocks) continue
        for (const block of msg._blocks) {
          if (block.type === 'tool_call' && block.data.call_id === callId) {
            (block.data as ToolCallDisplay).status = status;
            (block.data as ToolCallDisplay).result = result;
            (block.data as ToolCallDisplay).escalation_call_id = undefined
            // The checklist bar tracks the arguments of the last successful
            // call; a rejected one left the stored list untouched.
            if (block.data.tool_name === 'update_todos' && status === 'completed') {
              session.activeTodos = readTodoArgs(block.data.arguments)
            }
          }
        }
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

  handleStop: (convId) => {
    const generation = get().sessions[convId]?.generation ?? 0
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      session.streaming = false
      session.pendingApproval = null
      session.pendingAskUser = null
      if (convId !== state.activeId) {
        session.fulfilledUnseen = true
      }
    }))
    api.loadMessages(convId).then((msgs) => {
      const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(msgs))
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // A new stream started while this snapshot was in flight; its own stop
        // handler will reload, so applying the stale snapshot would clobber it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
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
    Promise.all([api.loadMessages(convId), api.getConversation(convId)]).then(([msgs, conv]) => {
      const snapshot = reconcileMessages(get().sessions[convId]?.messages ?? [], hydrateBlocks(msgs))
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        session.compacting = false
        // A stream may have advanced while this snapshot was in flight; merge
        // instead of clobbering, and skip entirely if a newer turn superseded it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, snapshot)
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
