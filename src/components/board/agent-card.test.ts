import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import { settleAfterCardDeleted } from './agent-card'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore } from '@/stores/conversation-store'
import type { ConversationInfoResponse } from '@/types'

vi.mock('@/api', () => ({
  api: {
    boardTaskList: vi.fn(),
    listConversations: vi.fn(),
  },
}))

const leftover = { id: 'c-other' } as ConversationInfoResponse
const deleted = { id: 'c-deleted' } as ConversationInfoResponse

beforeEach(() => {
  vi.mocked(api.boardTaskList).mockResolvedValue([])
  vi.mocked(api.listConversations).mockResolvedValue([leftover])
  useBoardStore.setState({ tasks: [], loaded: true, error: null })
  useConversationStore.setState({
    conversations: [deleted, leftover],
    activeId: 'c-deleted',
  })
})

afterEach(() => {
  vi.clearAllMocks()
  useBoardStore.setState({ tasks: [], loaded: false, error: null })
  useConversationStore.setState({ conversations: [], activeId: null })
})

describe('settleAfterCardDeleted', () => {
  it('refreshes the sidebar and leaves the deleted conversation if it is open', async () => {
    await settleAfterCardDeleted('c-deleted')
    expect(api.boardTaskList).toHaveBeenCalled()
    expect(api.listConversations).toHaveBeenCalled()
    expect(useConversationStore.getState().conversations).toEqual([leftover])
    expect(useConversationStore.getState().activeId).toBeNull()
  })

  it('does not refresh conversations when the card never started', async () => {
    await settleAfterCardDeleted(null)
    expect(api.boardTaskList).toHaveBeenCalled()
    expect(api.listConversations).not.toHaveBeenCalled()
    expect(useConversationStore.getState().activeId).toBe('c-deleted')
  })

  it('leaves a different open conversation alone', async () => {
    useConversationStore.setState({ activeId: 'c-other' })
    await settleAfterCardDeleted('c-deleted')
    expect(useConversationStore.getState().activeId).toBe('c-other')
  })
})
