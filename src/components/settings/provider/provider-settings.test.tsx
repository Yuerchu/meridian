import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSettings } from '.'
import i18n from '@/i18n'
import { api } from '@/api'
import { decimal } from '@/lib/decimal'
import type { DecimalString, ProviderCatalogEntryInfoResponse, ProviderInfoResponse } from '@/types'

vi.mock('@/api', () => ({
  api: {
    listProviders: vi.fn(),
    listProviderCatalog: vi.fn(),
    codexAuthStatus: vi.fn(),
    getProviderKeyExists: vi.fn(),
    createProvider: vi.fn(),
    deleteProvider: vi.fn(),
    updateProvider: vi.fn(),
    fetchProviderModels: vi.fn(),
    listModelConfigs: vi.fn(),
    getModelConfig: vi.fn(),
    listModelProfiles: vi.fn(),
    getProviderCapabilities: vi.fn(),
    saveModelConfig: vi.fn(),
    deleteModelConfig: vi.fn(),
    setProviderKey: vi.fn(),
    getPreference: vi.fn(),
    setPreference: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

function makeProvider(id: string, name: string): ProviderInfoResponse {
  return {
    id,
    name,
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    is_enabled: true,
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
    api_format: 'chat_completions',
    catalog_id: 'openai',
    credential_kind: 'api_key',
    transport_profile: 'standard',
    icon: null,
    codex_request_shape: false,
  }
}

/**
 * Enough of the shipped catalog for the panel to prefill and to decide whether
 * a dialect selector is drawn. Kept in this file rather than read from the real
 * one: these tests are about the panel's behaviour given a catalog, not about
 * what today's catalog happens to contain.
 */
const CATALOG: ProviderCatalogEntryInfoResponse[] = [
  {
    id: 'openai',
    provider_type: 'openai',
    name: 'OpenAI',
    icon: 'openai',
    balance: false,
    websites: { official: null, api_key: null, docs: null, models: null },
    auth: [
      {
        id: 'api_key',
        credential_kind: 'api_key',
        transport_profile: 'standard',
        api_formats: ['chat_completions', 'responses'],
        default_base_url: {
          chat_completions: 'https://api.openai.com/v1',
          responses: 'https://api.openai.com/v1',
        },
      },
      {
        id: 'codex_cli',
        credential_kind: 'codex_cli',
        transport_profile: 'chatgpt_codex',
        api_formats: ['responses'],
        default_base_url: { responses: 'https://chatgpt.com/backend-api/codex' },
      },
    ],
    models: [],
  },
  {
    id: 'google',
    provider_type: 'google',
    name: 'Google Gemini',
    icon: 'google',
    balance: false,
    websites: { official: null, api_key: null, docs: null, models: null },
    auth: [
      {
        id: 'api_key',
        credential_kind: 'api_key',
        transport_profile: 'standard',
        api_formats: ['gemini_generate_content', 'chat_completions'],
        default_base_url: {
          gemini_generate_content: 'https://generativelanguage.googleapis.com',
          chat_completions: 'https://generativelanguage.googleapis.com/v1beta/openai',
        },
      },
    ],
    models: [],
  },
]

/**
 * A configured model, as the backend now answers.
 *
 * The window, the prices and the capability patch belong to the model's
 * profile; `effective_pricing` is what the backend resolved from it, which is
 * what the panel reads rather than re-deciding.
 */
function modelConfig(overrides: {
  id: string
  model_id: string
  input_price?: DecimalString | null
  output_price?: DecimalString | null
  capability_overrides?: Record<string, unknown> | null
  server_tools?: string[] | null
}) {
  const input = overrides.input_price ?? null
  const output = overrides.output_price ?? null
  return {
    id: overrides.id,
    provider_id: 'p1',
    model_id: overrides.model_id,
    profile: {
      id: `${overrides.id}-profile`,
      name: overrides.model_id,
      context_window: 128000,
      compact_threshold: 100000,
      max_output_tokens: null,
      input_price: input,
      output_price: output,
      cache_read_price: null,
      cache_write_price: null,
      pricing_tiers: [],
      capability_overrides: overrides.capability_overrides ?? null,
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
    server_tools: overrides.server_tools ?? null,
    server_tool_price: null,
    effective_pricing: {
      input_price: input,
      output_price: output,
      cache_read_price: null,
      cache_write_price: null,
      pricing_tiers: [],
      server_tool_price: null,
    },
    created_at: 0,
    updated_at: 0,
  } as never
}

/**
 * There is no second column to fill, so nothing opens on its own: every case
 * about the editor says which provider it is about.
 */
async function openFirstProvider(user: ReturnType<typeof userEvent.setup>, name = 'Provider One') {
  await user.click(await screen.findByRole('button', { name }))
}

/**
 * The model list is a table, so a model is a row rather than a button.
 *
 * React Aria labels a row from its row-header cell alone rather than from
 * every cell, so the name is the model's own — and its wire id after it, on a
 * second line, whenever the two differ. Hence a pattern where they do.
 */
async function openModel(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(await screen.findByRole('row', { name }))
}

/**
 * A model nothing describes (capabilities are rejected in these tests) opens
 * with its window blank and required: the form no longer invents 128000, so
 * somebody has to type it — and so do these tests.
 */
function fillLimits() {
  fireEvent.change(screen.getByRole('textbox', { name: i18n.t('settings.model.contextWindow') }), {
    target: { value: '128000' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: i18n.t('settings.model.compactThreshold') }), {
    target: { value: '100000' },
  })
}

describe('ProviderSettings list/detail navigation', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listProviders.mockResolvedValue([makeProvider('p1', 'Provider One'), makeProvider('p2', 'Provider Two')])
    mockApi.listProviderCatalog.mockResolvedValue(CATALOG)
    mockApi.getProviderKeyExists.mockResolvedValue(false)
    mockApi.listModelConfigs.mockResolvedValue([])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([])
    // The page reads the cached list on its own once it has a credential.
    mockApi.fetchProviderModels.mockResolvedValue([])
    mockApi.getProviderCapabilities.mockRejectedValue(new Error('No capabilities in this test'))
    mockApi.getPreference.mockResolvedValue({ key: 'codex.client_version', value: null })
    mockApi.setPreference.mockResolvedValue(undefined)
  })

  it('shows the list first, and opens nothing on its own', async () => {
    render(<ProviderSettings />)
    expect(await screen.findByText('Provider One')).toBeInTheDocument()
    expect(screen.getByText('Provider Two')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('common.back'))).not.toBeInTheDocument()
  })

  it('the first click can open the second provider', async () => {
    const user = userEvent.setup()
    render(<ProviderSettings />)

    await user.click(await screen.findByRole('button', { name: 'Provider Two' }))
    expect(await screen.findByRole('heading', { name: 'Provider Two' })).toBeInTheDocument()
  })

  it('the back button returns from a provider to the list', async () => {
    const user = userEvent.setup()
    render(<ProviderSettings />)

    await user.click(await screen.findByText('Provider One'))
    expect(await screen.findByText(i18n.t('common.back'))).toBeInTheDocument()

    await user.click(screen.getByText(i18n.t('common.back')))
    expect(await screen.findByText('Provider Two')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('common.back'))).not.toBeInTheDocument()
  })

  it('renders providers as one card of rows, icon and name on one line', async () => {
    mockApi.listProviders.mockResolvedValue([
      makeProvider('p1', 'Provider One'),
      { ...makeProvider('p2', 'Provider Two'), catalog_id: null, provider_type: 'google' },
    ])
    const { container } = render(<ProviderSettings />)

    await screen.findByRole('button', { name: 'Provider One' })
    const list = container.querySelector<HTMLElement>('[data-slot="provider-list"]')!
    const rows = list.querySelectorAll<HTMLElement>('[data-slot="settings-link-row"]')
    expect(rows).toHaveLength(2)
    // What the stack's focus return finds the row by.
    expect(rows[0]).toHaveAttribute('data-key', 'p1')
    // Named by the provider alone; where it points is a description.
    expect(rows[1]).toHaveAccessibleName('Provider Two')
    // The icon sits beside the name in the row, not stacked above it.
    const icon = rows[0].querySelector('[data-slot="settings-link-row-icon"]')!
    expect(icon.nextElementSibling).toHaveAttribute('data-slot', 'settings-link-row-text')
    // Adding is the card's last row.
    expect(list.lastElementChild).toHaveAttribute('data-slot', 'settings-add-row')
    expect(within(list).getByRole('button', { name: i18n.t('settings.provider.addProvider') })).toBeInTheDocument()

    await waitFor(() => {
      const icons = list.querySelectorAll('[data-slot="model-icon"]')
      expect(icons).toHaveLength(2)
      expect(icons[0]).toHaveAttribute('data-model', 'openai')
      expect(icons[1]).toHaveAttribute('data-model', 'google')
    })
  })

  // Creating a provider names the vendor to the backend rather than leaving it
  // to be guessed from the address. Inference cannot survive the user pointing
  // the row at a relay afterwards, and the identity is what decides the logo and
  // the key-issuing link.
  it('creating a provider prefills from the catalog and states which vendor it is', async () => {
    const user = userEvent.setup()
    mockApi.createProvider.mockResolvedValue(makeProvider('p3', 'OpenAI'))
    render(<ProviderSettings />)
    await screen.findByText('Provider One')
    await user.click(screen.getByRole('button', { name: i18n.t('settings.provider.addProvider') }))
    expect(mockApi.createProvider).toHaveBeenCalledWith({
      name: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiFormat: 'chat_completions',
      catalogId: 'openai',
      authOption: 'api_key',
    })
  })

  // A single dialect means there is nothing to choose. This used to be the
  // `SINGLE_FORMAT_TYPES` denylist; it is now read off the entry, so a vendor
  // added to the catalog gets the right answer without a code change.
  it('hides the dialect selector for a vendor that offers one', async () => {
    const user = userEvent.setup()
    mockApi.listProviderCatalog.mockResolvedValue([
      {
        ...CATALOG[0],
        id: 'single',
        provider_type: 'openai',
        auth: [{ ...CATALOG[0].auth[0], api_formats: ['chat_completions'] }],
      },
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))
    expect(screen.queryByText(i18n.t('settings.provider.apiFormat'))).not.toBeInTheDocument()
  })

  // A sign-in with no key must not be shown a key field: there is nothing to
  // type, and an empty one reads as a step left undone. What replaces it is the
  // account the session belongs to.
  it('a ChatGPT login is shown its account instead of a key field', async () => {
    const user = userEvent.setup()
    mockApi.listProviders.mockResolvedValue([
      { ...makeProvider('codex-1', 'Codex'), credential_kind: 'codex_cli', transport_profile: 'chatgpt_codex' },
    ])
    mockApi.codexAuthStatus.mockResolvedValue({
      logged_in: true,
      email: 'someone@example.com',
      plan: 'pro',
      storage: 'file',
      codex_home: '/home/someone/.codex',
      problem: null,
    })
    render(<ProviderSettings />)
    await openFirstProvider(user, 'Codex')

    expect(await screen.findByText('someone@example.com')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
    // Where we looked, which is the only way to explain "logged in at the
    // terminal but not here" when a GUI process has a different environment.
    expect(screen.getByText(/\.codex/)).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('settings.provider.apiKey'))).not.toBeInTheDocument()
  })

  // The backend exempts a ChatGPT login from needing a stored key for this
  // exact call, and the button used to gate on the key anyway — permanently
  // grey on the one kind of row the exemption exists for, with the model list
  // unreachable from the UI.
  it('a ChatGPT login can fetch its model list without a stored key', async () => {
    const user = userEvent.setup()
    mockApi.listProviders.mockResolvedValue([
      { ...makeProvider('codex-1', 'Codex'), credential_kind: 'codex_cli', transport_profile: 'chatgpt_codex' },
    ])
    mockApi.getProviderKeyExists.mockResolvedValue(false)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'gpt-5.6', name: 'gpt-5.6' }])
    render(<ProviderSettings />)
    await openFirstProvider(user, 'Codex')
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))

    const fetchButton = screen.getByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) })
    expect(fetchButton).not.toBeDisabled()
    await user.click(fetchButton)
    expect(mockApi.fetchProviderModels).toHaveBeenCalledWith({ providerId: 'codex-1', forceRefresh: true })
  })

  it('renders fetched models as rows saying where each one stands', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([
      { id: 'gpt-5.6', name: 'gpt-5.6' },
      { id: 'gpt-5.6-mini', name: 'gpt-5.6-mini' },
      { id: 'gpt-unconfigured', name: 'gpt-unconfigured' },
    ])
    mockApi.listModelConfigs.mockResolvedValue([
      modelConfig({ id: 'config-1', model_id: 'gpt-5.6', input_price: decimal('1.25'), output_price: decimal('10') }),
      modelConfig({ id: 'config-2', model_id: 'gpt-5.6-mini', input_price: decimal('0'), output_price: decimal('0') }),
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))

    // Every model this provider answered with, each saying where it stands.
    const priced = await screen.findByRole('row', { name: 'gpt-5.6' })
    // An explicit zero is a free model, which is a price: both configured rows
    // are priced, and only the unconfigured one says otherwise.
    expect(screen.getAllByText(i18n.t('settings.provider.modelPriced'))).toHaveLength(2)
    expect(screen.queryByText(i18n.t('settings.provider.modelPriceMissing'))).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.provider.modelNotConfigured'))).toBeInTheDocument()

    // The window and the two base rates are the reason this is a table rather
    // than a list of names: comparing four relays selling one model is what
    // the page is for, and a row saying only "Priced" makes that a tour of
    // four pages. The rates are the effective ones, so a model priced by its
    // shared description still shows figures.
    expect(priced).toHaveTextContent('128K')
    expect(priced).toHaveTextContent('1.25')
    expect(priced).toHaveTextContent('10.00')

    // An explicit zero is a free model and a null is a price nobody has set;
    // neither the chip nor the columns may collapse the two. Reading the first
    // as the second is how a free model looks unconfigured.
    expect(screen.getByRole('row', { name: 'gpt-5.6-mini' })).toHaveTextContent('0.00')
    expect(screen.getByRole('row', { name: 'gpt-unconfigured' })).toHaveTextContent(
      i18n.t('settings.provider.modelNoValue'),
    )
  })

  /**
   * A model configured here but absent from what the provider announced.
   *
   * `cached_models` and `model_configs` have deliberately never been joined,
   * and reading only the first is what made a preview model impossible to
   * configure at all: it is not in `/v1/models`, so it never appeared in a
   * list, so it could never be given a window or a price.
   */
  it('lists a configured model the provider did not announce', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'gpt-5.6', name: 'gpt-5.6' }])
    mockApi.listModelConfigs.mockResolvedValue([
      modelConfig({ id: 'config-1', model_id: 'gpt-5.6', input_price: decimal('1'), output_price: decimal('2') }),
      modelConfig({ id: 'config-preview', model_id: 'gpt-6-preview' }),
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))

    expect(await screen.findByRole('row', { name: /gpt-6-preview/ })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.provider.modelNotListed'))).toBeInTheDocument()
  })

  it('opens a model on its own page, and the back button returns to the provider', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'gpt-5.6', name: 'gpt-5.6' }])
    mockApi.getModelConfig.mockResolvedValue(
      modelConfig({ id: 'config-1', model_id: 'gpt-5.6', input_price: decimal('1'), output_price: decimal('2') }),
    )
    mockApi.listModelProfiles.mockResolvedValue([])
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))

    await openModel(user, 'gpt-5.6')
    expect(await screen.findByRole('heading', { name: 'gpt-5.6' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.contextWindow') })).toHaveValue('128000')

    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(await screen.findByRole('heading', { name: 'Provider One' })).toBeInTheDocument()
  })

  /**
   * A page returned to shows what is true now, not what was true when it was
   * covered.
   *
   * The stack keeps every level mounted, so the list behind a provider page is
   * the same React tree it was before — its mount effect will not run again,
   * and nothing else was ever going to tell it. Deleting a provider therefore
   * used to unwind onto a list still showing the row that no longer exists,
   * and pressing it opened a page for a deleted id.
   */
  it('drops a deleted provider from the list it unwinds onto', async () => {
    const user = userEvent.setup()
    mockApi.deleteProvider.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)
    expect(await screen.findByRole('heading', { name: 'Provider One' })).toBeInTheDocument()

    // What the list will answer with once the delete has happened.
    mockApi.listProviders.mockResolvedValue([makeProvider('p2', 'Provider Two')])
    await user.click(screen.getByRole('button', { name: i18n.t('settings.provider.deleteProvider') }))
    await user.click(await screen.findByRole('button', { name: i18n.t('common.confirm') }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Provider One' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Provider Two' })).toBeInTheDocument()
  })

  /**
   * The same rule one level down: a model given a price for the first time
   * changes a chip on the page underneath, which has been mounted throughout.
   */
  it('refreshes the model table when a model page is left', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'gpt-5.6', name: 'gpt-5.6' }])
    mockApi.listModelConfigs.mockResolvedValue([])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([])
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    expect(await screen.findByText(i18n.t('settings.provider.modelNotConfigured'))).toBeInTheDocument()

    await openModel(user, 'gpt-5.6')
    const input = await screen.findByRole('textbox', { name: i18n.t('settings.model.inputPrice') })
    fireEvent.change(input, { target: { value: '1.25' } })
    fireEvent.change(screen.getByRole('textbox', { name: i18n.t('settings.model.outputPrice') }), {
      target: { value: '10' },
    })
    // What the provider page will read once the save has landed.
    mockApi.listModelConfigs.mockResolvedValue([
      modelConfig({ id: 'config-1', model_id: 'gpt-5.6', input_price: decimal('1.25'), output_price: decimal('10') }),
    ])
    fillLimits()
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() => expect(mockApi.saveModelConfig).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(await screen.findByText(i18n.t('settings.provider.modelPriced'))).toBeInTheDocument()
  })

  /**
   * Pointing at a description must not quietly strip its capability patch.
   *
   * `buildOverrides` starts from the chosen description's own map and then
   * *deletes* every key the form reports as `auto`. The form is seeded from
   * the description the page opened on, so without replaying that seeding at
   * the moment of the switch, choosing a description with
   * `{supports_thinking: false}` saves it back with the key gone — and three
   * other providers reading it silently start offering reasoning again.
   *
   * The failure is invisible from this page: the save succeeds, the window and
   * the prices are visibly correct, and nothing on screen ever mentioned the
   * capability the switch erased.
   */
  it('replays the capability patch of the description it is pointed at', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'relayed', name: 'relayed' }])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.getProviderCapabilities.mockResolvedValue({
      supports_tools: true,
      supports_streaming_tools: true,
      supports_thinking: true,
      supports_thinking_off: true,
      supports_images: false,
      max_context_tokens: 128000,
      max_output_tokens: 32000,
      supports_pdf: false,
      supports_temperature: true,
      supports_top_p: true,
      max_temperature: 2,
      thinking_style: 'effort_only',
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
      supports_fast: false,
      supports_verbosity: false,
      default_verbosity: null,
      server_tools: [],
    })
    mockApi.listModelProfiles.mockResolvedValue([
      {
        id: 'prof-quiet',
        name: 'Quiet model',
        context_window: 200000,
        compact_threshold: 150000,
        max_output_tokens: 64000,
        input_price: decimal('3'),
        output_price: decimal('15'),
        cache_read_price: null,
        cache_write_price: null,
        pricing_tiers: [],
        capability_overrides: { supports_thinking: false, supported_efforts: ['low'] },
        model_count: 3,
        created_at: 0,
        updated_at: 0,
      },
    ])
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, 'relayed')

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.model.useProfile')) }))
    await user.click(await screen.findByRole('option', { name: 'Quiet model' }))
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() =>
      expect(mockApi.saveModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            id: 'prof-quiet',
            capability_overrides: { supports_thinking: false, supported_efforts: ['low'] },
          }),
        }),
      ),
    )
  })

  /**
   * The point of the whole split: a second provider reaching the same model
   * points at the description that already exists instead of typing the window
   * and the prices again.
   *
   * Choosing one replaces the form with that profile's values. Keeping what was
   * typed would save the old numbers onto the chosen description and silently
   * rewrite what every other provider reading it sees.
   */
  it('points a model at an existing description, and takes its values', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'claude-sonnet-5@vertex', name: 'claude-sonnet-5@vertex' }])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([
      {
        id: 'prof-sonnet',
        name: 'Claude Sonnet 5',
        context_window: 200000,
        compact_threshold: 150000,
        max_output_tokens: 64000,
        input_price: decimal('3'),
        output_price: decimal('15'),
        cache_read_price: null,
        cache_write_price: null,
        pricing_tiers: [],
        capability_overrides: null,
        model_count: 2,
        created_at: 0,
        updated_at: 0,
      },
    ])
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, 'claude-sonnet-5@vertex')

    // React Aria names a select trigger from its label *and* its current
    // value, so the match is on the label rather than equal to it.
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.model.useProfile')) }))
    await user.click(await screen.findByRole('option', { name: 'Claude Sonnet 5' }))

    // The window came from the description rather than from the catalog.
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.contextWindow') })).toHaveValue('200000')
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.inputPrice') })).toHaveValue('3')
    // And it says how far an edit here reaches.
    expect(screen.getByText(i18n.t('settings.model.sharedBy', { count: 2 }))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.saveModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          model_id: 'claude-sonnet-5@vertex',
          profile: expect.objectContaining({ id: 'prof-sonnet', name: 'Claude Sonnet 5', context_window: 200000 }),
        }),
      ),
    )
  })

  /**
   * A relay that resells at its own margin is the one case a provider's rates
   * differ from the model's. With the switch off the columns stay null — the
   * backend refuses a row carrying rates it has switched off, because a number
   * kept in two places is a number that comes to disagree.
   */
  it('sends this provider own rates only while the override is on', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'relayed', name: 'relayed' }])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([])
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, 'relayed')

    // Off: the four fields are not even on screen.
    expect(screen.queryByRole('textbox', { name: i18n.t('settings.model.inputPrice') })).toBeInTheDocument()
    await user.click(await screen.findByRole('switch', { name: i18n.t('settings.model.overridePricing') }))

    const overrideFields = screen.getAllByRole('textbox', { name: i18n.t('settings.model.inputPrice') })
    expect(overrideFields).toHaveLength(2)
    await user.type(overrideFields[1], '9')
    const outputs = screen.getAllByRole('textbox', { name: i18n.t('settings.model.outputPrice') })
    await user.type(outputs[1], '18')

    fillLimits()
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.saveModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({ overrides_pricing: true, input_price: '9', output_price: '18' }),
      ),
    )
  })

  /**
   * A relay that charges its own rates may also have its own long-context
   * threshold, and overriding takes the whole rate set rather than filling
   * blanks in from the description. The editor sent `pricing_tiers: []`
   * unconditionally, so those rates were dropped on every save with no way to
   * enter them — the backend and the DTO had supported them all along.
   */
  it('sends this provider own long-context tiers when the override is on', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'relayed', name: 'relayed' }])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([])
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, 'relayed')

    await user.click(await screen.findByRole('switch', { name: i18n.t('settings.model.overridePricing') }))
    const inputs = screen.getAllByRole('textbox', { name: i18n.t('settings.model.inputPrice') })
    fireEvent.change(inputs[1], { target: { value: '9' } })
    fireEvent.change(screen.getAllByRole('textbox', { name: i18n.t('settings.model.outputPrice') })[1], {
      target: { value: '18' },
    })

    // The override section has its own tier table; the profile's is a separate
    // disclosure above it, which is why both are addressed by index.
    const tierSections = screen.getAllByRole('button', { name: i18n.t('settings.model.priceTiers') })
    await user.click(tierSections[tierSections.length - 1])
    const addButtons = await screen.findAllByRole('button', { name: i18n.t('settings.model.addTier') })
    await user.click(addButtons[addButtons.length - 1])
    fireEvent.change(screen.getByRole('textbox', { name: i18n.t('settings.model.tierThreshold') }), {
      target: { value: '200000' },
    })
    const tierInputs = screen.getAllByRole('textbox', { name: i18n.t('settings.model.inputPrice') })
    fireEvent.change(tierInputs[tierInputs.length - 1], { target: { value: '18' } })
    const tierOutputs = screen.getAllByRole('textbox', { name: i18n.t('settings.model.outputPrice') })
    fireEvent.change(tierOutputs[tierOutputs.length - 1], { target: { value: '36' } })

    fillLimits()
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.saveModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides_pricing: true,
          pricing_tiers: [
            expect.objectContaining({ min_prompt_tokens: 200000, input_price: '18', output_price: '36' }),
          ],
        }),
      ),
    )
  })

  /**
   * The backend has always allowed configuring a model `/v1/models` does not
   * list; nothing offered it. Nothing is written when the sheet is confirmed
   * either — an empty configuration would put a model in the list that no turn
   * could run, so the id goes straight to the page where it is given a window
   * and a price.
   */
  it('takes a model the provider never announced straight to its page', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([])
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: i18n.t('settings.provider.addModel') }))
    await user.type(await screen.findByRole('textbox', { name: i18n.t('settings.provider.modelId') }), 'gpt-6-preview')
    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))

    expect(await screen.findByRole('heading', { name: 'gpt-6-preview' })).toBeInTheDocument()
    expect(mockApi.saveModelConfig).not.toHaveBeenCalled()
  })

  /**
   * A row reaching Claude through Vertex, or any relay, names no vendor the
   * catalog knows, so its mark was a generic cloud with no way to say
   * otherwise. Picking one writes a name; picking the default entry writes
   * `null`.
   *
   * The second half is the one worth a test. `null` and "key absent" mean
   * different things to the backend — put it back to the vendor's mark, versus
   * leave the logo alone — so a save that sent `undefined` for the default
   * entry would report success and change nothing, and the picker would go on
   * showing the default as selected while the row kept the old mark.
   */
  it('writes a chosen logo, and writes null to go back to the vendor', async () => {
    const user = userEvent.setup()
    mockApi.updateProvider.mockResolvedValue(makeProvider('p1', 'Provider One'))
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.icon')) }))
    await user.click(await screen.findByRole('option', { name: 'vertexai' }))
    // The chosen name has to reach the mark, not just the request: a row that
    // saves correctly and goes on drawing the old logo is the visible half of
    // this feature failing.
    expect(document.querySelector('[data-slot="provider-icon"][data-provider="vertexai"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ icon: 'vertexai' })),
    )

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.icon')) }))
    await user.click(await screen.findByRole('option', { name: i18n.t('settings.provider.iconDefault') }))
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.updateProvider).toHaveBeenLastCalledWith(expect.objectContaining({ icon: null })),
    )
  })

  /** A page with unsaved work does not go quietly. */
  it('asks before the back button discards a model draft', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'gpt-5.6', name: 'gpt-5.6' }])
    mockApi.getModelConfig.mockResolvedValue(null)
    mockApi.listModelProfiles.mockResolvedValue([])
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, 'gpt-5.6')

    const contextWindow = await screen.findByRole('textbox', { name: i18n.t('settings.model.contextWindow') })
    await user.clear(contextWindow)
    await user.type(contextWindow, '42')

    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    const discard = await screen.findByRole('alertdialog', { name: i18n.t('confirm.title') })
    await user.click(within(discard).getByRole('button', { name: i18n.t('common.cancel') }))
    expect(screen.getByRole('textbox', { name: i18n.t('settings.model.contextWindow') })).toHaveValue('42')

    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: i18n.t('common.confirm') }),
    )
    expect(await screen.findByRole('heading', { name: 'Provider One' })).toBeInTheDocument()
  })

  it('sends canonical decimal strings and typed price tiers to IPC', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'priced-model', name: 'Priced model' }])
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, /^Priced model/)

    const inputPrice = screen.getByRole('textbox', { name: i18n.t('settings.model.inputPrice') })
    const outputPrice = screen.getByRole('textbox', { name: i18n.t('settings.model.outputPrice') })
    const cachePrice = screen.getByRole('textbox', { name: i18n.t('settings.model.cachePrice') })
    fireEvent.change(inputPrice, { target: { value: '0001.2300' } })
    fireEvent.change(outputPrice, { target: { value: '2.5000' } })
    fireEvent.change(cachePrice, { target: { value: '0.1250' } })

    await user.click(screen.getByRole('button', { name: i18n.t('settings.model.priceTiers') }))
    await user.click(await screen.findByRole('button', { name: i18n.t('settings.model.addTier') }))
    const tierThreshold = screen.getByRole('textbox', { name: i18n.t('settings.model.tierThreshold') })
    const tierInput = screen.getAllByRole('textbox', { name: i18n.t('settings.model.inputPrice') })[1]
    const tierOutput = screen.getAllByRole('textbox', { name: i18n.t('settings.model.outputPrice') })[1]
    fireEvent.change(tierThreshold, { target: { value: '200000' } })
    fireEvent.change(tierInput, { target: { value: '04.2500' } })
    fireEvent.change(tierOutput, { target: { value: '12.500' } })

    fillLimits()
    await user.click(await screen.findByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() =>
      expect(mockApi.saveModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_id: 'p1',
          model_id: 'priced-model',
          overrides_pricing: false,
          server_tool_price: null,
          profile: expect.objectContaining({
            input_price: '1.23',
            output_price: '2.5',
            cache_read_price: '0.125',
            cache_write_price: null,
            pricing_tiers: [
              {
                min_prompt_tokens: 200000,
                input_price: '4.25',
                output_price: '12.5',
                cache_read_price: null,
                cache_write_price: null,
              },
            ],
          }),
        }),
      ),
    )
  })

  it('keeps model capability overrides and server tools structured across IPC', async () => {
    const user = userEvent.setup()
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'structured-model', name: 'Structured model' }])
    const structured = modelConfig({
      id: 'structured-config',
      model_id: 'structured-model',
      capability_overrides: { supports_thinking: false, default_effort: null },
      server_tools: ['web_search'],
    })
    mockApi.listModelConfigs.mockResolvedValue([structured])
    // The model page reads its own row by id rather than taking it off the
    // provider's list.
    mockApi.getModelConfig.mockResolvedValue(structured)
    mockApi.getProviderCapabilities.mockResolvedValue({
      supports_tools: true,
      supports_streaming_tools: true,
      supports_thinking: true,
      supports_thinking_off: true,
      supports_images: false,
      max_context_tokens: 128000,
      max_output_tokens: 32000,
      supports_pdf: false,
      supports_temperature: true,
      supports_top_p: true,
      max_temperature: 2,
      thinking_style: 'effort_only',
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
      supports_fast: false,
      supports_verbosity: false,
      default_verbosity: null,
      server_tools: ['web_search'],
    })
    mockApi.saveModelConfig.mockResolvedValue(undefined as never)
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.fetchModels')) }))
    await openModel(user, /^Structured model/)
    await user.click(await screen.findByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.saveModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          server_tools: ['web_search'],
          profile: expect.objectContaining({
            capability_overrides: { supports_thinking: false, default_effort: null },
          }),
        }),
      ),
    )
  })

  // The balance button belongs to the *vendor*, and the type can no longer
  // answer for it: Moonshot, SiliconFlow and OpenAI are all `openai`, so a
  // lookup by type returns whichever the catalog lists first and draws the
  // button on all three or on none. Both directions are asserted here because
  // each is a different failure — a button that always errors, and a working
  // upstream with no way to ask.
  it('the balance button follows the row’s vendor rather than its adapter family', async () => {
    const user = userEvent.setup()
    const catalog: ProviderCatalogEntryInfoResponse[] = [
      { ...CATALOG[0], id: 'openai', name: 'OpenAI', balance: false },
      { ...CATALOG[0], id: 'moonshot', name: 'Moonshot (Kimi)', balance: true },
    ]
    mockApi.listProviderCatalog.mockResolvedValue(catalog)
    mockApi.listProviders.mockResolvedValue([
      { ...makeProvider('kimi-1', 'Kimi'), catalog_id: 'moonshot', base_url: 'https://api.moonshot.cn/v1' },
    ])
    const { unmount } = render(<ProviderSettings />)
    await openFirstProvider(user, 'Kimi')
    expect(await screen.findByText(i18n.t('settings.provider.balance'))).toBeInTheDocument()
    unmount()

    // Same type, same catalog, different vendor.
    mockApi.listProviders.mockResolvedValue([{ ...makeProvider('oa-1', 'OpenAI'), catalog_id: 'openai' }])
    render(<ProviderSettings />)
    await openFirstProvider(user, 'OpenAI')
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))
    expect(screen.queryByText(i18n.t('settings.provider.balance'))).not.toBeInTheDocument()
  })

  // A row with no `catalog_id` is a relay as far as the panel is concerned:
  // nothing here knows whose it is, so offering an account lookup would mean
  // posting the key to an endpoint its operator never published.
  it('an unidentified row is offered no balance button', async () => {
    const user = userEvent.setup()
    mockApi.listProviderCatalog.mockResolvedValue([{ ...CATALOG[0], id: 'moonshot', balance: true }])
    mockApi.listProviders.mockResolvedValue([
      { ...makeProvider('relay-1', 'Relay'), catalog_id: null, base_url: 'https://relay.example/v1' },
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user, 'Relay')
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))
    expect(screen.queryByText(i18n.t('settings.provider.balance'))).not.toBeInTheDocument()
  })

  /** An API-key provider keeps the field it has always had. */
  it('an API-key provider still gets a key field', async () => {
    const user = userEvent.setup()
    render(<ProviderSettings />)
    await openFirstProvider(user)
    expect(await screen.findByText(i18n.t('settings.provider.apiKey'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('settings.provider.codexAccount'))).not.toBeInTheDocument()
  })

  // The one control that writes `credential_kind`. Without it the catalog's
  // second sign-in option — the whole ChatGPT-login feature — was reachable
  // only by editing the database by hand: `create_provider` always took the
  // entry's default, and nothing on the panel could change it afterwards.
  it('a vendor with two sign-ins gets a selector, and choosing one writes the row', async () => {
    const user = userEvent.setup()
    mockApi.listProviderCatalog.mockResolvedValue([
      {
        ...CATALOG[0],
        auth: [
          CATALOG[0].auth[0],
          {
            id: 'codex_cli',
            credential_kind: 'codex_cli',
            transport_profile: 'chatgpt_codex',
            api_formats: ['responses'],
            default_base_url: { responses: 'https://chatgpt.com/backend-api/codex' },
          },
        ],
      },
    ])
    mockApi.updateProvider.mockResolvedValue(makeProvider('p1', 'Provider One'))
    render(<ProviderSettings />)
    await openFirstProvider(user)
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))

    // A vendor with one way in never shows this — asserted by the tests above
    // never finding it. Here it exists and carries both options.
    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('settings.provider.authMethod')) }))
    await user.click(await screen.findByRole('option', { name: i18n.t('settings.provider.authMethodCodexCli') }))

    expect(mockApi.updateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p1',
        credentialKind: 'codex_cli',
        transportProfile: 'chatgpt_codex',
        apiFormat: 'responses',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
      }),
    )
  })

  it('shows the native GenerateContent protocol for Google connections', async () => {
    const user = userEvent.setup()
    mockApi.listProviders.mockResolvedValue([
      {
        ...makeProvider('google-1', 'Gemini Relay'),
        provider_type: 'google',
        base_url: 'https://relay.example',
        api_format: 'gemini_generate_content',
      },
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user, 'Gemini Relay')
    expect(await screen.findAllByText(i18n.t('settings.provider.apiFormatGeminiGenerateContent'))).not.toHaveLength(0)
    expect(screen.getByText(i18n.t('settings.provider.apiFormatGeminiGenerateContentHint'))).toBeInTheDocument()
    // The placeholder is the vendor's real address for the dialect in use.
    // Google used to be the one vendor shown a generic `api.example.com`
    // instead, while every other type showed its real default — an
    // inconsistency that came from Google having its own placeholder table.
    // Reading both out of the catalog removes the special case, and the real
    // address carries strictly more of what the hint was for: whether this
    // dialect wants a path suffix.
    expect(screen.getByPlaceholderText('https://generativelanguage.googleapis.com')).toBeInTheDocument()
  })

  /**
   * The Codex shape is offered to the one kind of row it can mean anything
   * for: an API-key `responses` provider, which is what a reverse-proxied
   * Codex backend is configured as. A chat-completions row has no such shape
   * to follow, and showing a switch that changes nothing is worse than
   * showing none.
   */
  it('offers the Codex request shape only to a Responses row', async () => {
    const user = userEvent.setup()
    mockApi.listProviders.mockResolvedValue([
      { ...makeProvider('p1', 'Chat Row'), api_format: 'chat_completions' },
      { ...makeProvider('p2', 'Responses Row'), api_format: 'responses' },
    ])
    render(<ProviderSettings />)

    await openFirstProvider(user, 'Chat Row')
    expect(screen.queryByLabelText(i18n.t('settings.provider.codexRequestShape'))).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))

    await openFirstProvider(user, 'Responses Row')
    const shape = await screen.findByLabelText(i18n.t('settings.provider.codexRequestShape'))
    expect(shape).not.toBeChecked()
    // The version override only appears once something is claiming one.
    expect(screen.queryByLabelText(i18n.t('settings.provider.codexClientVersion'))).not.toBeInTheDocument()
    await user.click(shape)
    expect(await screen.findByLabelText(i18n.t('settings.provider.codexClientVersion'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.updateProvider).toHaveBeenLastCalledWith(expect.objectContaining({ codexRequestShape: true })),
    )
    // Blank means "the version this build shipped with", which is the row
    // being absent rather than a version of `""`.
    expect(mockApi.setPreference).toHaveBeenLastCalledWith({ key: 'codex.client_version', value: null })
  })
})

