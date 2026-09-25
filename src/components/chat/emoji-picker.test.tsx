import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { resetStickerUrls } from '@/lib/sticker-urls'
import { installIntersectionObserver, type IntersectionControl } from '@/test/intersection'
import { EmojiPicker } from './emoji-picker'
import { STICKER_PAGE } from './sticker-grid'

const mocks = vi.hoisted(() => ({
  listPacks: vi.fn((_assistantId?: string) => Promise.resolve([{ id: 'pack-1', name: 'Pack One' }])),
  listEmojis: vi.fn((_packId?: string) =>
    Promise.resolve([
      {
        id: 'emoji-1',
        name: 'Wave',
        tags: 'hello greeting',
        semantic_status: 'confirmed',
        file_format: 'png',
      },
    ]),
  ),
  fileUrl: vi.fn((_emojiId?: string) => Promise.resolve('asset://wave.png')),
}))

vi.mock('@/api', () => ({
  api: {
    listAssistantEmojiPacks: mocks.listPacks,
    listEmojis: mocks.listEmojis,
    getEmojiFileUrl: mocks.fileUrl,
  },
}))

describe('EmojiPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStickerUrls()
    return i18n.changeLanguage('en')
  })

  it('uses the EmojiPicker surface while preserving assigned sticker packs', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalledWith('pack-1'))
    // Only what the stickers are is fetched with the picker; no file yet.
    expect(mocks.fileUrl).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    expect(await screen.findByRole('searchbox', { name: 'Search emoji...' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Pack One' })).toBeInTheDocument()
    expect(mocks.listPacks).toHaveBeenCalledWith('assistant-1')

    // The picker is a grid listbox of stickers, each option named by its
    // `textValue` (emoji name, tags, pack), so the sticker is chosen by pressing it.
    await user.click(await screen.findByRole('option', { name: /^Wave\b/ }))
    // The cell was never near a viewport here (jsdom's observer never fires),
    // so choosing it asks for the file then.
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ emoji: expect.objectContaining({ id: 'emoji-1' }), url: 'asset://wave.png' }),
      ),
    )
  })

  it('does not offer a picker without an assistant', () => {
    const { container } = render(<EmojiPicker assistantId={null} onSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  // A failed read used to land on "no packs assigned", which is a statement
  // about the assistant's settings and was false.
  it('says the packs could not be loaded, and why, rather than that there are none', async () => {
    mocks.listPacks.mockRejectedValueOnce('database is locked')
    const user = userEvent.setup()
    render(<EmojiPicker assistantId="assistant-broken" onSelect={vi.fn()} />)

    await waitFor(() => expect(mocks.listPacks).toHaveBeenCalledWith('assistant-broken'))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('database is locked')
    expect(screen.queryByText('No emoji packs assigned to this assistant')).toBeNull()

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByRole('button', { name: 'Pack One' })).toBeInTheDocument()
  })

  it('can explain an assistant with no assigned packs', async () => {
    mocks.listPacks.mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<EmojiPicker assistantId="assistant-empty" onSelect={vi.fn()} />)

    await waitFor(() => expect(mocks.listPacks).toHaveBeenCalledWith('assistant-empty'))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    expect(await screen.findByText('No emoji packs assigned to this assistant')).toBeInTheDocument()
  })

  it('removes the previous assistant packs while the next assignment is loading', async () => {
    let resolveNext!: (packs: { id: string; name: string }[]) => void
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Emoji' }))
    expect(await screen.findByRole('button', { name: 'Pack One' })).toBeInTheDocument()

    mocks.listPacks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve
        }),
    )
    rerender(<EmojiPicker assistantId="assistant-2" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.listPacks).toHaveBeenCalledWith('assistant-2'))
    expect(screen.queryByRole('button', { name: 'Pack One' })).not.toBeInTheDocument()
    // Nothing is selectable while the next assignment loads: the previous
    // assistant's stickers are gone from the grid, so there is no button to
    // press rather than a press that has to be ignored.
    expect(screen.queryByRole('option', { name: /^Wave\b/ })).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()

    resolveNext([])
    await waitFor(() => expect(screen.getByText('No emoji packs assigned to this assistant')).toBeInTheDocument())
  })

  it('opens on the first pack that actually has a sticker', async () => {
    mocks.listPacks.mockResolvedValueOnce([
      { id: 'pack-empty', name: 'Empty Pack' },
      { id: 'pack-usable', name: 'Usable Pack' },
    ])
    mocks.listEmojis.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'emoji-1',
        name: 'Wave',
        tags: 'hello greeting',
        semantic_status: 'confirmed',
        file_format: 'png',
      },
    ])
    const user = userEvent.setup()
    render(<EmojiPicker assistantId="assistant-with-empty-first-pack" onSelect={vi.fn()} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    expect(await screen.findByRole('button', { name: 'Usable Pack' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('option', { name: /^Wave\b/ })).toBeInTheDocument()
    expect(screen.queryByText('No emoji packs assigned to this assistant')).not.toBeInTheDocument()
  })

  describe('sticker grid', () => {
    const TWO = [
      { id: 'emoji-1', name: 'Wave', tags: 'hello', semantic_status: 'confirmed', file_format: 'gif' },
      { id: 'emoji-2', name: 'Nod', tags: 'yes', semantic_status: 'confirmed', file_format: 'webp' },
    ]
    let io: IntersectionControl
    let drawImage: ReturnType<typeof vi.fn>
    let getContext: { mockRestore: () => void }

    beforeEach(() => {
      // Every cell the grid watches is reported on screen at once, which is
      // what a popover this size looks like with its first rows showing.
      io = installIntersectionObserver(() => true)
      drawImage = vi.fn()
      getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage,
      } as unknown as CanvasRenderingContext2D)
      Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        value: () => Promise.resolve(),
      })
      mocks.listEmojis.mockResolvedValueOnce(TWO)
      mocks.fileUrl.mockImplementation((id?: string) => Promise.resolve(`data:image/gif;base64,${id}`))
    })

    afterEach(() => {
      io.restore()
      getContext.mockRestore()
      mocks.fileUrl.mockImplementation(() => Promise.resolve('asset://wave.png'))
    })

    async function openPicker(onSelect = vi.fn()) {
      const user = userEvent.setup()
      render(<EmojiPicker assistantId="assistant-grid" onSelect={onSelect} />)
      await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalled())
      await user.click(screen.getByRole('button', { name: 'Emoji' }))
      const grid = await screen.findByRole('listbox', { name: 'Emoji' })
      return { user, grid, onSelect }
    }

    it('lays stickers out three to a row, four once the popover is wide enough', async () => {
      const { grid } = await openPicker()
      // jsdom does no layout, so what is asserted is the rule rather than a
      // measurement: the columns follow the popover's own width (a container
      // query on it), never the window's. The two widths are checked in the
      // browser on #playground.
      expect(grid).toHaveClass('grid-cols-3', '@min-[21rem]/stickers:grid-cols-4')
      expect(grid).not.toHaveClass('grid-cols-8')
      expect(grid.closest('[data-slot="emoji-picker-content"]')).toHaveClass('@container/stickers')
    })

    it('draws a still first frame and plays the sticker only while hovered', async () => {
      const { user } = await openPicker()
      const wave = await screen.findByRole('option', { name: 'Wave' })
      await waitFor(() =>
        expect(wave.querySelector('[data-slot="sticker-thumb"]')).toHaveAttribute('data-state', 'drawn'),
      )
      expect(drawImage).toHaveBeenCalled()
      expect(wave.querySelector('canvas')).not.toBeNull()
      expect(wave.querySelector('img')).toBeNull()

      await user.hover(wave)
      const live = wave.querySelector('img[data-slot="sticker-thumb-live"]')
      expect(live).toHaveAttribute('src', 'data:image/gif;base64,emoji-1')
      expect(live).toHaveAttribute('loading', 'lazy')
      expect(live).toHaveAttribute('decoding', 'async')

      await user.unhover(wave)
      expect(wave.querySelector('img')).toBeNull()
    })

    it('plays a pointed-at sticker even under reduced motion — only autoplay is off', async () => {
      const realMatch = window.matchMedia
      window.matchMedia = ((query: string) => ({
        ...realMatch(query),
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as typeof window.matchMedia
      try {
        const { user } = await openPicker()
        const wave = await screen.findByRole('option', { name: 'Wave' })
        await waitFor(() =>
          expect(wave.querySelector('[data-slot="sticker-thumb"]')).toHaveAttribute('data-state', 'drawn'),
        )
        // Nothing in the picker plays by itself either way.
        expect(wave.querySelector('img')).toBeNull()
        await user.hover(wave)
        expect(wave.querySelector('img[data-slot="sticker-thumb-live"]')).not.toBeNull()
      } finally {
        window.matchMedia = realMatch
      }
    })

    it('moves with the arrow keys and chooses with Enter', async () => {
      const { user, onSelect } = await openPicker()
      await screen.findByRole('option', { name: 'Nod' })
      // From the search field into the grid, then one cell along.
      await user.tab()
      expect(screen.getByRole('option', { name: 'Wave' })).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('option', { name: 'Nod' })).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ emoji: expect.objectContaining({ id: 'emoji-2' }) }),
      )
    })

    it('lets go of every still frame when the picker closes', async () => {
      const { user } = await openPicker()
      const wave = await screen.findByRole('option', { name: 'Wave' })
      await waitFor(() =>
        expect(wave.querySelector('[data-slot="sticker-thumb"]')).toHaveAttribute('data-state', 'drawn'),
      )
      const canvas = wave.querySelector('canvas')!
      expect(io.observers.length).toBeGreaterThan(0)
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
    })
  })

  describe('paging', () => {
    const MANY = Array.from({ length: STICKER_PAGE * 2 + 5 }, (_, i) => ({
      id: `many-${i}`,
      name: `Sticker ${i}`,
      tags: null,
      semantic_status: 'confirmed',
      file_format: 'gif',
    }))
    let io: IntersectionControl

    beforeEach(() => {
      // Nothing is on screen until the test says so.
      io = installIntersectionObserver()
      mocks.listEmojis.mockResolvedValueOnce(MANY as never)
      mocks.fileUrl.mockImplementation((id?: string) => Promise.resolve(`data:image/gif;base64,${id}`))
      Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        value: () => new Promise(() => {}),
      })
    })

    afterEach(() => {
      io.restore()
      mocks.fileUrl.mockImplementation(() => Promise.resolve('asset://wave.png'))
    })

    it('draws one page of cells and asks only for the files of the ones near the viewport', async () => {
      const user = userEvent.setup()
      render(<EmojiPicker assistantId="assistant-many" onSelect={vi.fn()} />)
      await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalled())
      await user.click(screen.getByRole('button', { name: 'Emoji' }))
      await screen.findByRole('option', { name: 'Sticker 0' })

      expect(screen.getAllByRole('option')).toHaveLength(STICKER_PAGE)
      expect(mocks.fileUrl).not.toHaveBeenCalled()

      // The first two rows come near.
      const cells = [...document.querySelectorAll('[data-slot="sticker-cell-body"]')]
      for (const cell of cells.slice(0, 8)) io.intersect(cell, true)
      await waitFor(() => expect(mocks.fileUrl).toHaveBeenCalledTimes(8))
      expect(mocks.fileUrl.mock.calls.map(([id]) => id).sort()).toEqual(
        Array.from({ length: 8 }, (_, i) => `many-${i}`).sort(),
      )

      // The end of the page comes near: the next page is drawn, and nothing
      // on it is fetched until it is near too.
      const more = document.querySelector('[data-slot="sticker-grid-more"]')!
      io.intersect(more, true)
      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(STICKER_PAGE * 2))
      expect(mocks.fileUrl).toHaveBeenCalledTimes(8)
    })
  })
})
