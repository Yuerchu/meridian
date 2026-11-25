import { render, waitFor } from '@testing-library/react'

import { api } from '@/api'
import { useAndroidInsets } from './use-android-insets'

const listenMock = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('@/api', () => ({
  api: {
    platform: {
      getInfo: vi.fn(),
      getWindowInsets: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

function Harness() {
  useAndroidInsets()
  return null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useAndroidInsets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.platform.getWindowInsets.mockResolvedValue({ top: 1, bottom: 2, left: 3, right: 4, ime_bottom: 5 })
    listenMock.mockResolvedValue(vi.fn())
  })

  it('does not install Android listeners when platform detection finishes after unmount', async () => {
    const platform = deferred<string>()
    mockApi.platform.getInfo.mockReturnValue(platform.promise)
    const { unmount } = render(<Harness />)

    unmount()
    platform.resolve('android')
    await platform.promise

    expect(listenMock).not.toHaveBeenCalled()
  })

  it('owns both native and scroll subscriptions for the mounted Android lifecycle', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValue(unlisten)
    mockApi.platform.getInfo.mockResolvedValue('android')
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<Harness />)
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith('insets-changed', expect.any(Function)))
    await waitFor(() => expect(mockApi.platform.getWindowInsets).toHaveBeenCalledTimes(1))
    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })

    unmount()

    expect(unlisten).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
