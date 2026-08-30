import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
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
    listAssistantEmojiPacks: mocks.listPacks,
    listEmojis: mocks.listEmojis,
    getEmojiFileUrl: mocks.fileUrl,
  },
}))

describe('EmojiPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    return i18n.changeLanguage('en')
  })

  it('uses the Pro picker surface while preserving assigned sticker packs', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<EmojiPicker assistantId="assistant-1" onSelect={onSelect} />)

    await waitFor(() => expect(mocks.fileUrl).toHaveBeenCalledWith('emoji-1'))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    expect(await screen.findByRole('searchbox', { name: 'Search emoji...' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Pack One' })).toBeInTheDocument()
    expect(mocks.listPacks).toHaveBeenCalledWith('assistant-1')

    const nativeSelect = screen.getByTestId('hidden-select-container').querySelector('select')!
    fireEvent.change(nativeSelect, { target: { value: 'emoji-1' } })
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: expect.objectContaining({ id: 'emoji-1' }), url: 'asset://wave.png' }),
    )
  })

  it('does not offer a picker without an assistant', () => {
    const { container } = render(<EmojiPicker assistantId={null} onSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
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

    await waitFor(() => expect(mocks.fileUrl).toHaveBeenCalledWith('emoji-1'))
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
    const nativeSelect = screen.getByTestId('hidden-select-container').querySelector('select')!
    fireEvent.change(nativeSelect, { target: { value: 'emoji-1' } })
    expect(onSelect).not.toHaveBeenCalled()

    resolveNext([])
    await waitFor(() => expect(screen.getByText('No emoji packs assigned to this assistant')).toBeInTheDocument())
  })

  it('opens on the first pack that actually has a usable sticker', async () => {
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

    await waitFor(() => expect(mocks.fileUrl).toHaveBeenCalledWith('emoji-1'))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))

    expect(await screen.findByRole('button', { name: 'Usable Pack' })).toHaveClass('bg-default')
    const nativeSelect = screen.getByTestId('hidden-select-container').querySelector('select')!
    expect(nativeSelect.querySelector('option[value="emoji-1"]')).toHaveTextContent('Wave')
    expect(screen.queryByText('No emoji packs assigned to this assistant')).not.toBeInTheDocument()
  })
})
