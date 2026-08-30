import { render, waitFor } from '@testing-library/react'

import type { InitialTurnDraft } from './conversation-draft'
import { ChatView } from './chat-view'

const mocks = vi.hoisted(() => {
  const sendMessage = vi.fn(() => Promise.resolve())
  const settings = {
    assistants: [],
    providers: [],
    selectedAssistant: undefined,
    selectedAssistantId: 'assistant-draft',
    selectedModelId: 'model-draft',
    selectedProviderId: 'provider-draft',
    thinkingLevel: 'high' as const,
    fastMode: true,
    mode: 'plan' as const,
    acceptEdits: true,
    capabilities: null,
    onSelectAssistant: vi.fn(),
    onSelectModel: vi.fn(),
    onSelectThinkingLevel: vi.fn(),
    onToggleFast: vi.fn(),
    onSelectMode: vi.fn(),
    onToggleAcceptEdits: vi.fn(),
  }

  return {
    sendMessage,
    settings,
    useTurnSettings: vi.fn(() => settings),
    useSendMessage: vi.fn(() => ({
      sendMessage,
      steerMessage: vi.fn(() => Promise.resolve(true)),
      handleRegenerate: vi.fn(),
      handleEdit: vi.fn(),
      handleVoiceSend: vi.fn(),
    })),
    ensureSession: vi.fn(),
    loadMessages: vi.fn(),
    loadActiveTodos: vi.fn(),
    setError: vi.fn(),
    setCompacting: vi.fn(),
    inputBarProps: vi.fn(),
  }
})

vi.mock('@/api', () => ({ api: {} }))

vi.mock('@/stores/conversation-store', () => {
  const state = {
    sessions: {
      'conversation-1': {
        messages: [],
        streaming: false,
        compacting: false,
        error: null,
      },
    },
    conversations: [{ id: 'conversation-1', project_id: null, agent_kind: null }],
    projects: [],
    ensureSession: mocks.ensureSession,
    loadMessages: mocks.loadMessages,
    loadActiveTodos: mocks.loadActiveTodos,
    setError: mocks.setError,
    setCompacting: mocks.setCompacting,
  }
  const useConversationStore = Object.assign((selector: (current: typeof state) => unknown) => selector(state), {
    getState: () => state,
  })

  return { useConversationStore }
})

vi.mock('@/hooks/use-turn-settings', () => ({ useTurnSettings: mocks.useTurnSettings }))
vi.mock('@/hooks/use-send-message', () => ({ useSendMessage: mocks.useSendMessage }))
vi.mock('@/hooks/use-turns', () => ({ useTurns: () => [] }))
vi.mock('@/hooks/use-context-info', () => ({
  useContextInfo: () => ({
    messageCount: 0,
    estimatedTokens: 0,
    contextLimit: 128_000,
    autoCompactEnabled: false,
    autoCompactThreshold: 0,
    compactBreaker: 'closed',
    model: '',
  }),
}))
vi.mock('@/hooks/use-prompt-queue', () => ({
  usePromptQueue: () => ({
    items: [],
    held: false,
    enqueue: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    setDelivery: vi.fn(),
    release: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-sender-names', () => ({ useSenderNames: () => ({}) }))
vi.mock('./emoji-renderer', () => ({ useEmojiMap: () => ({}) }))

vi.mock('./chat-transcript', () => ({ ChatTranscript: () => <div /> }))
vi.mock('./compacted-region', () => ({ CompactedRegion: () => <div /> }))
vi.mock('./transcript-status', () => ({ TranscriptStatus: () => <div /> }))
vi.mock('./input-bar', () => ({
  InputBar: (props: unknown) => {
    mocks.inputBarProps(props)
    return <div />
  },
}))
vi.mock('./prompt-queue', () => ({ PromptQueue: () => <div /> }))
vi.mock('./todo-bar', () => ({ TodoBar: () => <div /> }))
vi.mock('./empty-state', () => ({ StarterPrompts: () => <div /> }))

describe('ChatView initial draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delivers the complete first turn exactly once', async () => {
    const files = [{ path: 'C:\\tmp\\reference.png', name: 'reference.png' }]
    const draft: InitialTurnDraft = {
      text: 'Inspect this image',
      attachedFiles: files,
      pendingSticker: {
        emoji: {
          id: 'sticker-1',
          name: 'Wave',
        },
        url: 'asset://wave.png',
      } as InitialTurnDraft['pendingSticker'],
      voice: false,
      remainingComposer: null,
      settings: {
        selectedAssistantId: 'assistant-draft',
        selectedModelId: 'model-draft',
        selectedProviderId: 'provider-draft',
        thinkingLevel: 'high',
        fastMode: true,
        mode: 'plan',
        acceptEdits: true,
      },
    }
    const onInitialDraftConsumed = vi.fn()
    const { rerender } = render(
      <ChatView conversationId="conversation-1" initialDraft={draft} onInitialDraftConsumed={onInitialDraftConsumed} />,
    )

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    expect(mocks.sendMessage).toHaveBeenCalledWith('Inspect this image', true, files, undefined, undefined, {
      type: 'sticker',
      sticker_id: 'sticker-1',
      name: 'Wave',
    })
    expect(onInitialDraftConsumed).toHaveBeenCalledTimes(1)
    expect(mocks.useTurnSettings).toHaveBeenCalledWith('conversation-1', draft.settings)
    expect(mocks.useSendMessage).toHaveBeenCalledWith('conversation-1', {
      streaming: false,
      selectedAssistantId: 'assistant-draft',
      selectedModelId: 'model-draft',
      selectedProviderId: 'provider-draft',
      thinkingLevel: 'high',
      fastMode: true,
      mode: 'plan',
    })

    // A parent render can rebuild the draft object before it observes the
    // consumed callback. Conversation identity, not object identity, is what
    // prevents a duplicate first turn.
    rerender(
      <ChatView
        conversationId="conversation-1"
        initialDraft={{ ...draft }}
        onInitialDraftConsumed={onInitialDraftConsumed}
      />,
    )

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(onInitialDraftConsumed).toHaveBeenCalledTimes(1)
  })

  it('preserves the voice marker on a dictated first turn', async () => {
    const draft: InitialTurnDraft = {
      text: 'This was dictated',
      attachedFiles: [],
      pendingSticker: null,
      voice: true,
      remainingComposer: {
        text: 'Typed remainder',
        attachedFiles: [{ path: 'C:\\tmp\\later.txt', name: 'later.txt' }],
        pendingSticker: {
          emoji: { id: 'later-sticker', name: 'Later' },
          url: 'asset://later.png',
        } as InitialTurnDraft['pendingSticker'],
      },
      settings: {
        selectedAssistantId: 'assistant-draft',
        selectedModelId: 'model-draft',
        selectedProviderId: 'provider-draft',
        thinkingLevel: 'high',
        fastMode: true,
        mode: 'plan',
        acceptEdits: true,
      },
    }
    const onInitialDraftConsumed = vi.fn()

    render(
      <ChatView conversationId="conversation-1" initialDraft={draft} onInitialDraftConsumed={onInitialDraftConsumed} />,
    )

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    expect(mocks.sendMessage).toHaveBeenCalledWith('This was dictated', true, undefined, undefined, true, undefined)
    expect(onInitialDraftConsumed).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mocks.inputBarProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          value: 'Typed remainder',
          attachedFiles: [{ path: 'C:\\tmp\\later.txt', name: 'later.txt' }],
          pendingSticker: expect.objectContaining({
            emoji: expect.objectContaining({ id: 'later-sticker', name: 'Later' }),
          }),
        }),
      ),
    )
  })
})
