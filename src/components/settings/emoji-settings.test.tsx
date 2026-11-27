import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmojiSettings, STICKERS_PER_PAGE } from './emoji-settings'
import { resetStickerUrls } from '@/lib/sticker-urls'
import { installIntersectionObserver, type IntersectionControl } from '@/test/intersection'
import i18n from '@/i18n'
import { api } from '@/api'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'

vi.mock('@/api', () => ({
  api: {
    emojis: {
      listPacks: vi.fn(),
      list: vi.fn(),
      getFileUrl: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deletePack: vi.fn(),
      createPack: vi.fn(),
      import: vi.fn(),
      suggestSemantics: vi.fn(),
      getEmbedderStatus: vi.fn(),
    },
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    providers: {
      list: vi.fn(),
      listModels: vi.fn(),
    },
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

async function openPack() {
  await waitFor(() => expect(screen.getByRole('region', { name: /Stickers in Collected/ })).toBeInTheDocument())
}

function shownCardNames(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="sticker-name"]')).map((node) => node.textContent ?? '')
}

describe('EmojiSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetStickerUrls()
    mockApi.emojis.listPacks.mockResolvedValue([PACK])
    mockApi.emojis.getFileUrl.mockResolvedValue('blob:sticker')
    mockApi.emojis.getEmbedderStatus.mockResolvedValue({
      state: 'disabled',
      vision: false,
      indexed: 0,
      total: 0,
      error: null,
    })
    mockApi.emojis.update.mockImplementation(async ({ id, action }) =>
      makeEmoji({
        id,
        name: action.name,
        tags: action.kind === 'confirm_semantics' ? action.tags : null,
        semantic_status: 'confirmed',
      }),
    )
    mockApi.preferences.get.mockImplementation(async ({ key }) => ({ key, value: null }) as never)
    mockApi.preferences.set.mockResolvedValue(undefined)
    mockApi.providers.list.mockResolvedValue([])
    mockApi.providers.listModels.mockResolvedValue([])
    mockApi.emojis.suggestSemantics.mockImplementation(async ({ id }) =>
      makeEmoji({ id, semantic_status: 'suggested' }),
    )
  })

  /**
   * `confirm_sticker_semantics` writes name *and* tags, so a partial edit in
   * the `FileDetails` inspector has to carry the half it is not changing.
   */
  it('keeps the tags when only the name is edited in the inspector', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat,angry', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack()

    await user.click(screen.getByRole('button', { name: 'Inspect and edit old name' }))
    await user.click(await screen.findByRole('button', { name: /Edit meaning/ }))
    const field = screen.getByRole('textbox', { name: 'Edit meaning' })
    expect(field).toHaveValue('old name')
    await user.clear(field)
    await user.type(field, 'new name{Enter}')

    await waitFor(() =>
      expect(mockApi.emojis.update).toHaveBeenCalledWith({
        id: 'e1',
        action: { kind: 'confirm_semantics', name: 'new name', tags: 'cat,angry' },
      }),
    )
  })

  it('keeps the name when tags are edited in the inspector', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack()

    await user.click(screen.getByRole('button', { name: 'Inspect and edit old name' }))
    const tagInput = await screen.findByRole('combobox')
    await user.type(tagInput, 'angry{Enter}')

    await waitFor(() =>
      expect(mockApi.emojis.update).toHaveBeenCalledWith({
        id: 'e1',
        action: { kind: 'confirm_semantics', name: 'old name', tags: 'cat,angry' },
      }),
    )
  })

  /**
   * A sticker awaiting review shows the model's guess rather than the file name
   * it was collected under, so accepting it is one press rather than retyping
   * it. Confirming without editing has to send that guess, not the row.
   */
  it('offers the suggestion, and confirms it directly from the card', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({
        id: 'e1',
        name: 'sticker_a1b2.gif',
        semantic_status: 'suggested',
        suggested_name: 'shyly hiding',
        suggested_tags: 'shy,hiding',
      }),
    ])
    render(<EmojiSettings />)
    await openPack()

    expect(shownCardNames()).toEqual(['shyly hiding'])
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(mockApi.emojis.update).toHaveBeenCalledWith({
        id: 'e1',
        action: { kind: 'confirm_semantics', name: 'shyly hiding', tags: 'shy,hiding' },
      }),
    )
  })

  it('Escape in the inspector puts the saved value back and commits nothing', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'old name', tags: 'cat', semantic_status: 'confirmed' }),
    ])
    render(<EmojiSettings />)
    await openPack()

    await user.click(screen.getByRole('button', { name: 'Inspect and edit old name' }))
    await user.click(await screen.findByRole('button', { name: /Edit meaning/ }))
    const field = screen.getByRole('textbox', { name: 'Edit meaning' })
    await user.clear(field)
    await user.type(field, 'discarded{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Edit meaning' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit meaning/ })).toHaveTextContent('old name')
    expect(mockApi.emojis.update).not.toHaveBeenCalled()
  })

  /** Unreviewed first, whatever the pack's own order says. */
  it('puts the stickers awaiting review at the top', async () => {
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'confirmed one', semantic_status: 'confirmed', sort_order: 0 }),
      makeEmoji({ id: 'e2', name: 'waiting', semantic_status: 'pending', sort_order: 1 }),
    ])
    render(<EmojiSettings />)
    await openPack()

    expect(shownCardNames()).toEqual(['waiting', 'confirmed one'])
  })

  it('filters stickers by review status and search query', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({ id: 'e1', name: 'happy cat', tags: 'cute,cat', semantic_status: 'confirmed' }),
      makeEmoji({ id: 'e2', name: 'waiting dog', tags: 'dog', semantic_status: 'pending' }),
    ])
    render(<EmojiSettings />)
    await openPack()

    await user.click(screen.getByRole('radio', { name: /Pending/ }))
    expect(shownCardNames()).toEqual(['waiting dog'])

    await user.click(screen.getByRole('radio', { name: /All/ }))
    await user.type(screen.getByRole('searchbox', { name: 'Search meaning or tags…' }), 'cute')
    expect(shownCardNames()).toEqual(['happy cat'])
  })

  describe('pages', () => {
    const COUNT = STICKERS_PER_PAGE * 2 + 5
    // Confirmed, in pack order, seen least by the first: sorting by "Least seen"
    // reverses the pack.
    const MANY = Array.from({ length: COUNT }, (_, i) =>
      makeEmoji({
        id: `e${i}`,
        name: `sticker ${i}`,
        semantic_status: 'confirmed',
        sort_order: i,
        seen_count: COUNT - i,
      }),
    )
    let io: IntersectionControl

    beforeEach(() => {
      // Every card is on screen as soon as it is drawn: what is fetched is
      // then decided by what is drawn, which is the page.
      io = installIntersectionObserver(() => true)
      mockApi.emojis.list.mockResolvedValue(MANY)
      Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        value: () => new Promise(() => {}),
      })
    })

    afterEach(() => io.restore())

    const requested = () => new Set(mockApi.emojis.getFileUrl.mock.calls.map(([req]) => req.emoji_id))

    it('draws one page and asks only for the files on it', async () => {
      const user = userEvent.setup()
      render(<EmojiSettings />)
      await openPack()

      expect(shownCardNames()).toEqual(Array.from({ length: STICKERS_PER_PAGE }, (_, i) => `sticker ${i}`))
      const firstPage = new Set(Array.from({ length: STICKERS_PER_PAGE }, (_, i) => `e${i}`))
      await waitFor(() => expect(requested()).toEqual(firstPage))
      // Nothing about the settings page asks for every file up front any more.
      expect(mockApi.emojis.getFileUrl).toHaveBeenCalledTimes(STICKERS_PER_PAGE)

      await user.click(screen.getByRole('button', { name: 'Page 2' }))
      expect(shownCardNames()[0]).toBe(`sticker ${STICKERS_PER_PAGE}`)
      const secondPage = Array.from({ length: STICKERS_PER_PAGE }, (_, i) => `e${STICKERS_PER_PAGE + i}`)
      await waitFor(() => expect(requested()).toEqual(new Set([...firstPage, ...secondPage])))
      expect(mockApi.emojis.getFileUrl).toHaveBeenCalledTimes(STICKERS_PER_PAGE * 2)
      expect(requested().has(`e${COUNT - 1}`)).toBe(false)
    })

    it('sorts the whole pack, not the page on screen', async () => {
      const user = userEvent.setup()
      render(<EmojiSettings />)
      await openPack()

      await user.click(screen.getByRole('button', { name: /Sort order/ }))
      await user.click(await screen.findByRole('option', { name: 'Least seen' }))
      // Least seen first: that is the last sticker of the pack, which was on
      // the last page — not the least seen of the twenty that were showing.
      expect(shownCardNames()[0]).toBe(`sticker ${COUNT - 1}`)
    })

    it('selects all of the page, not all of the pack', async () => {
      const user = userEvent.setup()
      render(<EmojiSettings />)
      await openPack()

      await user.click(screen.getByRole('checkbox', { name: /select all/i }))
      // Scoped to the visible count: SelectionBar also announces it into the
      // screen reader's live region, so the text exists twice on purpose.
      expect(
        await screen.findByText(`${STICKERS_PER_PAGE} selected`, { selector: '.ui-selection-bar__count' }),
      ).toBeInTheDocument()
    })
  })

  it('clears the selection from the bulk bar', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([makeEmoji({ id: 'e1', semantic_status: 'confirmed' })])
    render(<EmojiSettings />)
    await openPack()

    await user.click(screen.getByRole('checkbox', { name: /select all/i }))
    const count = { selector: '.ui-selection-bar__count' }
    expect(await screen.findByText('1 selected', count)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    await waitFor(() => expect(screen.queryByText('1 selected', count)).not.toBeInTheDocument())
  })

  it('generates suggestions for unconfirmed selected stickers that have a file', async () => {
    const user = userEvent.setup()
    mockApi.emojis.list.mockResolvedValue([
      makeEmoji({ id: 'pending', name: 'pending-a', semantic_status: 'pending', file_name: 'a.gif' }),
      makeEmoji({ id: 'named', name: '点赞', semantic_status: 'confirmed', file_name: 'b.gif' }),
      makeEmoji({ id: 'nofile', name: 'pending-c', semantic_status: 'pending', file_name: '' }),
    ])
    render(<EmojiSettings />)
    await openPack()

    await user.click(screen.getByRole('checkbox', { name: /select all/i }))
    await user.click(await screen.findByRole('button', { name: 'Generate suggestions' }))

    await waitFor(() => {
      expect(mockApi.emojis.suggestSemantics).toHaveBeenCalledTimes(1)
    })
    expect(mockApi.emojis.suggestSemantics).toHaveBeenCalledWith({ id: 'pending' })
  })
})
