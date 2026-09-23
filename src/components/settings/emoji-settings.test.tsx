import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmojiSettings } from './emoji-settings'
import i18n from '@/i18n'
import { api } from '@/api'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'

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

const PACK: EmojiPackInfoResponse = {
  id: 'pack-1',
  name: 'Collected',
  description: null,
  cover_image: null,
  is_builtin: false,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
  kind: 'onebot',
  source_account_id: '1',
}

function makeEmoji(over: Partial<EmojiInfoResponse> & Pick<EmojiInfoResponse, 'id'>): EmojiInfoResponse {
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
    mockApi.confirmStickerSemantics.mockImplementation(({ id, name, tags }) =>
      Promise.resolve(makeEmoji({ id, name, tags, semantic_status: 'confirmed' })),
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

    const field = screen.getByRole('textbox', { name: 'Edit meaning' })
    expect(field.closest('[role=gridcell], [role=rowheader]')).not.toBeNull()
    expect(field).toHaveValue('old name')
    await user.clear(field)
    await user.type(field, 'new name{Enter}')

    await waitFor(() =>
      expect(mockApi.confirmStickerSemantics).toHaveBeenCalledWith({
        id: 'e1',
        name: 'new name',
        tags: 'cat,angry',
      }),
    )
  })

  it('keeps the name when only the tags are edited', async () => {
    const user = userEvent.setup()
    mockApi.listEmojis.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack(user)

    const field = screen.getByRole('textbox', { name: 'Edit tags' })
    expect(field).toHaveValue('cat')
    await user.clear(field)
    await user.type(field, 'cat,angry{Enter}')

    await waitFor(() =>
      expect(mockApi.confirmStickerSemantics).toHaveBeenCalledWith({
        id: 'e1',
        name: 'old name',
        tags: 'cat,angry',
      }),
    )
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

    expect(screen.getByRole('textbox', { name: 'Edit meaning' })).toHaveValue('shyly hiding')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(mockApi.confirmStickerSemantics).toHaveBeenCalledWith({
        id: 'e1',
        name: 'shyly hiding',
        tags: 'shy,hiding',
      }),
    )
  })

  it('Escape puts the saved value back and commits nothing', async () => {
    const user = userEvent.setup()
    mockApi.listEmojis.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack(user)

    const field = screen.getByRole('textbox', { name: 'Edit meaning' })
    await user.click(field)
    await user.clear(field)
    await user.type(field, 'discarded{Escape}')

    expect(field).toHaveValue('old name')
    expect(field).not.toHaveFocus()
    expect(mockApi.confirmStickerSemantics).not.toHaveBeenCalled()
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

    const names = screen.getAllByRole('textbox', { name: 'Edit meaning' })
    expect(names[0]).toHaveValue('waiting')
    expect(names[1]).toHaveValue('confirmed one')
  })
})
