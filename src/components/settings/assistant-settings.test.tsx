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
    listPromptTemplates: vi.fn(),
    listTemplateVariables: vi.fn(),
    listEmojiPacks: vi.fn(),
    listToolPresets: vi.fn(),
    listAssistantEmojiPacks: vi.fn(),
    listSkills: vi.fn(),
    listSkillBindings: vi.fn(),
    getPreference: vi.fn(),
    fetchProviderModels: vi.fn(),
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
  compact_keep_recent: 0,
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
    mockApi.listPromptTemplates.mockResolvedValue([])
    mockApi.listTemplateVariables.mockResolvedValue([])
    mockApi.listEmojiPacks.mockResolvedValue([])
    mockApi.listToolPresets.mockResolvedValue([PRESET])
    mockApi.listAssistantEmojiPacks.mockResolvedValue([])
    mockApi.listSkills.mockResolvedValue([])
    mockApi.listSkillBindings.mockResolvedValue([])
    mockApi.getPreference.mockImplementation(async (request) => ({ key: request.key, value: null }) as never)
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
