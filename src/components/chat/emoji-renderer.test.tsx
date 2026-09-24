import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { resetStickerUrls } from '@/lib/sticker-urls'
import { installIntersectionObserver, type IntersectionControl } from '@/test/intersection'
import { InlineSticker, StickerImage, useEmojiMap } from './emoji-renderer'
import { resetViewportPlayback } from './sticker-playback'

vi.mock('@/api', () => ({
  api: {
    listAssistantEmojiPacks: vi.fn(),
    listEmojis: vi.fn(),
    getEmojiFileUrl: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('useEmojiMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStickerUrls()
  })

  it('maps names to sticker metadata without asking for a single file URL', async () => {
    mockApi.listAssistantEmojiPacks.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never)
    mockApi.listEmojis
      .mockResolvedValueOnce([
        { id: 'e1', name: 'one', semantic_status: 'confirmed', file_format: 'png' },
        { id: 'e3', name: 'draft', semantic_status: 'pending', file_format: 'png' },
      ] as never)
      .mockResolvedValueOnce([
        { id: 'e2', name: 'two', semantic_status: 'confirmed', file_format: 'gif' },
        { id: 'e4', name: 'lottie', semantic_status: 'confirmed', file_format: 'lottie' },
      ] as never)
    mockApi.getEmojiFileUrl.mockImplementation(async (id) => `asset://${id}`)

    const { result } = renderHook(() => useEmojiMap('assistant-1'))

    await waitFor(() => expect(Object.keys(result.current)).toEqual(['one', 'two']))
    expect(result.current.one.id).toBe('e1')
    expect(result.current.two.id).toBe('e2')
    // The pictures are asked for by whichever sticker is about to be drawn.
    await act(async () => {})
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(0)
  })

  it('ignores a late load after the hook unmounts', async () => {
    let resolvePacks!: (value: never[]) => void
    mockApi.listAssistantEmojiPacks.mockReturnValue(
      new Promise((resolve) => {
        resolvePacks = resolve
      }),
    )
    const { unmount } = renderHook(() => useEmojiMap('assistant-1'))

    unmount()
    resolvePacks([])
    await Promise.resolve()

    expect(mockApi.listEmojis).not.toHaveBeenCalled()
  })
})

describe('StickerImage', () => {
  let io: IntersectionControl
  let getContext: { mockRestore: () => void }
  const realMatch = window.matchMedia

  function reduceMotion(on: boolean) {
    window.matchMedia = ((query: string) => ({
      ...realMatch(query),
      matches: on && query.includes('prefers-reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as typeof window.matchMedia
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    resetStickerUrls()
    resetViewportPlayback()
    // On screen from the moment it is observed, like a sticker at the live edge.
    io = installIntersectionObserver(() => true)
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () => Promise.resolve(),
    })
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    io.restore()
    getContext.mockRestore()
    window.matchMedia = realMatch
  })

  it('shows an actionable error and retries the failed URL lookup', async () => {
    mockApi.getEmojiFileUrl.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('asset://wave.png')
    render(<StickerImage stickerId="emoji-1" name="Wave" />)

    expect(await screen.findByRole('group', { name: 'Could not load Wave' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    const image = await screen.findByRole('img', { name: 'Wave' })
    await waitFor(() =>
      expect(image.querySelector('[data-slot="sticker-thumb"]')).toHaveAttribute('data-state', 'playing'),
    )
    expect(image.querySelector('img[data-slot="sticker-thumb-live"]')).toHaveAttribute('src', 'asset://wave.png')
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(2)
  })

  it('offers the same retry inline, and the retry really asks again', async () => {
    mockApi.getEmojiFileUrl.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('asset://wave.png')
    render(
      <p>
        before <InlineSticker stickerId="emoji-1" name="Wave" /> after
      </p>,
    )

    expect(await screen.findByRole('group', { name: 'Could not load Wave' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Try loading Wave again' }))

    const image = await screen.findByRole('img', { name: 'Wave' })
    await waitFor(() =>
      expect(image.querySelector('img[data-slot="sticker-thumb-live"]')).toHaveAttribute('src', 'asset://wave.png'),
    )
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(2)
  })

  it('asks for nothing until it comes near the viewport', async () => {
    io.restore()
    io = installIntersectionObserver()
    mockApi.getEmojiFileUrl.mockResolvedValue('asset://wave.png')
    const { container } = render(<StickerImage stickerId="emoji-1" name="Wave" />)
    await act(async () => {})
    expect(mockApi.getEmojiFileUrl).not.toHaveBeenCalled()

    io.intersect(container.querySelector('[data-slot="sticker-box"]')!, true)
    await screen.findByRole('img', { name: 'Wave' })
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledWith('emoji-1')
  })

  it('stops playing when it leaves the screen and while the reader scrolls', async () => {
    mockApi.getEmojiFileUrl.mockResolvedValue('asset://wave.png')
    const { container } = render(<StickerImage stickerId="emoji-1" name="Wave" />)
    const thumb = () => container.querySelector('[data-slot="sticker-thumb"]')
    await waitFor(() => expect(thumb()).toHaveAttribute('data-state', 'playing'))

    vi.useFakeTimers()
    try {
      act(() => {
        fireEvent.wheel(container)
        fireEvent.scroll(container)
      })
      expect(thumb()).toHaveAttribute('data-state', 'drawn')
      expect(container.querySelector('img')).toBeNull()
      act(() => vi.advanceTimersByTime(300))
      expect(thumb()).toHaveAttribute('data-state', 'playing')
    } finally {
      vi.useRealTimers()
    }

    // Scrolled off screen (still near, so the still frame stays).
    act(() => io.intersect(container.querySelector('[data-slot="sticker-box"]')!, false, (o) => !o.options.rootMargin))
    expect(thumb()).toHaveAttribute('data-state', 'drawn')
    expect(container.querySelector('img')).toBeNull()
  })

  it('does not play by itself under reduced motion, but plays while pointed at', async () => {
    reduceMotion(true)
    mockApi.getEmojiFileUrl.mockResolvedValue('asset://wave.png')
    const { container } = render(<StickerImage stickerId="emoji-1" name="Wave" />)
    const thumb = () => container.querySelector('[data-slot="sticker-thumb"]')
    await waitFor(() => expect(thumb()).toHaveAttribute('data-state', 'drawn'))
    expect(container.querySelector('img')).toBeNull()

    fireEvent.pointerEnter(container.querySelector('[data-slot="sticker-box"]')!, { pointerType: 'mouse' })
    await waitFor(() => expect(thumb()).toHaveAttribute('data-state', 'playing'))
    fireEvent.pointerLeave(container.querySelector('[data-slot="sticker-box"]')!, { pointerType: 'mouse' })
    await waitFor(() => expect(thumb()).toHaveAttribute('data-state', 'drawn'))
  })
})
