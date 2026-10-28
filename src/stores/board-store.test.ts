import { afterEach, describe, expect, it, vi } from 'vitest'

import { useBoardStore } from '@/stores/board-store'

vi.mock('@/api', () => ({
  api: {
    boardTaskList: vi.fn(() => Promise.resolve([])),
  },
}))

afterEach(() => {
  useBoardStore.setState({
    tasks: [],
    loaded: false,
    error: null,
    composerText: {},
    draftProjectId: {},
  })
})

describe('draft project selection', () => {
  it('keeps a draft project across a remount-shaped store read', () => {
    useBoardStore.getState().setDraftProjectId('draft:backlog', 'project-other')
    expect(useBoardStore.getState().draftProjectId['draft:backlog']).toBe('project-other')
  })

  it('drops a cleared draft project so the next open uses the remembered default', () => {
    useBoardStore.getState().setDraftProjectId('draft:backlog', 'project-other')
    useBoardStore.getState().setDraftProjectId('draft:backlog', null)
    expect(useBoardStore.getState().draftProjectId).not.toHaveProperty('draft:backlog')
  })
})
