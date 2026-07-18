import { create } from 'zustand'
import { produce } from 'immer'
import { api } from '@/api'
import type { Conversation, Message, Project, ContentBlock, OpenAIToolCall, ToolCallDisplay } from '@/types'

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
  }
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

  handleMessageStart: (convId: string, messageId: string) => void
  handleText: (convId: string, messageId: string, content: string) => void
  handleReasoning: (convId: string, messageId: string, content: string) => void
  handleToolCall: (convId: string, messageId: string, callId: string, toolName: string, args: string) => void
  handleToolApproval: (convId: string, messageId: string, callId: string, toolName: string, args: string) => void
  handleToolResult: (convId: string, callId: string, result: string) => void
  handleStop: (convId: string) => void
  handleCompactStart: (convId: string) => void
  handleCompactDone: (convId: string) => void

  setStreaming: (convId: string, value: boolean) => void
  setCompacting: (convId: string, value: boolean) => void
  setError: (convId: string, error: string | null) => void
  markSeen: (convId: string) => void
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
    const [msgs, conv] = await Promise.all([
      api.loadMessages(convId),
      api.getConversation(convId),
    ])
    set(produce((state: ConversationStore) => {
      if (!state.sessions[convId]) {
        state.sessions[convId] = defaultSession()
      }
      const session = state.sessions[convId]
      session.messages = mergeSnapshot(session, hydrateBlocks(msgs))
      session.compactCursor = conv.compact_cursor
    }))
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

  handleToolApproval: (convId, _messageId, callId, toolName) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      if (toolName === 'ask_user') {
        session.pendingAskUser = callId
      } else {
        session.pendingApproval = callId
      }
      for (const msg of session.messages) {
        if (!msg._blocks) continue
        for (const block of msg._blocks) {
          if (block.type === 'tool_call' && block.data.call_id === callId) {
            block.data.status = 'pending'
          }
        }
      }
    }))
  },

  handleToolResult: (convId, callId, result) => {
    set(produce((state: ConversationStore) => {
      const session = state.sessions[convId]
      if (!session) return
      if (session.pendingApproval === callId) session.pendingApproval = null
      if (session.pendingAskUser === callId) session.pendingAskUser = null
      for (const msg of session.messages) {
        if (!msg._blocks) continue
        for (const block of msg._blocks) {
          if (block.type === 'tool_call' && block.data.call_id === callId) {
            (block.data as ToolCallDisplay).status = 'completed';
            (block.data as ToolCallDisplay).result = result
          }
        }
      }
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
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        // A new stream started while this snapshot was in flight; its own stop
        // handler will reload, so applying the stale snapshot would clobber it.
        if (session.generation !== generation) return
        session.messages = mergeSnapshot(session, hydrateBlocks(msgs))
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
    Promise.all([api.loadMessages(convId), api.getConversation(convId)]).then(([msgs, conv]) => {
      set(produce((state: ConversationStore) => {
        const session = state.sessions[convId]
        if (!session) return
        session.compacting = false
        session.messages = hydrateBlocks(msgs)
        session.compactCursor = conv.compact_cursor
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
}))
