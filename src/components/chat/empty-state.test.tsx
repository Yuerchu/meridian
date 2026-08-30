import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { EmptyState, StarterPrompts } from './empty-state'

const mocks = vi.hoisted(() => ({
  listPacks: vi.fn(() => Promise.resolve([{ id: 'pack-1', name: 'Pack One' }])),
  listEmojis: vi.fn(() =>
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
  fileUrl: vi.fn(() => Promise.resolve('asset://wave.png')),
  voiceOnSend: null as ((text: string) => void) | null,
  settings: {
    assistants: [
      {
        id: 'assistant-1',
        name: 'Default Assistant',
        provider_id: 'provider-1',
        model_id: 'model-1',
        is_default: 1,
      },
    ],
    providers: [],
    selectedAssistant: undefined,
    selectedAssistantId: 'assistant-1',
    selectedModelId: 'model-1',
    selectedProviderId: 'provider-1',
    thinkingLevel: 'high',
    fastMode: true,
    mode: 'plan',
    acceptEdits: false,
    capabilities: {
      supports_tools: true,
      supports_streaming_tools: true,
      supports_thinking: true,
      supports_images: true,
      max_context_tokens: 128_000,
      max_output_tokens: 16_000,
      supports_fast: true,
    },
    onSelectAssistant: vi.fn(),
    onSelectModel: vi.fn(),
    onSelectThinkingLevel: vi.fn(),
    onToggleFast: vi.fn(),
    onSelectMode: vi.fn(),
    onToggleAcceptEdits: vi.fn(),
  },
}))

vi.mock('@/api', () => ({
  api: {
    listAssistantEmojiPacks: mocks.listPacks,
    listEmojis: mocks.listEmojis,
    getEmojiFileUrl: mocks.fileUrl,
  },
}))

vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('@/hooks/use-turn-settings', () => ({ useTurnSettings: () => mocks.settings }))
vi.mock('@/hooks/use-voice-recorder', () => ({
  useVoiceRecorder: ({ onSend }: { onSend: (text: string) => void }) => {
    mocks.voiceOnSend = onSend
    return {
      state: 'idle' as const,
      elapsed: 0,
      handlePointerDown: vi.fn(),
      handlePointerUp: vi.fn(),
      handlePointerCancel: vi.fn(),
      handlePointerEnter: vi.fn(),
      handlePointerLeave: vi.fn(),
      handleKeyboardPress: vi.fn(),
    }
  },
}))

describe('StarterPrompts', () => {
  beforeEach(() => i18n.changeLanguage('en'))

  it('reports the selected suggestion', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<StarterPrompts onSelect={onSelect} />)

    const suggestion = screen.getByRole('button', { name: 'Review some code and find problems' })
    await user.click(suggestion)

    expect(onSelect).toHaveBeenCalledWith('Review some code and find problems')
  })

  it('disables every suggestion when the composer is locked', () => {
    render(<StarterPrompts disabled onSelect={vi.fn()} />)

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})

describe('EmptyState welcome composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    return i18n.changeLanguage('en')
  })

  it('renders the same options, attachments, emoji and voice controls as a conversation composer', async () => {
    const user = userEvent.setup()
    render(<EmptyState onSubmit={vi.fn(() => Promise.resolve())} />)

    expect(screen.getByRole('textbox', { name: 'Send a message...' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Options and attachments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emoji' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hold to talk, release to send; click to toggle instead' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Options and attachments' }))
    expect(await screen.findByRole('button', { name: 'Attach File' })).toBeInTheDocument()
  })

  it('fills the real composer from a suggestion without creating a conversation', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(<EmptyState onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'Review some code and find problems' }))

    expect(screen.getByRole('textbox', { name: 'Send a message...' })).toHaveValue('Review some code and find problems')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the welcome draft with the selected turn settings', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(<EmptyState onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: 'Send a message...' }), '  First question  ')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        text: 'First question',
        attachedFiles: [],
        pendingSticker: null,
        voice: false,
        remainingComposer: null,
        settings: {
          selectedAssistantId: 'assistant-1',
          selectedModelId: 'model-1',
          selectedProviderId: 'provider-1',
          thinkingLevel: 'high',
          fastMode: true,
          mode: 'plan',
          acceptEdits: false,
        },
      }),
    )
  })

  it('keeps the draft and unlocks the composer when conversation creation fails', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('create failed')))
    const user = userEvent.setup()
    render(<EmptyState onSubmit={onSubmit} />)

    const textbox = screen.getByRole('textbox', { name: 'Send a message...' })
    await user.type(textbox, 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('create failed')
    expect(textbox).toHaveValue('Keep this draft')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  })

  it('carries a selected sticker through the initial-turn draft', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(<EmptyState onSubmit={onSubmit} />)

    await waitFor(() => expect(mocks.fileUrl).toHaveBeenCalledWith('emoji-1'))
    await user.click(screen.getByRole('button', { name: 'Emoji' }))
    const nativeSelect = screen.getByTestId('hidden-select-container').querySelector('select')!
    fireEvent.change(nativeSelect, { target: { value: 'emoji-1' } })

    expect(await screen.findByRole('img', { name: 'Wave' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '',
          attachedFiles: [],
          pendingSticker: expect.objectContaining({
            emoji: expect.objectContaining({ id: 'emoji-1', name: 'Wave' }),
            url: 'asset://wave.png',
          }),
        }),
      ),
    )
  })

  it('marks a dictated first turn without consuming typed-composer rich input', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(<EmptyState onSubmit={onSubmit} />)

    await waitFor(() => expect(mocks.fileUrl).toHaveBeenCalledWith('emoji-1'))
    await user.type(screen.getByRole('textbox', { name: 'Send a message...' }), 'Typed remainder')
    await user.click(screen.getByRole('button', { name: 'Emoji' }))
    const nativeSelect = screen.getByTestId('hidden-select-container').querySelector('select')!
    fireEvent.change(nativeSelect, { target: { value: 'emoji-1' } })
    expect(await screen.findByRole('img', { name: 'Wave' })).toBeInTheDocument()

    act(() => mocks.voiceOnSend?.('  Dictated opening  '))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Dictated opening',
          attachedFiles: [],
          pendingSticker: null,
          voice: true,
          remainingComposer: {
            text: 'Typed remainder',
            attachedFiles: [],
            pendingSticker: expect.objectContaining({
              emoji: expect.objectContaining({ id: 'emoji-1', name: 'Wave' }),
              url: 'asset://wave.png',
            }),
          },
        }),
      ),
    )
  })
})
