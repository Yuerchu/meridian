import { act, renderHook, waitFor } from '@testing-library/react'

import type { LaunchRequestInfoResponse } from '@/types'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, () => void>()
  return {
    listeners,
    unlisten: vi.fn(),
    take: vi.fn<() => Promise<LaunchRequestInfoResponse | null>>(),
  }
})

vi.mock('@/lib/transport', () => ({
  listen: vi.fn((name: string, handler: () => void) => {
    mocks.listeners.set(name, handler)
    return Promise.resolve(mocks.unlisten)
  }),
}))

vi.mock('@/api', () => ({ api: { takeLaunchRequest: mocks.take } }))

import { useLaunchRequest } from './use-launch-request'

describe('useLaunchRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
  })

  it('opens a page the app was launched with before the window listened', async () => {
    mocks.take.mockResolvedValueOnce({ settings_tab: 'ime' })
    const open = vi.fn()
    renderHook(() => useLaunchRequest(open))
    await waitFor(() => expect(open).toHaveBeenCalledWith('ime'))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('takes a later request when the event says one is waiting', async () => {
    mocks.take.mockResolvedValueOnce(null)
    const open = vi.fn()
    renderHook(() => useLaunchRequest(open))
    await waitFor(() => expect(mocks.listeners.get('launch-request')).toBeDefined())
    await waitFor(() => expect(mocks.take).toHaveBeenCalledTimes(1))
    expect(open).not.toHaveBeenCalled()

    mocks.take.mockResolvedValueOnce({ settings_tab: 'ime' })
    act(() => mocks.listeners.get('launch-request')?.())
    await waitFor(() => expect(open).toHaveBeenCalledWith('ime'))
    expect(mocks.take).toHaveBeenCalledTimes(2)
  })

  it('stops listening when the shell goes away', async () => {
    mocks.take.mockResolvedValue(null)
    const { unmount } = renderHook(() => useLaunchRequest(vi.fn()))
    await waitFor(() => expect(mocks.listeners.get('launch-request')).toBeDefined())
    await Promise.resolve()
    unmount()
    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
  })
})