describe('ProviderPage failure paths and cached models', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listProviders.mockResolvedValue([makeProvider('p1', 'Provider One')])
    mockApi.listProviderCatalog.mockResolvedValue(CATALOG)
    mockApi.getProviderKeyExists.mockResolvedValue(true)
    mockApi.listModelConfigs.mockResolvedValue([])
    mockApi.fetchProviderModels.mockResolvedValue([])
    mockApi.getPreference.mockResolvedValue({ key: 'codex.client_version', value: null })
    mockApi.setPreference.mockResolvedValue(undefined)
  })

  it('reads the cached model list on open instead of calling every model unlisted', async () => {
    const user = userEvent.setup()
    mockApi.fetchProviderModels.mockResolvedValue([{ id: 'gpt-5.6', name: 'gpt-5.6' }])
    mockApi.listModelConfigs.mockResolvedValue([
      modelConfig({ id: 'config-1', model_id: 'gpt-5.6', input_price: decimal('1'), output_price: decimal('2') }),
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user)

    expect(await screen.findByRole('row', { name: 'gpt-5.6' })).toBeInTheDocument()
    expect(mockApi.fetchProviderModels).toHaveBeenCalledWith({ providerId: 'p1', forceRefresh: false })
    expect(screen.queryByText(i18n.t('settings.provider.modelNotListed'))).not.toBeInTheDocument()
  })

  it('keeps the filter box when nothing matches, and says so', async () => {
    const user = userEvent.setup()
    mockApi.fetchProviderModels.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `model-${i}`, name: `model-${i}` })),
    )
    render(<ProviderSettings />)
    await openFirstProvider(user)

    const filter = await screen.findByRole('textbox', { name: i18n.t('settings.provider.filterModels') })
    await user.type(filter, 'zzz')
    expect(screen.getByRole('textbox', { name: i18n.t('settings.provider.filterModels') })).toHaveValue('zzz')
    expect(screen.getByText(i18n.t('settings.provider.filterNoMatch'))).toBeInTheDocument()
  })

  it('reports a refused save instead of doing nothing', async () => {
    const user = userEvent.setup()
    mockApi.updateProvider.mockRejectedValueOnce('name taken')
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: i18n.t('common.save') }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('settings.provider.saveError'))
    expect(alert).toHaveTextContent('name taken')
    expect(screen.queryByText(i18n.t('common.saved'))).not.toBeInTheDocument()
  })

  it('reports a failed delete and stays on the page', async () => {
    const user = userEvent.setup()
    mockApi.deleteProvider.mockRejectedValueOnce('in use')
    render(<ProviderSettings />)
    await openFirstProvider(user)

    await user.click(await screen.findByRole('button', { name: i18n.t('settings.provider.deleteProvider') }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: i18n.t('common.confirm') }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('in use')
    expect(screen.getByRole('heading', { name: 'Provider One' })).toBeInTheDocument()
  })

  it('counts an edited Codex client version as unsaved work', async () => {
    const user = userEvent.setup()
    mockApi.listProviders.mockResolvedValue([
      { ...makeProvider('p1', 'Responses Row'), api_format: 'responses', codex_request_shape: true },
    ])
    render(<ProviderSettings />)
    await openFirstProvider(user, 'Responses Row')

    await user.type(await screen.findByLabelText(i18n.t('settings.provider.codexClientVersion')), '0.99.0')
    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(await screen.findByRole('alertdialog', { name: i18n.t('confirm.title') })).toBeInTheDocument()
  })

  it('does not count a typed key as unsaved work on the provider form', async () => {
    const user = userEvent.setup()
    mockApi.setProviderKey.mockResolvedValue(undefined)
    render(<ProviderSettings />)
    await openFirstProvider(user)

    const key = await screen.findByLabelText(i18n.t('settings.provider.apiKey'))
    await user.type(key, 'sk-test')
    // The form's own Save writes the row and never the key: it may not report
    // the key as saved, and leaving still asks because the key is its own draft.
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() => expect(mockApi.updateProvider).toHaveBeenCalledTimes(1))
    expect(mockApi.setProviderKey).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(await screen.findByRole('alertdialog', { name: i18n.t('confirm.title') })).toBeInTheDocument()
  })
})
