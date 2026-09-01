import { act, render, screen, waitFor } from '@testing-library/react'

import type { InitialTurnDraft } from './conversation-draft'
import type { MessageViewModel, UserCommandResultResponse, UserCommandRunRequest } from '@/types'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { ChatView } from './chat-view'

const mocks = vi.hoisted(() => {
  const sendMessage = vi.fn(() => Promise.resolve())
  const fetchProviderModels = vi.fn()
  const runUserCommand = vi.fn()
  const stopChat = vi.fn()
  const confirm = vi.fn(() => Promise.resolve(false))
  const enqueue = vi.fn(() => Promise.resolve({}))
  const sessions = {
    'conversation-1': {
      messages: [] as MessageViewModel[],
      streaming: false,
      planReviewBarrier: false,
      activeShellTurnId: null as string | null,
      shellResultKeys: {},
      compacting: false,
      error: null,
    },
  }
  const beginShellCommand = vi.fn((conversationId: 'conversation-1', turnId: string) => {
    sessions[conversationId].activeShellTurnId = turnId
  })
  const abortShellCommand = vi.fn((conversationId: 'conversation-1', turnId: string) => {
    if (sessions[conversationId].activeShellTurnId === turnId) sessions[conversationId].activeShellTurnId = null
  })
  const finishShellCommand = vi.fn((result: UserCommandResultResponse) => {
    if (sessions['conversation-1'].activeShellTurnId === result.turn_id) {
      sessions['conversation-1'].activeShellTurnId = null
    }
  })
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
    fetchProviderModels,
    runUserCommand,
    stopChat,
    confirm,
    enqueue,
    sessions,
    beginShellCommand,
    abortShellCommand,
    finishShellCommand,
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
    loadMessages: vi.fn(() => Promise.resolve(true)),
    loadActiveTodos: vi.fn(),
    setError: vi.fn(),
    setCompacting: vi.fn(),
    inputBarProps: vi.fn(),
    starterProps: vi.fn(),
  }
})

vi.mock('@/api', () => ({
  api: {
    fetchProviderModels: mocks.fetchProviderModels,
    runUserCommand: mocks.runUserCommand,
    stopChat: mocks.stopChat,
  },
}))

vi.mock('@/stores/conversation-store', () => {
  const state = {
    sessions: mocks.sessions,
    conversations: [{ id: 'conversation-1', project_id: null, agent_kind: null }],
    projects: [],
    ensureSession: mocks.ensureSession,
    loadMessages: mocks.loadMessages,
    loadActiveTodos: mocks.loadActiveTodos,
    setError: mocks.setError,
    setCompacting: mocks.setCompacting,
    beginShellCommand: mocks.beginShellCommand,
    abortShellCommand: mocks.abortShellCommand,
    finishShellCommand: mocks.finishShellCommand,
  }
  const useConversationStore = Object.assign((selector: (current: typeof state) => unknown) => selector(state), {
    getState: () => state,
  })

  return { useConversationStore }
})

vi.mock('@/hooks/use-turn-settings', () => ({ useTurnSettings: mocks.useTurnSettings }))
vi.mock('@/hooks/use-send-message', () => ({ useSendMessage: mocks.useSendMessage }))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('@/hooks/use-confirm', () => ({ useConfirm: () => ({ confirm: mocks.confirm, confirmDialog: null }) }))
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
    enqueue: mocks.enqueue,
    remove: vi.fn(),
    reorder: vi.fn(),
    setDelivery: vi.fn(),
    release: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-sender-names', () => ({ useSenderNames: () => ({}) }))
vi.mock('./emoji-renderer', () => ({ useEmojiMap: () => ({}) }))

vi.mock('./chat-transcript', () => ({
  ChatTranscript: ({ emptyState }: { emptyState?: React.ReactNode }) => <div>{emptyState}</div>,
}))
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
vi.mock('./empty-state', () => ({
  StarterPrompts: (props: unknown) => {
    mocks.starterProps(props)
    return <div />
  },
}))

interface CapturedInputBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
  streaming: boolean
}

interface CapturedStarterProps {
  disabled: boolean
}

function latestInputBar(): CapturedInputBarProps {
  const call = mocks.inputBarProps.mock.calls.at(-1)
  if (!call) throw new Error('InputBar has not rendered')
  return call[0] as CapturedInputBarProps
}

function latestStarterPrompts(): CapturedStarterProps {
  const call = mocks.starterProps.mock.calls.at(-1)
  if (!call) throw new Error('StarterPrompts has not rendered')
  return call[0] as CapturedStarterProps
}

