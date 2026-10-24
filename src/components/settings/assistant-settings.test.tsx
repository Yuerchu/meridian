import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { AssistantInfoResponse, McpToolInfoResponse, ToolPresetInfoResponse } from '@/types'
import { AssistantSettings } from './assistant-settings'

vi.mock('@/api', () => ({
  api: {
    listAssistants: vi.fn(),
    listProviders: vi.fn(),
    listAllToolNames: vi.fn(),
    listEmojiPacks: vi.fn(),
    listToolPresets: vi.fn(),
    listAssistantEmojiPacks: vi.fn(),
    listSkills: vi.fn(),
    listSkillBindings: vi.fn(),
    getPreference: vi.fn(),
    fetchProviderModels: vi.fn(),
    getModelConfig: vi.fn(),
    getProviderCapabilities: vi.fn(),
    updateAssistant: vi.fn(),
    createAssistant: vi.fn(),
    deleteAssistant: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

const ASSISTANT: AssistantInfoResponse = {
  id: 'assistant-1',
  name: 'Assistant One',
  description: null,
  avatar: null,
  system_prompt: 'You are helpful.',
  provider_id: null,
  model_id: null,
  temperature: null,
  top_p: null,
  max_tokens: null,
  is_default: true,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
  context_limit: 0,
  compact_keep_recent_tokens: 0,
  enabled_tools: null,
  thinking_enabled: false,
  thinking_budget: null,
  tool_preset_id: null,
  auto_compact_enabled: true,
}

const TOOL: McpToolInfoResponse = {
  name: 'read_file',
  description: 'Read a file',
  source: 'builtin',
  server_name: null,
  admin_only: null,
  needs_approval: null,
  scope: null,
}

const PRESET: ToolPresetInfoResponse = {
  id: 'preset-1',
  name: 'Coding',
  description: null,
  icon: null,
  tool_names: ['read_file'],
  is_builtin: true,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
}

describe('AssistantSettings tool mode segment', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listAssistants.mockResolvedValue([ASSISTANT])
    mockApi.listProviders.mockResolvedValue([])
    mockApi.listAllToolNames.mockResolvedValue([TOOL])
    mockApi.listEmojiPacks.mockResolvedValue([])
    mockApi.listToolPresets.mockResolvedValue([PRESET])
    mockApi.listAssistantEmojiPacks.mockResolvedValue([])
    mockApi.listSkills.mockResolvedValue([])
    mockApi.listSkillBindings.mockResolvedValue([])
    mockApi.getPreference.mockImplementation(async (request) => ({ key: request.key, value: null }) as never)
    mockApi.fetchProviderModels.mockResolvedValue([])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.getProviderCapabilities.mockRejectedValue(new Error('none'))
    mockApi.updateAssistant.mockResolvedValue(undefined)
  })

  it('switches all, preset, and custom modes and keeps custom tools in the save payload', async () => {
    const user = userEvent.setup()
    const { container } = render(<AssistantSettings />)

    await user.click(await screen.findByRole('button', { name: /Assistant One/ }))

    const segment = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-slot="segment"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const all = within(segment).getByRole('radio', { name: i18n.t('settings.assistant.toolsAll') })
    const preset = within(segment).getByRole('radio', { name: i18n.t('settings.tools.preset') })
    const custom = within(segment).getByRole('radio', { name: i18n.t('settings.assistant.toolsCustom') })

    expect(all).toHaveAttribute('aria-checked', 'true')

    await user.click(preset)
    expect(preset).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelector('[data-slot="settings-select"]')).toBeInTheDocument()

    await user.click(custom)
    expect(custom).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelector('[data-slot="tool-list"]')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: TOOL.name }))
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() =>
      expect(mockApi.updateAssistant).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ASSISTANT.id,
          enabledTools: [TOOL.name],
          toolPresetId: null,
        }),
      ),
    )
  })
})

describe('AssistantSettings model lock', () => {
  const bound: AssistantInfoResponse = {
    ...ASSISTANT,
    provider_id: 'p1',
    model_id: 'm1',
    thinking_enabled: true,
  }

  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listAssistants.mockResolvedValue([bound])
    mockApi.listProviders.mockResolvedValue([{ id: 'p1', name: 'Gemma' } as never])
    mockApi.listAllToolNames.mockResolvedValue([TOOL])
    mockApi.listEmojiPacks.mockResolvedValue([])
    mockApi.listToolPresets.mockResolvedValue([])
    mockApi.listAssistantEmojiPacks.mockResolvedValue([])
    mockApi.listSkills.mockResolvedValue([])
    mockApi.listSkillBindings.mockResolvedValue([])
    mockApi.getPreference.mockImplementation(async (request) => ({ key: request.key, value: null }) as never)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'm1', name: 'm1' }])
    mockApi.getModelConfig.mockResolvedValue({
      profile: { context_window: 128000 },
    } as never)
    mockApi.getProviderCapabilities.mockResolvedValue({
      supports_thinking: true,
      max_context_tokens: 128000,
    } as never)
    mockApi.updateAssistant.mockResolvedValue(undefined)
  })

  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    render(<AssistantSettings />)
    await user.click(await screen.findByRole('button', { name: /Assistant One/ }))
    expect(
      await screen.findByText(i18n.t('settings.assistant.contextLimitCap', { window: 128000 })),
    ).toBeInTheDocument()
  }

  it('refuses a context limit above the bound model window', async () => {
    const user = userEvent.setup()
    await openEditor(user)

    const field = screen.getByRole('spinbutton', { name: i18n.t('settings.assistant.contextLimit') })
    await user.clear(field)
    await user.type(field, '1000000')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.assistant.contextLimitExceedsModel', { window: 128000 }),
    )
    expect(mockApi.updateAssistant).not.toHaveBeenCalled()
  })

  it('saves a context limit inside the bound model window', async () => {
    const user = userEvent.setup()
    await openEditor(user)

    const field = screen.getByRole('spinbutton', { name: i18n.t('settings.assistant.contextLimit') })
    await user.clear(field)
    await user.type(field, '64000')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() =>
      expect(mockApi.updateAssistant).toHaveBeenCalledWith(
        expect.objectContaining({ id: bound.id, contextLimit: 64000 }),
      ),
    )
  })

  it('refuses thinking when the bound model cannot think', async () => {
    mockApi.getProviderCapabilities.mockResolvedValue({
      supports_thinking: false,
      max_context_tokens: 128000,
    } as never)
    const user = userEvent.setup()
    await openEditor(user)

    expect(await screen.findByText(i18n.t('settings.assistant.thinkingUnsupported'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    expect(mockApi.updateAssistant).not.toHaveBeenCalled()
  })

  // A local model's capability read fails whenever its file does; the window
  // lives on the stored profile and must survive that failure, or the lock is
  // missing exactly where the 1M override used to reach the GPU runtime.
  it('still caps the context limit when the capability read fails', async () => {
    mockApi.getProviderCapabilities.mockRejectedValue(new Error('local file unavailable'))
    const user = userEvent.setup()
    await openEditor(user)

    const field = screen.getByRole('spinbutton', { name: i18n.t('settings.assistant.contextLimit') })
    await user.clear(field)
    await user.type(field, '1000000')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.assistant.contextLimitExceedsModel', { window: 128000 }),
    )
    expect(mockApi.updateAssistant).not.toHaveBeenCalled()
  })
})
