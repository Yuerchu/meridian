import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmojiSettings } from './emoji-settings'
import i18n from '@/i18n'
import { api } from '@/api'
import type { Emoji, EmojiPack } from '@/types'

vi.mock('@/api', () => ({
  api: {
    listEmojiPacks: vi.fn(),
    listEmojis: vi.fn(),
    getEmojiFileUrl: vi.fn(),
    confirmStickerSemantics: vi.fn(),
    suggestStickerSemantics: vi.fn(),
    deleteEmoji: vi.fn(),
    deleteEmojiPack: vi.fn(),
    createEmojiPack: vi.fn(),
    importEmojis: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

const PACK: EmojiPack = {
  id: 'pack-1',
  name: 'Collected',
  description: null,
  cover_image: null,
  is_builtin: 0,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
  kind: 'onebot',
  source_account_id: '1',
}

function makeEmoji(over: Partial<Emoji> & Pick<Emoji, 'id'>): Emoji {
  return {
    pack_id: 'pack-1',
    name: 'sticker.gif',
    tags: null,
    file_name: 'sticker.gif',
    file_format: 'gif',
    sort_order: 0,
    created_at: 0,
    source: 'onebot_image',
    source_key: null,
    native_payload: null,
    semantic_status: 'pending',
    suggested_name: null,
    suggested_tags: null,
    file_size: 1,
    seen_count: 0,
    last_seen_at: null,
    ...over,
  }
}

async function openPack(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: /Collected/ })).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /Collected/ }))
  await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument())
}

describe('EmojiSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listEmojiPacks.mockResolvedValue([PACK])
    mockApi.getEmojiFileUrl.mockResolvedValue('blob:sticker')
    mockApi.confirmStickerSemantics.mockImplementation((id, name, tags) =>
      Promise.resolve(makeEmoji({ id, name, tags: tags ?? null, semantic_status: 'confirmed' })),
    )
  })

  /**
   * `confirm_sticker_semantics` writes name *and* tags, so a partial edit has
   * to carry the half it is not changing. The grid only ever edits one cell at
   * a time, which is exactly the shape that loses the other one.
   */
  it('keeps the tags when only the name is edited', async () => {
    const user = userEvent.setup()
    mockApi.listEmojis.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat,angry', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack(user)

    await user.click(screen.getByRole('button', { name: 'Edit meaning: old name' }))
    const field = await screen.findByRole('textbox', { name: 'Edit meaning' })
    await user.clear(field)
    await user.type(field, 'new name{Enter}')

    await waitFor(() => expect(mockApi.confirmStickerSemantics).toHaveBeenCalledWith('e1', 'new name', 'cat,angry'))
  })

  it('keeps the name when only the tags are edited', async () => {
    const user = userEvent.setup()
    mockApi.listEmojis.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack(user)

    await user.click(screen.getByRole('button', { name: 'Edit tags: cat' }))
    const field = await screen.findByRole('textbox', { name: 'Edit tags' })
    await user.clear(field)
    await user.type(field, 'cat,angry{Enter}')

    await waitFor(() => expect(mockApi.confirmStickerSemantics).toHaveBeenCalledWith('e1', 'old name', 'cat,angry'))
  })

  /**
   * A sticker awaiting review shows the model's guess rather than the file name
   * it was collected under, so accepting it is one press rather than retyping
   * it. Confirming without editing has to send that guess, not the row.
   */
  it('offers the suggestion, and confirms it as typed', async () => {
    const user = userEvent.setup()
    mockApi.listEmojis.mockResolvedValue([
      makeEmoji({
        id: 'e1',
        name: 'sticker_a1b2.gif',
        semantic_status: 'suggested',
        suggested_name: 'shyly hiding',
        suggested_tags: 'shy,hiding',
      }),
    ])
    render(<EmojiSettings />)
    await openPack(user)

    expect(screen.getByRole('button', { name: 'Edit meaning: shyly hiding' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(mockApi.confirmStickerSemantics).toHaveBeenCalledWith('e1', 'shyly hiding', 'shy,hiding'),
    )
  })

  /** Unreviewed first, whatever the pack's own order says. */
  it('puts the stickers awaiting review at the top', async () => {
    const user = userEvent.setup()
    mockApi.listEmojis.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'confirmed one', semantic_status: 'confirmed', sort_order: 0 }),
      makeEmoji({ id: 'e2', name: 'waiting', semantic_status: 'pending', sort_order: 1 }),
    ])
    render(<EmojiSettings />)
    await openPack(user)

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('waiting')
    expect(rows[1]).toHaveTextContent('confirmed one')
  })
})
