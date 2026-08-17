import { renderHook, waitFor } from '@testing-library/react'

import { api } from '@/api'
import { useEmojiMap } from './emoji-renderer'

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
      .mockResolvedValueOnce([{ id: 'e1', name: 'one' }] as never)
      .mockResolvedValueOnce([{ id: 'e2', name: 'two' }] as never)
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
