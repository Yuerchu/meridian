import { act, renderHook, waitFor } from '@testing-library/react'

import type { DraftTurnSettings } from '@/components/chat/conversation-draft'
import { useConversationStore } from '@/stores/conversation-store'
import type {
  AssistantInfoResponse,
  ConversationInfoResponse,
  ProviderInfoResponse,
  ProviderCapabilitiesInfoResponse,
} from '@/types'
import { useTurnSettings } from './use-turn-settings'

const mocks = vi.hoisted(() => ({
  listAssistants: vi.fn(),
  listProviders: vi.fn(),
  listConversations: vi.fn(),
  getProviderCapabilities: vi.fn(),
  setConversationAssistant: vi.fn(),
  setConversationReasoningPrefs: vi.fn(),
  setConversationMode: vi.fn(),
  setConversationAcceptEdits: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: mocks,
}))

const assistants: AssistantInfoResponse[] = [
  {
    id: 'assistant-default',
    name: 'Default',
    description: null,
    avatar: null,
    system_prompt: '',
    provider_id: 'provider-default',
    model_id: 'model-default',
    temperature: null,
    top_p: null,
    max_tokens: null,
    is_default: true,
    sort_order: 0,
    created_at: 1,
    updated_at: 1,
    context_limit: 128_000,
    compact_keep_recent: 8,
    enabled_tools: null,
    thinking_enabled: true,
    thinking_budget: null,
    tool_preset_id: null,
    auto_compact_enabled: true,
  },
  {
    id: 'assistant-draft',
    name: 'Draft',
    description: null,
    avatar: null,
    system_prompt: '',
    provider_id: 'provider-draft',
    model_id: 'assistant-model',
    temperature: null,
    top_p: null,
    max_tokens: null,
    is_default: false,
    sort_order: 1,
    created_at: 1,
    updated_at: 1,
    context_limit: 128_000,
    compact_keep_recent: 8,
    enabled_tools: null,
    thinking_enabled: true,
    thinking_budget: null,
    tool_preset_id: null,
    auto_compact_enabled: true,
  },
]

const providers: ProviderInfoResponse[] = [
  {
    id: 'provider-default',
    name: 'Default',
    provider_type: 'openai',
    base_url: '',
    is_enabled: true,
    sort_order: 0,
    created_at: 1,
    updated_at: 1,
    api_format: 'responses',
    catalog_id: null,
    credential_kind: 'api_key',
    transport_profile: 'openai',
  },
  {
    id: 'provider-draft',
    name: 'Draft',
    provider_type: 'openai',
    base_url: '',
    is_enabled: true,
    sort_order: 1,
    created_at: 1,
    updated_at: 1,
    api_format: 'responses',
    catalog_id: null,
    credential_kind: 'api_key',
    transport_profile: 'openai',
  },
]

const capabilities: ProviderCapabilitiesInfoResponse = {
  supports_tools: true,
  supports_streaming_tools: true,
  supports_thinking: true,
  supports_thinking_off: true,
  supports_images: true,
  max_context_tokens: 128_000,
  max_output_tokens: 16_000,
  supports_pdf: false,
  supports_temperature: true,
  supports_top_p: true,
  max_temperature: 2,
  thinking_style: 'effort_only',
  supported_efforts: ['low', 'medium', 'high'],
  default_effort: 'medium',
  supports_fast: true,
  supports_verbosity: false,
  default_verbosity: null,
  server_tools: [],
}

const draft: DraftTurnSettings = {
  selectedAssistantId: 'assistant-draft',
  // Deliberately not the assistant's default: this is the value that used to
  // disappear when the assistant list resolved after the first render.
  selectedModelId: 'model-picked-for-first-turn',
  selectedProviderId: 'provider-draft',
  thinkingLevel: 'high',
  fastMode: true,
  mode: 'plan',
  acceptEdits: true,
}

function conversation(overrides: Partial<ConversationInfoResponse> = {}): ConversationInfoResponse {
  return {
    id: 'conversation-1',
    title: null,
    assistant_id: 'assistant-default',
    is_pinned: false,
    is_archived: false,
    message_count: 0,
    created_at: 1,
    updated_at: 1,
    project_id: null,
    thinking_level: null,
    fast_mode: false,
    mode: null,
    head_message_id: null,
    accept_edits: false,
    agent_kind: null,
    ...overrides,
  }
}

