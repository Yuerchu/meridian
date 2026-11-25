import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { parseTokenCount, safeThreshold } from './capabilities'
import { ModelPage } from './model-page'
import { demoLocalModel } from '@/dev/demo/local-model'
import type { ProviderCapabilitiesInfoResponse } from '@/types'

vi.mock('@/api', () => ({
  api: {
    modelConfigs: {
      get: vi.fn(),
      listProfiles: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    providers: {
      getCapabilities: vi.fn(),
      getLocalModel: vi.fn(),
    },
    assistants: {
      list: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

const EXISTING = {
  id: 'cfg-1',
  provider_id: 'p1',
  model_id: 'm1',
  profile: {
    id: 'prof-1',
    name: 'm1',
    context_window: 200000,
    compact_threshold: 150000,
    max_output_tokens: null,
    input_price: null,
    output_price: null,
    cache_read_price: null,
    cache_write_price: null,
    pricing_tiers: [],
    capability_overrides: null,
    model_count: 1,
    created_at: 0,
    updated_at: 0,
  },
  overrides_pricing: false,
  input_price: null,
  output_price: null,
  cache_read_price: null,
  cache_write_price: null,
  pricing_tiers: [],
  server_tools: null,
  server_tool_price: null,
  effective_pricing: {
    input_price: null,
    output_price: null,
    cache_read_price: null,
    cache_write_price: null,
    pricing_tiers: [],
    server_tool_price: null,
  },
  created_at: 0,
  updated_at: 0,
} as never

function renderPage(confirm = vi.fn().mockResolvedValue(true), onDeleted = vi.fn(), apiFormat = 'chat_completions') {
  render(
    <ModelPage
      providerId="p1"
      modelId="m1"
      apiFormat={apiFormat}
      onSaved={() => {}}
      onDeleted={onDeleted}
      confirm={confirm}
    />,
  )
  return { confirm, onDeleted }
}

describe('ModelPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
    // jsdom has no layout, so no scrollIntoView; the refusal path calls it.
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.modelConfigs.get.mockResolvedValue(EXISTING)
    mockApi.modelConfigs.listProfiles.mockResolvedValue([])
    mockApi.providers.getCapabilities.mockRejectedValue(new Error('none'))
    mockApi.modelConfigs.set.mockResolvedValue(EXISTING)
    mockApi.modelConfigs.delete.mockResolvedValue(undefined)
    mockApi.assistants.list.mockResolvedValue([])
  })

  it('shows a load error with retry instead of an empty editor', async () => {
    mockApi.modelConfigs.get.mockRejectedValueOnce('db locked')
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.model.loadError'))
    expect(screen.queryByRole('button', { name: i18n.t('common.save') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByRole('button', { name: i18n.t('common.save') })).toBeInTheDocument()
  })

  it('asks before deleting, and reports a failed delete', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { onDeleted } = renderPage(confirm)

    const del = await screen.findByRole('button', { name: i18n.t('common.delete') })
    await user.click(del)
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(mockApi.modelConfigs.delete).not.toHaveBeenCalled()

    mockApi.modelConfigs.delete.mockRejectedValueOnce('held by a plan review')
    await user.click(del)
    expect(await screen.findByRole('alert')).toHaveTextContent('held by a plan review')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  // The number field takes no letters at all, so "unreadable" can no longer be
  // typed; what has to hold is that the field left empty is refused, not saved
  // as a default window.
  it('refuses an unreadable context window instead of saving a default', async () => {
    const user = userEvent.setup()
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await user.clear(ctx)
    await user.type(ctx, 'abc')
    expect(ctx).toHaveValue('')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.model.limitRequiredError', { field: i18n.t('settings.model.contextWindow') }),
    )
    expect(mockApi.modelConfigs.set).not.toHaveBeenCalled()
  })

  it('leaves the window blank and required when nothing knows it, and says so at save', async () => {
    mockApi.modelConfigs.get.mockResolvedValue(null as never)
    const user = userEvent.setup()
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    const threshold = screen.getByRole('textbox', { name: i18n.t('settings.model.compactThreshold') })
    expect(ctx).toHaveValue('')
    expect(threshold).toHaveValue('')
    expect(ctx).toBeRequired()

    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.model.limitRequiredError', { field: i18n.t('settings.model.contextWindow') }),
    )
    expect(ctx).toHaveFocus()
    expect(mockApi.modelConfigs.set).not.toHaveBeenCalled()
  })

  it('prefills the window from the model’s capabilities when they are known', async () => {
    mockApi.modelConfigs.get.mockResolvedValue(null as never)
    mockApi.providers.getCapabilities.mockResolvedValue({
      max_context_tokens: 64000,
      max_output_tokens: 8000,
      supported_efforts: [],
      server_tools: [],
    } as never)
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await waitFor(() => expect(ctx).toHaveValue('64,000'))
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.compactThreshold') })).toHaveValue(
      safeThreshold(64000, 8000).toLocaleString('en-US'),
    )
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.maxOutput') })).toHaveValue('8,000')
  })

  it('suggests no threshold when the output ceiling is unknown', async () => {
    mockApi.modelConfigs.get.mockResolvedValue(null as never)
    mockApi.providers.getCapabilities.mockResolvedValue({
      max_context_tokens: 64000,
      max_output_tokens: null,
      supported_efforts: [],
      server_tools: [],
    } as never)
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await waitFor(() => expect(ctx).toHaveValue('64,000'))
    // A reserve of nothing would be a threshold for a zero-token reply.
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.compactThreshold') })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.maxOutput') })).toHaveValue('')
  })

  it('says it saved', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() => expect(mockApi.modelConfigs.set).toHaveBeenCalledTimes(1))
    expect(mockApi.modelConfigs.set.mock.calls[0][0].profile.context_window).toBe(200000)
    expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('common.saved'))
  })

  it('keeps a stored provider tool the provider no longer offers when another is ticked', async () => {
    const user = userEvent.setup()
    mockApi.modelConfigs.get.mockResolvedValue({ ...(EXISTING as object), server_tools: ['code_execution'] } as never)
    mockApi.providers.getCapabilities.mockResolvedValue({
      max_context_tokens: null,
      max_output_tokens: null,
      supported_efforts: [],
      server_tools: ['web_search', 'x_search'],
    } as never)
    renderPage()

    const group = await screen.findByRole('group', { name: i18n.t('settings.model.serverTools') })
    await user.click(within(group).getByRole('checkbox', { name: i18n.t('settings.model.serverTool.x_search') }))
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() => expect(mockApi.modelConfigs.set).toHaveBeenCalledTimes(1))
    expect(mockApi.modelConfigs.set.mock.calls[0][0].server_tools).toEqual(['code_execution', 'x_search'])
  })

  it('blocks a local save until both capability reads succeed, then permits it', async () => {
    const user = userEvent.setup()
    let complete: (value: ProviderCapabilitiesInfoResponse) => void = () => {
      throw new Error('capability lookup did not start')
    }
    mockApi.providers.getCapabilities.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    mockApi.providers.getLocalModel.mockResolvedValueOnce({
      ...demoLocalModel('C:/Models/custom.litertlm', 'gpu'),
      max_context_tokens: null,
    })
    renderPage(vi.fn().mockResolvedValue(true), vi.fn(), 'litert_lm')
    const output = await screen.findByRole('textbox', { name: new RegExp(i18n.t('settings.model.maxOutput')) })
    await user.type(output, '32')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.localModel.capabilitiesError'))
    expect(mockApi.modelConfigs.set).not.toHaveBeenCalled()
    await act(async () => {
      complete({ supported_efforts: [], server_tools: [], max_context_tokens: null, max_output_tokens: null } as never)
    })
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() => expect(mockApi.modelConfigs.set).toHaveBeenCalledTimes(1))
  })

  it('refuses a local save when metadata inspection fails', async () => {
    const user = userEvent.setup()
    mockApi.providers.getCapabilities.mockResolvedValueOnce({ supported_efforts: [], server_tools: [] } as never)
    mockApi.providers.getLocalModel.mockRejectedValueOnce(new Error('model file changed'))
    renderPage(vi.fn().mockResolvedValue(true), vi.fn(), 'litert_lm')
    await screen.findByText('Error: model file changed')
    await user.type(screen.getByRole('textbox', { name: new RegExp(i18n.t('settings.model.maxOutput')) }), '32')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    expect(mockApi.modelConfigs.set).not.toHaveBeenCalled()
  })

  it('refuses a window that leaves a bound assistant unsupported', async () => {
    const user = userEvent.setup()
    mockApi.assistants.list.mockResolvedValue([
      {
        name: 'Elegy',
        provider_id: 'p1',
        model_id: 'm1',
        context_limit: 300_000,
        thinking_enabled: false,
        max_tokens: null,
      } as never,
    ])
    renderPage()

    const window = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await user.clear(window)
    await user.type(window, '250000')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.model.boundAssistantContext', { name: 'Elegy', limit: 300_000, window: 250_000 }),
    )
    expect(mockApi.modelConfigs.set).not.toHaveBeenCalled()
  })

  it('saves an unrelated edit while a bound assistant is already over the window', async () => {
    const user = userEvent.setup()
    mockApi.assistants.list.mockResolvedValue([
      {
        name: 'Elegy',
        provider_id: 'p1',
        model_id: 'm1',
        context_limit: 1_000_000,
        thinking_enabled: false,
        max_tokens: null,
      } as never,
    ])
    renderPage()

    await user.click(await screen.findByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() => expect(mockApi.modelConfigs.set).toHaveBeenCalledTimes(1))
  })

  it('parses token counts strictly', () => {
    expect(parseTokenCount(' 4096 ')).toBe(4096)
    expect(parseTokenCount('12k')).toBeUndefined()
    expect(parseTokenCount('0')).toBeUndefined()
    expect(parseTokenCount('')).toBeUndefined()
  })
})
