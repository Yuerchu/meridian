import { act, fireEvent, render, waitFor } from '@testing-library/react'

vi.mock('@/api', () => ({
  api: {
    getPlatform: vi.fn(() => Promise.resolve('windows')),
    getEmojiFileUrl: vi.fn(),
    workspaceProbeRef: vi.fn(() => Promise.resolve({ kind: 'missing' })),
  },
}))

import { api } from '@/api'
import i18n from '@/i18n'
import { resetStickerUrls } from '@/lib/sticker-urls'
import { installIntersectionObserver, isNearObserver, type IntersectionControl } from '@/test/intersection'
import type { EmojiInfoResponse } from '@/types'
import type { EmojiMap } from './emoji-renderer'
import { MarkdownContent } from './markdown-content'
import { MAX_PLAYING, resetViewportPlayback } from './sticker-playback'

const mockApi = vi.mocked(api)

const emojiMap: EmojiMap = {
  wave: { id: 'e1', name: 'wave', semantic_status: 'confirmed', file_format: 'gif' } as EmojiInfoResponse,
}

describe('stickers in assistant markdown', () => {
  let io: IntersectionControl
  let getContext: { mockRestore: () => void }
  let decode: ReturnType<typeof vi.fn>
  const realMatch = window.matchMedia

  const stickers = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-slot="markdown-sticker"]'))
  const stateOf = (sticker: Element) => sticker.querySelector('[data-slot="sticker-thumb"]')?.getAttribute('data-state')

  beforeEach(async () => {
    vi.clearAllMocks()
    resetStickerUrls()
    resetViewportPlayback()
    mockApi.getEmojiFileUrl.mockResolvedValue('asset://wave.gif')
    io = installIntersectionObserver(() => true)
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    decode = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    io.restore()
    getContext.mockRestore()
    window.matchMedia = realMatch
  })

  it('asks for nothing until the sticker comes near the viewport', async () => {
    io.restore()
    io = installIntersectionObserver()
    const { container } = render(<MarkdownContent content="Hello [emoji:wave]" emojiMap={emojiMap} />)
    await act(async () => {})
    const [sticker] = stickers(container)
    expect(sticker).toHaveAccessibleName('wave')
    expect(mockApi.getEmojiFileUrl).not.toHaveBeenCalled()
    expect(sticker.querySelector('img, canvas')).toBeNull()

    act(() => io.intersect(sticker, true, isNearObserver))
    await waitFor(() => expect(stateOf(sticker)).toBe('drawn'))
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledExactlyOnceWith('e1')
  })

  it('freezes while the reader scrolls and resumes once it settles', async () => {
    const { container } = render(<MarkdownContent content="Hello [emoji:wave]" emojiMap={emojiMap} />)
    const [sticker] = stickers(container)
    await waitFor(() => expect(stateOf(sticker)).toBe('playing'))

    vi.useFakeTimers()
    try {
      act(() => {
        fireEvent.wheel(container)
        fireEvent.scroll(container)
      })
      expect(stateOf(sticker)).toBe('drawn')
      expect(sticker.querySelector('img')).toBeNull()
      act(() => vi.advanceTimersByTime(300))
      expect(stateOf(sticker)).toBe('playing')
    } finally {
      vi.useRealTimers()
    }
  })

  it(`plays at most ${MAX_PLAYING} by themselves; the rest stay still`, async () => {
    const content = Array.from({ length: MAX_PLAYING + 1 }, () => '[emoji:wave]').join('\n')
    const { container } = render(<MarkdownContent content={content} emojiMap={emojiMap} />)
    await waitFor(() => expect(stickers(container).every((sticker) => stateOf(sticker) !== undefined)).toBe(true))
    await waitFor(() =>
      expect(stickers(container).map(stateOf)).toEqual([...Array<string>(MAX_PLAYING).fill('playing'), 'drawn']),
    )
    // One sticker, one request, however many times it is named.
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(1)
  })

  it('does not play by itself under reduced motion, but plays while pointed at', async () => {
    window.matchMedia = ((query: string) => ({
      ...realMatch(query),
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as typeof window.matchMedia
    const { container } = render(<MarkdownContent content="Hello [emoji:wave]" emojiMap={emojiMap} />)
    const [sticker] = stickers(container)
    await waitFor(() => expect(stateOf(sticker)).toBe('drawn'))

    fireEvent.pointerEnter(sticker, { pointerType: 'mouse' })
    await waitFor(() => expect(stateOf(sticker)).toBe('playing'))
  })

  it('keeps one sticker through a stream and its ending: no second request, no second still frame', async () => {
    const view = (content: string, isStreaming: boolean) => (
      <MarkdownContent
        content={content}
        isStreaming={isStreaming}
        emojiMap={emojiMap}
        blockId="m1"
        trailer={<span data-slot="test-time">12:00</span>}
      />
    )
    const { container, rerender } = render(view('Hello [emoji:wave]', true))
    const sticker = stickers(container)[0]
    await waitFor(() => expect(stateOf(sticker)).toBe('playing'))

    let content = 'Hello [emoji:wave]'
    for (const chunk of [' how', ' are', ' you', ' today?']) {
      content += chunk
      rerender(view(content, true))
      await act(async () => {})
    }
    // The stream ends: the time is floated into this same paragraph.
    rerender(view(content, false))
    await act(async () => {})

    expect(container.querySelector('[data-slot="test-time"]')).toBeInTheDocument()
    expect(stickers(container)).toHaveLength(1)
    expect(stickers(container)[0]).toBe(sticker)
    expect(stateOf(sticker)).toBe('playing')
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('keeps the sticker when the stream moves on to a new paragraph', async () => {
    const view = (content: string) => <MarkdownContent content={content} isStreaming emojiMap={emojiMap} blockId="m2" />
    const { container, rerender } = render(view('Hello [emoji:wave]'))
    const sticker = stickers(container)[0]
    await waitFor(() => expect(stateOf(sticker)).toBe('playing'))

    for (const content of [
      'Hello [emoji:wave]\n',
      'Hello [emoji:wave]\n\n',
      'Hello [emoji:wave]\n\nNext',
      'Hello [emoji:wave]\n\nNext one',
    ]) {
      rerender(view(content))
      await act(async () => {})
    }

    expect(stickers(container)).toHaveLength(1)
    expect(stickers(container)[0]).toBe(sticker)
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('draws an image that only looks like a sticker as an ordinary image', async () => {
    const { container } = render(
      <MarkdownContent content="![sticker:wave](https://example.com/x.gif)" emojiMap={emojiMap} />,
    )
    await act(async () => {})
    expect(stickers(container)).toHaveLength(0)
    expect(container.querySelector('[data-slot="markdown-image"]')).toHaveAttribute('src', 'https://example.com/x.gif')
  })
})
