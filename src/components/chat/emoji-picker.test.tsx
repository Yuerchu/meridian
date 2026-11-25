import { render, screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from 'react-aria-components'
import type { ReactElement } from 'react'

import i18n from '@/i18n'
import { resetStickerUrls } from '@/lib/sticker-urls'
import { EmojiPicker } from './emoji-picker'

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
    emojis: {
      listPacks: mocks.listPacks,
      list: mocks.listEmojis,
      getFileUrl: mocks.fileUrl,
    },
  },
}))

/** The library's strings follow React Aria's locale, not i18next's. */
function renderPicker(ui: ReactElement): RenderResult {
  const view = render(<I18nProvider locale="en-US">{ui}</I18nProvider>)
  return {
    ...view,
    rerender: (next) => view.rerender(<I18nProvider locale="en-US">{next}</I18nProvider>),
  }
}

describe('EmojiPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStickerUrls()
    return i18n.changeLanguage('en')
  })

  it('opens the library panel and sends a sticker only after that pack is opened', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPicker(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalledWith({ filter: { kind: 'pack', pack_id: 'pack-1' } }))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    // The panel opens on the Unicode tab. No sticker file is asked for until
    // its pack is the one on screen.
    expect(await screen.findByRole('searchbox', { name: 'Search emojis' })).toBeInTheDocument()
    expect(mocks.fileUrl).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Wave' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Pack One' }))
    await user.click(await screen.findByRole('button', { name: 'Wave' }))

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ emoji: expect.objectContaining({ id: 'emoji-1' }), url: 'asset://wave.png' }),
      ),
    )
    expect(mocks.fileUrl).toHaveBeenCalledWith({ emoji_id: 'emoji-1' })
    expect(mocks.listPacks).toHaveBeenCalledWith({ assistant_id: 'assistant-1' })
  })

  it('inserts a Unicode emoji without sending a sticker', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onSelectEmoji = vi.fn()
    renderPicker(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} onSelectEmoji={onSelectEmoji} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Emoji' }))
    const grin = await screen.findByRole('gridcell', { name: 'Grinning face' })
    await user.click(grin)

    expect(onSelectEmoji).toHaveBeenCalledWith(expect.any(String))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not offer a picker without an assistant', () => {
    const { container } = renderPicker(<EmojiPicker assistantId={null} onSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  // A failed read used to land on "no packs assigned", which is a statement
  // about the assistant's settings and was false.
  it('says the packs could not be loaded, and why, rather than that there are none', async () => {
    mocks.listPacks.mockRejectedValueOnce('database is locked')
    const user = userEvent.setup()
    renderPicker(<EmojiPicker assistantId="assistant-broken" onSelect={vi.fn()} />)

    await waitFor(() => expect(mocks.listPacks).toHaveBeenCalledWith({ assistant_id: 'assistant-broken' }))
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
    renderPicker(<EmojiPicker assistantId="assistant-empty" onSelect={vi.fn()} />)

    await waitFor(() => expect(mocks.listPacks).toHaveBeenCalledWith({ assistant_id: 'assistant-empty' }))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    expect(await screen.findByText('No emoji packs assigned to this assistant')).toBeInTheDocument()
    // The Unicode tab is still a picker, not a dead panel.
    expect(screen.getByRole('searchbox', { name: 'Search emojis' })).toBeInTheDocument()
  })

  it('removes the previous assistant packs while the next assignment is loading', async () => {
    let resolveNext!: (packs: { id: string; name: string }[]) => void
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { rerender } = renderPicker(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} />)

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

    await waitFor(() => expect(mocks.listPacks).toHaveBeenCalledWith({ assistant_id: 'assistant-2' }))
    expect(screen.queryByRole('button', { name: 'Pack One' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Wave' })).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()

    resolveNext([])
    await waitFor(() => expect(screen.getByText('No emoji packs assigned to this assistant')).toBeInTheDocument())
  })

  it('opens on the Unicode tab, and a sticker pack is a tab beside it', async () => {
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
    renderPicker(<EmojiPicker assistantId="assistant-with-empty-first-pack" onSelect={vi.fn()} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    // The library's first tab is Unicode. An empty assigned pack stays listed,
    // and it is not described as the assistant having no packs at all.
    const unicode = screen
      .getAllByRole('button', { name: 'Emoji' })
      .find((button) => button.hasAttribute('aria-pressed'))
    expect(unicode).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Empty Pack' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Usable Pack' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Wave' })).toBeNull()
    expect(screen.queryByText('No emoji packs assigned to this assistant')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Usable Pack' }))
    expect(await screen.findByRole('button', { name: 'Wave' })).toBeInTheDocument()
  })

  it('shows why a sticker file could not be loaded, instead of sending nothing', async () => {
    mocks.fileUrl.mockRejectedValueOnce('file is missing')
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPicker(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Emoji' }))
    await user.click(await screen.findByRole('button', { name: 'Pack One' }))

    expect(await screen.findByText('file is missing')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('moves between stickers with the arrow keys and chooses with Enter', async () => {
    mocks.listEmojis.mockResolvedValueOnce([
      { id: 'emoji-1', name: 'Wave', tags: 'hello', semantic_status: 'confirmed', file_format: 'gif' },
      { id: 'emoji-2', name: 'Nod', tags: 'yes', semantic_status: 'confirmed', file_format: 'webp' },
    ])
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPicker(<EmojiPicker assistantId="assistant-grid" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Emoji' }))
    await user.click(await screen.findByRole('button', { name: 'Pack One' }))
    // ArrowDown from the pack's search moves into the grid; the grid then moves
    // a cell at a time. Focusing the cell by hand skips that and warns about act.
    await user.click(await screen.findByRole('textbox', { name: 'Search emojis' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Wave' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Nod' })).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ emoji: expect.objectContaining({ id: 'emoji-2' }) }),
      ),
    )
  })
})
