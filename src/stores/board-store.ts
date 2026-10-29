import { create } from 'zustand'

import { api } from '@/api'
import { useConversationStore } from '@/stores/conversation-store'
import type { BoardAgentKind, BoardStage, BoardTaskInfoResponse } from '@/types'

/**
 * The agent board: its cards as the backend has them, and what the page is
 * showing of them.
 *
 * The cards are read whole on open and again on every `board-updated` — a
 * move renumbers a column, so patching one card would leave its neighbours'
 * positions stale. What each agent is doing is not here: it is the
 * conversation store's (sessions, the attention queue), and the board reads
 * it from there so a card and the transcript can never disagree. Loading the
 * cards also loads a snapshot for every card's conversation that has no
 * session yet, which is what gives an unopened conversation its turns.
 */
interface BoardState {
  tasks: BoardTaskInfoResponse[]
  loaded: boolean
  error: string | null
  load: () => Promise<void>

  /** Columns drawn full width; the rest are folded to a rail. */
  openColumns: BoardStage[]
  setColumnOpen: (stage: BoardStage, open: boolean) => void
  setOpenColumns: (stages: BoardStage[]) => void
  /** Cards opened in place; several at once. */
  expanded: string[]
  setExpanded: (id: string, open: boolean) => void
  /** The card the strip or PageUp / PageDown last went to. */
  focused: string | null
  setFocused: (id: string | null) => void
  /** Which agent a card starts with, the last one chosen. */
  agentKind: BoardAgentKind
  setAgentKind: (kind: BoardAgentKind) => void
  /**
   * What is typed in a card's box. Held here because masonry deals cards into
   * a new `CardList` when the lane count changes, and React treats that as a
   * remount — local state in the composer would throw the text away.
   */
  composerText: Record<string, string>
  setComposerText: (id: string, value: string) => void
  /**
   * The project a draft will create under. Same remount as the text: a draft
   * that kept its words and forgot its project would start in a different
   * repository.
   */
  draftProjectId: Record<string, string>
  setDraftProjectId: (id: string, projectId: string | null) => void
}

const AGENT_KIND_KEY = 'meridian.board.agentKind'

function storedAgentKind(): BoardAgentKind {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(AGENT_KIND_KEY)
  // An unknown or absent value is a first visit, not a corrupt one: the
  // choice is the person's convenience, and the native agent is the app's own.
  return stored === 'claude_code' ? 'claude_code' : 'native'
}

export const useBoardStore = create<BoardState>((set) => ({
  tasks: [],
  loaded: false,
  error: null,
  load: async () => {
    let tasks: BoardTaskInfoResponse[]
    try {
      tasks = await api.boardTaskList()
    } catch (err) {
      set({ error: String(err) })
      return
    }
    set({ tasks, loaded: true, error: null })
    const conversations = useConversationStore.getState()
    for (const task of tasks) {
      if (task.conversation_id !== null && !conversations.sessions[task.conversation_id]) {
        void conversations.loadMessages(task.conversation_id)
      }
    }
  },

  openColumns: ['running'],
  setColumnOpen: (stage, open) =>
    set(({ openColumns }) => ({
      openColumns: open ? [...new Set([...openColumns, stage])] : openColumns.filter((s) => s !== stage),
    })),
  setOpenColumns: (openColumns) => set({ openColumns }),
  expanded: [],
  setExpanded: (id, open) =>
    set(({ expanded }) => ({
      expanded: open ? [...new Set([...expanded, id])] : expanded.filter((e) => e !== id),
    })),
  focused: null,
  setFocused: (focused) => set({ focused }),
  agentKind: storedAgentKind(),
  setAgentKind: (agentKind) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AGENT_KIND_KEY, agentKind)
    set({ agentKind })
  },
  composerText: {},
  setComposerText: (id, value) =>
    set(({ composerText }) => {
      if (value === '') {
        const { [id]: _dropped, ...rest } = composerText
        return { composerText: rest }
      }
      return { composerText: { ...composerText, [id]: value } }
    }),
  draftProjectId: {},
  setDraftProjectId: (id, projectId) =>
    set(({ draftProjectId }) => {
      if (projectId === null) {
        const { [id]: _dropped, ...rest } = draftProjectId
        return { draftProjectId: rest }
      }
      return { draftProjectId: { ...draftProjectId, [id]: projectId } }
    }),
}))
