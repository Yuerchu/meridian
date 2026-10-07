import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/api'
import type { WorkspaceGitStatusResponse } from '@/types'
import { useProjectBranch } from './use-project-branch'

vi.mock('@/api', () => ({
  api: {
    workspaceGitStatus: vi.fn(),
  },
}))

const gitStatus = vi.mocked(api.workspaceGitStatus)

function onBranch(branch: string | null): WorkspaceGitStatusResponse {
  return { state: 'ok', branch, files: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/** `require_root` refuses a conversation without a folder; asking anyway is a
 *  failed IPC call on every plain chat. */
test('asks nothing without a project folder', () => {
  const { result } = renderHook(() => useProjectBranch('c1', false, false))
  expect(result.current).toBeNull()
  expect(gitStatus).not.toHaveBeenCalled()
})

test('reads the branch the status names', async () => {
  gitStatus.mockResolvedValue(onBranch('feat/x'))
  const { result } = renderHook(() => useProjectBranch('c1', true, false))
  expect(result.current).toEqual({ status: 'loading' })
  await waitFor(() => expect(result.current).toEqual({ status: 'branch', name: 'feat/x' }))
  expect(gitStatus).toHaveBeenCalledWith({ conversationId: 'c1' })
})

test("git's detached spelling is a state, not a branch name", async () => {
  gitStatus.mockResolvedValue(onBranch('(detached)'))
  const { result } = renderHook(() => useProjectBranch('c1', true, false))
  await waitFor(() => expect(result.current).toEqual({ status: 'detached' }))
})

test.each([
  ['not a repository', () => gitStatus.mockResolvedValue({ state: 'not_repo' })],
  ['no git', () => gitStatus.mockResolvedValue({ state: 'no_git' })],
  ['no branch line', () => gitStatus.mockResolvedValue(onBranch(null))],
  ['a failed read', () => gitStatus.mockRejectedValue('git status failed')],
])('%s shows nothing', async (_, arrange) => {
  arrange()
  const { result } = renderHook(() => useProjectBranch('c1', true, false))
  await waitFor(() => expect(result.current).toEqual({ status: 'none' }))
})

/** Opened mid-turn, the conversation still gets its first read; after that the
 *  turn has to end before the branch is asked about again. */
test('reads once mid-turn, then again when the turn ends', async () => {
  gitStatus.mockResolvedValue(onBranch('main'))
  const { result, rerender } = renderHook(({ busy }) => useProjectBranch('c1', true, busy), {
    initialProps: { busy: true },
  })
  await waitFor(() => expect(result.current).toEqual({ status: 'branch', name: 'main' }))
  expect(gitStatus).toHaveBeenCalledTimes(1)

  gitStatus.mockResolvedValue(onBranch('feat/after-checkout'))
  // Coming back to the window mid-turn is not a reason to read either.
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  expect(gitStatus).toHaveBeenCalledTimes(1)

  rerender({ busy: false })
  await waitFor(() => expect(result.current).toEqual({ status: 'branch', name: 'feat/after-checkout' }))
  expect(gitStatus).toHaveBeenCalledTimes(2)

  // The next turn starting is not an edge to read on: only its end is.
  rerender({ busy: true })
  expect(gitStatus).toHaveBeenCalledTimes(2)
})

test('reads again when the window comes back to the front', async () => {
  gitStatus.mockResolvedValue(onBranch('main'))
  const { result } = renderHook(() => useProjectBranch('c1', true, false))
  await waitFor(() => expect(result.current).toEqual({ status: 'branch', name: 'main' }))

  gitStatus.mockResolvedValue(onBranch('dev'))
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(result.current).toEqual({ status: 'branch', name: 'dev' }))
})

/** Another conversation may be another repository: the last one's branch must
 *  not stand in for its own while the read is on its way. */
test('another conversation starts from loading, not from the last branch', async () => {
  gitStatus.mockResolvedValue(onBranch('main'))
  const { result, rerender } = renderHook(({ id }) => useProjectBranch(id, true, false), {
    initialProps: { id: 'c1' },
  })
  await waitFor(() => expect(result.current).toEqual({ status: 'branch', name: 'main' }))

  gitStatus.mockReturnValue(new Promise(() => {}))
  rerender({ id: 'c2' })
  expect(result.current).toEqual({ status: 'loading' })
  expect(gitStatus).toHaveBeenLastCalledWith({ conversationId: 'c2' })
})