describe('ChatView initial draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadMessages.mockResolvedValue(true)
    mocks.sessions['conversation-1'].messages = []
    mocks.sessions['conversation-1'].streaming = false
    mocks.sessions['conversation-1'].planReviewBarrier = false
    mocks.sessions['conversation-1'].activeShellTurnId = null
    mocks.confirm.mockResolvedValue(false)
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
  })

  it.each([
    ['pending review', 'pending', null],
    ['queued continuation', 'approved', 'queued'],
    ['held continuation', 'changes_requested', 'held'],
    ['in-doubt continuation', 'approved', 'in_doubt'],
  ] as const)('blocks the composer and starter prompts for a durable %s barrier', (_label, status, deliveryState) => {
    usePlanReviewStore.setState({
      summaries: {
        'review-1': {
          review_id: 'review-1',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-1',
          assistant_message_id: 'message-1',
          provider_call_id: 'call-1',
          turn_id: 'turn-1',
          status,
          delivery_state: deliveryState,
          lock_version: 0,
        },
      },
    })

    render(<ChatView conversationId="conversation-1" />)

    expect(latestInputBar().disabled).toBe(true)
    expect(latestInputBar().streaming).toBe(false)
    expect(latestStarterPrompts().disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Review plan|审阅计划|chat.plan.review/ })).toBeInTheDocument()
  })

  it('unblocks after continuation delivery is acknowledged', () => {
    usePlanReviewStore.setState({
      summaries: {
        'review-1': {
          review_id: 'review-1',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-1',
          assistant_message_id: 'message-1',
          provider_call_id: 'call-1',
          turn_id: 'turn-1',
          status: 'approved',
          delivery_state: 'acknowledged',
          lock_version: 0,
        },
      },
    })

    render(<ChatView conversationId="conversation-1" />)

    expect(latestInputBar().disabled).toBe(false)
    expect(latestStarterPrompts().disabled).toBe(false)
  })

  it('blocks from the conversation-wide snapshot barrier without relying on an exit-plan card', () => {
    mocks.sessions['conversation-1'].planReviewBarrier = true

    render(<ChatView conversationId="conversation-1" />)

    expect(latestInputBar().disabled).toBe(true)
    expect(latestStarterPrompts().disabled).toBe(true)
    expect(screen.getByText(/Review the pending plan|chat.plan.reviewBlocked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Review plan|chat.plan.review/ })).not.toBeInTheDocument()
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
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'Inspect this image',
      true,
      files,
      undefined,
      undefined,
      {
        type: 'sticker',
        sticker_id: 'sticker-1',
        name: 'Wave',
      },
      [],
    )
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
    expect(mocks.sendMessage).toHaveBeenCalledWith('This was dictated', true, undefined, undefined, true, undefined, [])
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

