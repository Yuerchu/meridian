import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { api } from '@/api'
import { ModelsSettings } from './index'
import type { LogicalModelInfoResponse } from '@/types'

vi.mock('@/api', () => ({
  api: {
    logicalModels: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    modelDeployments: {
      update: vi.fn(),
      switchProfile: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

const CLAUDE_MODEL: LogicalModelInfoResponse = {
  profile: {
    id: 'profile-claude',
    name: 'Claude Sonnet 4.6',
    canonical_id: 'anthropic/claude-sonnet-4-6',
    capability_domain: 'chat',
    family: 'claude',
    icon: null,
    routing_policy: 'sticky_manual',
    is_archived: false,
    context_window: 200_000,
    compact_threshold: 160_000,
    max_output_tokens: 64_000,
    input_price: null,
    output_price: null,
    cache_read_price: null,
    cache_write_price: null,
    cache_write_1h_price: null,
    cache_ttl: null,
    pricing_tiers: [],
    capability_overrides: null,
    model_count: 2,
    created_at: 1,
    updated_at: 1,
  },
  deployments: [
    {
      id: 'dep-official',
      provider_id: 'p-anthropic',
      provider_name: 'Anthropic',
      provider_icon: null,
      provider_catalog_id: 'anthropic',
      provider_enabled: true,
      model_id: 'claude-sonnet-4-6',
      profile_id: 'profile-claude',
      effective_protocol: 'anthropic_messages',
      protocol_override: null,
      compliance: { status: 'standard' },
      is_enabled: true,
      priority: 10,
      overrides_pricing: false,
      effective_pricing: {
        input_price: null,
        output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        cache_write_1h_price: null,
        pricing_tiers: [],
        server_tool_price: null,
      },
      capability_overrides: null,
      created_at: 1,
      updated_at: 1,
    },
    {
      id: 'dep-relay',
      provider_id: 'p-relay',
      provider_name: 'Relay',
      provider_icon: null,
      provider_catalog_id: null,
      provider_enabled: true,
      model_id: 'anthropic/claude-sonnet-4-6',
      profile_id: 'profile-claude',
      effective_protocol: 'openai_chat',
      protocol_override: null,
      compliance: {
        status: 'degraded',
        expected: ['anthropic_messages'],
        lost_capabilities: ['prompt_cache_control', 'thinking_signature'],
      },
      is_enabled: true,
      priority: 50,
      overrides_pricing: false,
      effective_pricing: {
        input_price: null,
        output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        cache_write_1h_price: null,
        pricing_tiers: [],
        server_tool_price: null,
      },
      capability_overrides: null,
      created_at: 1,
      updated_at: 1,
    },
  ],
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.logicalModels.list.mockResolvedValue([CLAUDE_MODEL])
  mockApi.modelDeployments.update.mockResolvedValue({} as never)
  mockApi.modelDeployments.switchProfile.mockResolvedValue({} as never)
  mockApi.modelDeployments.delete.mockResolvedValue(undefined)
})

describe('ModelsSettings', () => {
  it('displays official protocol compliance and compatibility relay degradation honestly', async () => {
    render(<ModelsSettings />)
    expect(await screen.findByText('Claude Sonnet 4.6')).toBeInTheDocument()
    expect(screen.getAllByText('anthropic/claude-sonnet-4-6').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/Official standard · anthropic_messages/)).toBeInTheDocument()
    expect(screen.getByText(/Compatibility relay · openai_chat/)).toBeInTheDocument()
    expect(screen.getByText(/prompt_cache_control, thinking_signature/)).toBeInTheDocument()
  })

  it('splits and unlinks deployments through first-class model deployment commands', async () => {
    const user = userEvent.setup()
    render(<ModelsSettings />)
    await screen.findByText('Claude Sonnet 4.6')

    const splitButtons = screen.getAllByRole('button', { name: 'Split' })
    await user.click(splitButtons[1])
    await waitFor(() =>
      expect(mockApi.modelDeployments.switchProfile).toHaveBeenCalledWith({
        deployment_id: 'dep-relay',
        target_profile_id: null,
        new_profile_name: 'anthropic/claude-sonnet-4-6 (Relay)',
      }),
    )

    const unlinkButtons = screen.getAllByRole('button', { name: 'Unlink' })
    await user.click(unlinkButtons[1])
    await waitFor(() => expect(mockApi.modelDeployments.delete).toHaveBeenCalledWith({ id: 'dep-relay' }))
  })
})
