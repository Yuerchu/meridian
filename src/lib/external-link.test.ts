const shellOpen = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }))

import { openExternalUrl } from './external-link'

describe('openExternalUrl', () => {
  afterEach(() => {
    shellOpen.mockReset()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('uses a new browser tab only in the Vite browser preview', async () => {
    shellOpen.mockRejectedValue(new Error('plugin unavailable'))
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    await expect(openExternalUrl('https://example.com/docs')).resolves.toBe(true)

    expect(browserOpen).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
  })

  it('never falls back to WebView navigation when the Tauri opener rejects', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    shellOpen.mockRejectedValue(new Error('blocked'))
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    await expect(openExternalUrl('https://example.com/docs')).resolves.toBe(true)

    expect(browserOpen).not.toHaveBeenCalled()
  })
})
