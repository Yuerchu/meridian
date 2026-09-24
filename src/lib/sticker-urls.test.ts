import { api } from '@/api'
import { loadStickerUrl, MAX_CONCURRENT, peekStickerUrl, resetStickerUrls } from './sticker-urls'

vi.mock('@/api', () => ({ api: { getEmojiFileUrl: vi.fn() } }))

const fileUrl = vi.mocked(api.getEmojiFileUrl)

/** Each call parks until the test releases it by id. */
function parked() {
  const pending = new Map<string, (url: string) => void>()
  fileUrl.mockImplementation(
    (id: string) =>
      new Promise<string>((resolve) => {
        pending.set(id, resolve)
      }),
  )
  return {
    started: () => fileUrl.mock.calls.map(([id]) => id),
    release: async (id: string) => {
      pending.get(id)!(`data:${id}`)
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('sticker urls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStickerUrls()
  })

  it(`runs at most ${MAX_CONCURRENT} requests at once, newest first`, async () => {
    const calls = parked()
    const ids = Array.from({ length: MAX_CONCURRENT + 2 }, (_, i) => `e${i}`)
    const loads = ids.map((id) => loadStickerUrl(id))
    // The first ones start as they arrive; the queue behind them is served
    // last-in-first-out, because the newest asker is the one on screen.
    expect(calls.started()).toEqual(ids.slice(0, MAX_CONCURRENT))
    await calls.release('e0')
    expect(calls.started()).toEqual([...ids.slice(0, MAX_CONCURRENT), ids.at(-1)])
    for (const id of ids.slice(1)) await calls.release(id).catch(() => {})
    await expect(Promise.all(loads)).resolves.toEqual(ids.map((id) => `data:${id}`))
  })

  it('asks once for two askers, and answers the next from memory', async () => {
    fileUrl.mockResolvedValue('data:wave')
    const [a, b] = await Promise.all([loadStickerUrl('wave'), loadStickerUrl('wave')])
    expect([a, b]).toEqual(['data:wave', 'data:wave'])
    await loadStickerUrl('wave')
    expect(fileUrl).toHaveBeenCalledTimes(1)
    expect(peekStickerUrl('wave')).toBe('data:wave')
  })

  it('drops a queued request whose asker went away before it started', async () => {
    const calls = parked()
    for (let i = 0; i < MAX_CONCURRENT; i++) void loadStickerUrl(`busy${i}`)
    const gone = new AbortController()
    const abandoned = loadStickerUrl('scrolled-past', gone.signal)
    gone.abort()
    await expect(abandoned).rejects.toThrow('abandoned')
    for (let i = 0; i < MAX_CONCURRENT; i++) await calls.release(`busy${i}`)
    expect(calls.started()).not.toContain('scrolled-past')
  })

  it('does not remember a failure', async () => {
    fileUrl.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('data:wave')
    await expect(loadStickerUrl('wave')).rejects.toThrow('offline')
    await expect(loadStickerUrl('wave')).resolves.toBe('data:wave')
  })
})
