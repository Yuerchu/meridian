import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { api } from '@/api'
import type { ConversationSnapshotResponse } from '@/types'

vi.mock('@tauri-apps/api/core')
vi.mock('@/api', () => ({
  api: {
    conversationSnapshot: vi.fn(),
    activeUserShellTurn: vi.fn(() => Promise.resolve(null)),
    getActiveTodoList: vi.fn(),
  },
}))

const CONV = 'errors'
const store = () => useConversationStore.getState()

function emptySnapshot(): ConversationSnapshotResponse {
  return {
    conversation: {} as ConversationSnapshotResponse['conversation'],
    tree: { messages: [], head_message_id: null, branches: [] },
    turns: [],
    pending_approvals: [],
    plan_reviews: [],
    plan_review_barrier: false,
    sub_agent_runs: [],
    acp_notices: [],
  }
}

/**
 * "The whole message page errors and shows no reason, or it flashes." These
 * pin the store half of that: where a failure is kept, and what may clear it.
 */
describe('conversation errors are kept until something genuinely changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {}, attention: {}, attentionOrder: [] })
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
    vi.mocked(api.activeUserShellTurn).mockResolvedValue(null)
  })

  // The flash. A send that is refused sets the error, and the reload that
  // follows every refusal used to clear it in the same tick.
  it('a successful reload does not clear the error of the action that preceded it', async () => {
    store().ensureSession(CONV)
    store().setError(CONV, 'provider rejected the API key')
    vi.mocked(api.conversationSnapshot).mockResolvedValue(emptySnapshot())

    expect(await store().loadMessages(CONV)).toBe(true)

    expect(store().sessions[CONV].error).toBe('provider rejected the API key')
  })

  it('keeps a failed read apart from the action error, and clears it on the next good read', async () => {
    store().ensureSession(CONV)
    vi.mocked(api.conversationSnapshot).mockRejectedValueOnce('database is locked')

    expect(await store().loadMessages(CONV)).toBe(false)
    expect(store().sessions[CONV].loadError).toBe('database is locked')
    expect(store().sessions[CONV].error).toBeNull()

    vi.mocked(api.conversationSnapshot).mockResolvedValue(emptySnapshot())
    expect(await store().loadMessages(CONV)).toBe(true)
    expect(store().sessions[CONV].loadError).toBeNull()
  })

  it('does not drop a failure reported before the session exists', async () => {
    vi.mocked(api.conversationSnapshot).mockRejectedValueOnce('no such conversation')

    await store().loadMessages('never-opened')

    expect(store().sessions['never-opened']?.loadError).toBe('no such conversation')
  })

  it('a new turn is what clears an action error', () => {
    store().ensureSession(CONV)
    store().setError(CONV, 'stop refused')
    store().beginTurn(CONV, 'turn-2')
    expect(store().sessions[CONV].error).toBeNull()
  })

  it('a failed checklist read keeps the checklist and says why', async () => {
    store().ensureSession(CONV)
    store().setActiveTodos(CONV, { title: 'Plan', todos: [] })
    vi.mocked(api.getActiveTodoList).mockRejectedValueOnce('timed out')

    await store().loadActiveTodos(CONV)

    expect(store().sessions[CONV].todosError).toBe('timed out')
    expect(store().sessions[CONV].activeTodos).toEqual({ title: 'Plan', todos: [] })

    vi.mocked(api.getActiveTodoList).mockResolvedValueOnce(null)
    await store().loadActiveTodos(CONV)
    expect(store().sessions[CONV].todosError).toBeNull()
  })

  it('keeps the reason a refused answer gave on the card it orphaned', () => {
    store().ensureSession(CONV)
    useConversationStore.setState((state) => {
      const session = state.sessions[CONV]
      return {
        sessions: {
          ...state.sessions,
          [CONV]: {
            ...session,
            pendingApprovals: { ap: { messageId: 'm1', callId: 'call-1' } as never },
            messages: [
              {
                id: 'm1',
                role: 'assistant',
                _blocks: [
                  {
                    type: 'tool_call',
                    data: {
                      call_id: 'call-1',
                      tool_name: 'run_command',
                      arguments: '{}',
                      status: 'pending',
                      approval_id: 'ap',
                    },
                  },
                ],
              } as never,
            ],
          },
        },
      }
    })

    store().markApprovalOrphaned('ap', 'the turn has already ended')

    const block = store().sessions[CONV].messages[0]._blocks?.[0]
    expect(block?.type === 'tool_call' && block.data).toMatchObject({
      status: 'orphaned',
      answer_error: 'the turn has already ended',
    })
  })
})