describe('ChatView composer dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessions['conversation-1'].streaming = false
    mocks.sessions['conversation-1'].activeShellTurnId = null
    mocks.confirm.mockResolvedValue(false)
  })

  it('sends an explicit empty context list for an escaped literal mention', async () => {
    render(<ChatView conversationId="conversation-1" />)
    await waitFor(() => expect(mocks.inputBarProps).toHaveBeenCalled())

    act(() => latestInputBar().onChange('\\@literal'))
    await waitFor(() => expect(latestInputBar().value).toBe('\\@literal'))
    act(() => latestInputBar().onSubmit())

    expect(mocks.sendMessage).toHaveBeenCalledWith('@literal', true, undefined, undefined, undefined, undefined, [])
  })

  it('forwards frozen references when queueing a prompt', async () => {
    mocks.sessions['conversation-1'].streaming = true
    render(<ChatView conversationId="conversation-1" />)
    await waitFor(() => expect(mocks.inputBarProps).toHaveBeenCalled())

    act(() => latestInputBar().onChange('Review @src/api.ts'))
    await waitFor(() => expect(latestInputBar().value).toBe('Review @src/api.ts'))
    act(() => latestInputBar().onSubmit())

    expect(mocks.enqueue).toHaveBeenCalledWith('Review @src/api.ts', 'follow_up', [
      { path: 'src/api.ts', lineStart: null, lineEnd: null },
    ])
  })

  it('guards an awaited slash command and preserves a newer draft', async () => {
    let resolveModels: (models: Array<{ id: string; name: string }>) => void = () => {}
    mocks.fetchProviderModels.mockReturnValue(
      new Promise((resolve) => {
        resolveModels = resolve
      }),
    )
    render(<ChatView conversationId="conversation-1" />)

    act(() => latestInputBar().onChange('/model model-next'))
    await waitFor(() => expect(latestInputBar().value).toBe('/model model-next'))
    act(() => {
      latestInputBar().onSubmit()
      latestInputBar().onSubmit()
    })

    await waitFor(() => expect(mocks.fetchProviderModels).toHaveBeenCalledTimes(1))
    expect(latestInputBar().disabled).toBe(true)
    expect(latestInputBar().streaming).toBe(false)

    act(() => latestInputBar().onChange('keep this draft'))
    act(() => resolveModels([{ id: 'model-next', name: 'Model Next' }]))
    await waitFor(() => expect(mocks.settings.onSelectModel).toHaveBeenCalledWith('model-next', 'provider-draft'))
    expect(latestInputBar().value).toBe('keep this draft')
    expect(latestInputBar().disabled).toBe(false)
  })

  it('runs a shell command once and identifies the command and cwd in the retry confirmation', async () => {
    const sandboxDenied: UserCommandResultResponse = {
      conversation_id: 'conversation-1',
      turn_id: 'turn-shell',
      message_id: 'message-shell',
      status: 'sandbox_denied',
      stdout: '',
      stderr: '',
      exit_code: null,
      timed_out: false,
      truncated: false,
      sandbox: 'windows_restricted_token',
      duration_ms: 4,
      cwd: 'C:/repo with spaces',
      host: 'desktop',
      error: 'sandbox denied',
      can_retry_without_sandbox: true,
      retry_without_sandbox: false,
    }
    mocks.runUserCommand.mockResolvedValue(sandboxDenied)
    render(<ChatView conversationId="conversation-1" />)

    act(() => latestInputBar().onChange('!echo hello'))
    await waitFor(() => expect(latestInputBar().value).toBe('!echo hello'))
    act(() => {
      latestInputBar().onSubmit()
      latestInputBar().onSubmit()
    })

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.runUserCommand).toHaveBeenCalledTimes(1)
    expect(mocks.runUserCommand).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      command: 'echo hello',
      turnId: expect.any(String),
      retryWithoutSandbox: null,
    })

    render(mocks.confirm.mock.calls[0][0].body)
    expect(screen.getByText('echo hello')).toBeInTheDocument()
    expect(screen.getByText('C:/repo with spaces')).toBeInTheDocument()
  })

  it('restores a shell draft after a negative reload and reuses its turn id when submitted again', async () => {
    mocks.runUserCommand.mockRejectedValue(new Error('preflight failed'))
    render(<ChatView conversationId="conversation-1" />)
    await waitFor(() => expect(mocks.inputBarProps).toHaveBeenCalled())
    mocks.loadMessages.mockClear()

    act(() => latestInputBar().onChange('!echo once'))
    await waitFor(() => expect(latestInputBar().value).toBe('!echo once'))
    act(() => latestInputBar().onSubmit())

    await waitFor(() => expect(latestInputBar().value).toBe('!echo once'))
    expect(mocks.abortShellCommand).toHaveBeenCalledWith(
      'conversation-1',
      expect.any(String),
      'Error: preflight failed',
    )
    await waitFor(() => expect(mocks.loadMessages).toHaveBeenCalledTimes(2))

    const firstTurnId = mocks.runUserCommand.mock.calls[0][0].turnId
    act(() => latestInputBar().onSubmit())

    await waitFor(() => expect(mocks.runUserCommand).toHaveBeenCalledTimes(2))
    expect(mocks.runUserCommand.mock.calls[1][0].turnId).toBe(firstTurnId)
  })

  it('does not restore a runnable draft when a lost response left a durable shell row', async () => {
    let attemptedTurn = ''
    mocks.runUserCommand.mockImplementation((request: UserCommandRunRequest) => {
      attemptedTurn = request.turnId
      return Promise.reject(new Error('response lost'))
    })
    render(<ChatView conversationId="conversation-1" />)
    await waitFor(() => expect(mocks.inputBarProps).toHaveBeenCalled())
    mocks.loadMessages.mockImplementation(async () => {
      mocks.sessions['conversation-1'].messages = [{ source: 'shell', turn_id: attemptedTurn } as MessageViewModel]
      return true
    })

    act(() => latestInputBar().onChange('!touch side-effect'))
    await waitFor(() => expect(latestInputBar().value).toBe('!touch side-effect'))
    act(() => latestInputBar().onSubmit())

    await waitFor(() => expect(mocks.loadMessages).toHaveBeenCalled())
    expect(latestInputBar().value).toBe('')
    expect(mocks.abortShellCommand).not.toHaveBeenCalled()
  })

  it('keeps an ambiguous command out of the composer when reload also fails', async () => {
    mocks.runUserCommand.mockRejectedValue(new Error('response lost'))
    render(<ChatView conversationId="conversation-1" />)
    await waitFor(() => expect(mocks.inputBarProps).toHaveBeenCalled())
    mocks.loadMessages.mockRejectedValue(new Error('offline'))

    act(() => latestInputBar().onChange('!touch side-effect'))
    await waitFor(() => expect(latestInputBar().value).toBe('!touch side-effect'))
    act(() => latestInputBar().onSubmit())

    await waitFor(() => expect(mocks.setError).toHaveBeenCalledWith('conversation-1', 'Error: response lost'))
    expect(latestInputBar().value).toBe('')
    expect(mocks.abortShellCommand).not.toHaveBeenCalled()
  })
})