describe('useTurnSettings draft mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAssistants.mockResolvedValue(assistants)
    mocks.listProviders.mockResolvedValue(providers)
    mocks.listConversations.mockResolvedValue([])
    mocks.getProviderCapabilities.mockResolvedValue(capabilities)
    mocks.setConversationAssistant.mockResolvedValue(undefined)
    mocks.setConversationReasoningPrefs.mockResolvedValue(undefined)
    mocks.setConversationMode.mockResolvedValue(undefined)
    mocks.setConversationAcceptEdits.mockResolvedValue(undefined)
    useConversationStore.setState({ conversations: [] })
  })

  it('keeps the initial first-turn selection after the catalog loads', async () => {
    const { result } = renderHook(() => useTurnSettings(null, draft))

    await waitFor(() => expect(result.current.assistants).toHaveLength(2))
    expect(result.current.selectedAssistantId).toBe('assistant-draft')
    expect(result.current.selectedModelId).toBe('model-picked-for-first-turn')
    expect(result.current.selectedProviderId).toBe('provider-draft')
    expect(result.current.thinkingLevel).toBe('high')
    expect(result.current.fastMode).toBe(true)
    expect(result.current.mode).toBe('plan')
    expect(result.current.acceptEdits).toBe(true)
  })

  it('updates every choice locally without writing a nonexistent conversation', async () => {
    const { result } = renderHook(() => useTurnSettings(null, draft))
    await waitFor(() => expect(result.current.assistants).toHaveLength(2))

    act(() => {
      result.current.onSelectAssistant('assistant-default')
      result.current.onSelectModel('another-model', 'provider-default')
      result.current.onSelectThinkingLevel('low')
      result.current.onToggleFast(false)
      result.current.onSelectMode('work')
      result.current.onToggleAcceptEdits(false)
    })

    expect(result.current.selectedAssistantId).toBe('assistant-default')
    expect(result.current.selectedModelId).toBe('another-model')
    expect(result.current.selectedProviderId).toBe('provider-default')
    expect(result.current.thinkingLevel).toBe('low')
    expect(result.current.fastMode).toBe(false)
    expect(result.current.mode).toBe('work')
    expect(result.current.acceptEdits).toBe(false)
    expect(mocks.setConversationAssistant).not.toHaveBeenCalled()
    expect(mocks.setConversationReasoningPrefs).not.toHaveBeenCalled()
    expect(mocks.setConversationMode).not.toHaveBeenCalled()
    expect(mocks.setConversationAcceptEdits).not.toHaveBeenCalled()
  })

  it('keeps the first-turn mode and edit permission while the sidebar is still missing the new conversation', async () => {
    const { result } = renderHook(() => useTurnSettings('conversation-new', draft))

    await waitFor(() => expect(result.current.assistants).toHaveLength(2))
    expect(result.current.mode).toBe('plan')
    expect(result.current.acceptEdits).toBe(true)
    expect(result.current.selectedModelId).toBe('model-picked-for-first-turn')

    // Once the delayed row arrives, consume the seed without replacing its
    // explicit per-turn model with the assistant default.
    act(() => {
      useConversationStore.setState({
        conversations: [
          conversation({
            id: 'conversation-new',
            assistant_id: 'assistant-draft',
            thinking_level: 'high',
            fast_mode: true,
            mode: 'plan',
            accept_edits: true,
          }),
        ],
      })
    })
    await waitFor(() => expect(result.current.selectedAssistantId).toBe('assistant-draft'))
    expect(result.current.selectedModelId).toBe('model-picked-for-first-turn')

    // A later real assistant switch is no longer shadowed by the welcome seed.
    act(() => {
      useConversationStore.setState({
        conversations: [conversation({ id: 'conversation-new', assistant_id: 'assistant-default' })],
      })
    })
    await waitFor(() => expect(result.current.selectedAssistantId).toBe('assistant-default'))
    expect(result.current.selectedModelId).toBe('model-default')
  })

  it('keeps persisting settings once a real conversation exists', async () => {
    const persisted = conversation()
    mocks.listConversations.mockResolvedValue([persisted])
    useConversationStore.setState({ conversations: [persisted] })
    const { result } = renderHook(() => useTurnSettings(persisted.id))
    await waitFor(() => expect(result.current.assistants).toHaveLength(2))

    act(() => result.current.onSelectMode('plan'))

    await waitFor(() => expect(mocks.setConversationMode).toHaveBeenCalledWith({ id: persisted.id, mode: 'plan' }))
  })
})
