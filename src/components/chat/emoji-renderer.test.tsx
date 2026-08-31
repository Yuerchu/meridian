import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { StickerImage, useEmojiMap } from './emoji-renderer'

vi.mock('@/api', () => ({
  api: {
    listAssistantEmojiPacks: vi.fn(),
    listEmojis: vi.fn(),
    getEmojiFileUrl: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('useEmojiMap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads packs and file URLs in parallel while preserving emoji names', async () => {
    mockApi.listAssistantEmojiPacks.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never)
    mockApi.listEmojis
      .mockResolvedValueOnce([{ id: 'e1', name: 'one', semantic_status: 'confirmed', file_format: 'png' }] as never)
      .mockResolvedValueOnce([{ id: 'e2', name: 'two', semantic_status: 'confirmed', file_format: 'png' }] as never)
    mockApi.getEmojiFileUrl.mockImplementation(async (id) => `asset://${id}`)

    const { result } = renderHook(() => useEmojiMap('assistant-1'))

    await waitFor(() => expect(Object.keys(result.current)).toEqual(['one', 'two']))
    expect(result.current.one.url).toBe('asset://e1')
    expect(result.current.two.url).toBe('asset://e2')
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
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
  })

  it('shows an actionable error and retries the failed URL lookup', async () => {
    mockApi.getEmojiFileUrl.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('asset://wave.png')
    render(<StickerImage stickerId="emoji-1" name="Wave" />)

    expect(await screen.findByRole('group', { name: 'Could not load Wave' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    const image = await screen.findByRole('img', { name: 'Wave' })
    expect(image).toHaveAttribute('src', 'asset://wave.png')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('width', '128')
    expect(image).toHaveAttribute('height', '128')
    expect(mockApi.getEmojiFileUrl).toHaveBeenCalledTimes(2)
  })
})
