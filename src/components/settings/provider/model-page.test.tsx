import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { parseTokenCount, safeThreshold } from './capabilities'
import { ModelPage } from './model-page'

vi.mock('@/api', () => ({
  api: {
    getModelConfig: vi.fn(),
    listModelProfiles: vi.fn(),
    getProviderCapabilities: vi.fn(),
    saveModelConfig: vi.fn(),
    deleteModelConfig: vi.fn(),
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

function renderPage(confirm = vi.fn().mockResolvedValue(true), onDeleted = vi.fn()) {
  render(
    <ModelPage
      providerId="p1"
      modelId="m1"
      apiFormat="chat_completions"
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
    mockApi.getModelConfig.mockResolvedValue(EXISTING)
    mockApi.listModelProfiles.mockResolvedValue([])
    mockApi.getProviderCapabilities.mockRejectedValue(new Error('none'))
    mockApi.saveModelConfig.mockResolvedValue(EXISTING)
    mockApi.deleteModelConfig.mockResolvedValue(undefined)
  })

  it('shows a load error with retry instead of an empty editor', async () => {
    mockApi.getModelConfig.mockRejectedValueOnce('db locked')
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
    expect(mockApi.deleteModelConfig).not.toHaveBeenCalled()

    mockApi.deleteModelConfig.mockRejectedValueOnce('held by a plan review')
    await user.click(del)
    expect(await screen.findByRole('alert')).toHaveTextContent('held by a plan review')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('refuses an unreadable context window instead of saving a default', async () => {
    const user = userEvent.setup()
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await user.clear(ctx)
    await user.type(ctx, 'abc')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.model.limitInvalidError', { field: i18n.t('settings.model.contextWindow') }),
    )
    expect(mockApi.saveModelConfig).not.toHaveBeenCalled()
  })

  it('leaves the window blank and required when nothing knows it, and says so at save', async () => {
    mockApi.getModelConfig.mockResolvedValue(null as never)
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
    expect(mockApi.saveModelConfig).not.toHaveBeenCalled()
  })

  it('prefills the window from the model’s capabilities when they are known', async () => {
    mockApi.getModelConfig.mockResolvedValue(null as never)
    mockApi.getProviderCapabilities.mockResolvedValue({
      max_context_tokens: 64000,
      max_output_tokens: 8000,
      supported_efforts: [],
      server_tools: [],
    } as never)
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await waitFor(() => expect(ctx).toHaveValue('64000'))
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.compactThreshold') })).toHaveValue(
      String(safeThreshold(64000, 8000)),
    )
    expect(screen.getByLabelText(i18n.t('settings.model.maxOutput'))).toHaveValue('8000')
  })

  it('suggests no threshold when the output ceiling is unknown', async () => {
    mockApi.getModelConfig.mockResolvedValue(null as never)
    mockApi.getProviderCapabilities.mockResolvedValue({
      max_context_tokens: 64000,
      max_output_tokens: null,
      supported_efforts: [],
      server_tools: [],
    } as never)
    renderPage()

    const ctx = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await waitFor(() => expect(ctx).toHaveValue('64000'))
    // A reserve of nothing would be a threshold for a zero-token reply.
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.compactThreshold') })).toHaveValue('')
    expect(screen.getByLabelText(i18n.t('settings.model.maxOutput'))).toHaveValue('')
  })

  it('says it saved', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() => expect(mockApi.saveModelConfig).toHaveBeenCalledTimes(1))
    expect(mockApi.saveModelConfig.mock.calls[0][0].profile.context_window).toBe(200000)
    expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('common.saved'))
  })

  it('parses token counts strictly', () => {
    expect(parseTokenCount(' 4096 ')).toBe(4096)
    expect(parseTokenCount('12k')).toBeUndefined()
    expect(parseTokenCount('0')).toBeUndefined()
    expect(parseTokenCount('')).toBeUndefined()
  })
})
