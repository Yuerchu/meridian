import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSettings } from './provider-settings'
import i18n from '@/i18n'
import { api } from '@/api'
import type { Provider, ProviderCatalogEntry } from '@/types'
import { resizeViewportTo } from '@/test/viewport'
import { setContainerWidth } from '@/test/resize'

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
    setProviderKey: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

function makeProvider(id: string, name: string): Provider {
  return {
    id,
    name,
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    is_enabled: 1,
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
    api_format: 'chat_completions',
    catalog_id: 'openai',
    credential_kind: 'api_key',
    transport_profile: 'standard',
  }
}

/**
 * Enough of the shipped catalog for the panel to prefill and to decide whether
 * a dialect selector is drawn. Kept in this file rather than read from the real
 * one: these tests are about the panel's behaviour given a catalog, not about
 * what today's catalog happens to contain.
 */
const CATALOG: ProviderCatalogEntry[] = [
  {
    id: 'openai',
    provider_type: 'openai',
    name: 'OpenAI',
    icon: 'openai',
    balance: false,
    websites: {},
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
    ],
    models: [],
  },
  {
    id: 'google',
    provider_type: 'google',
    name: 'Google Gemini',
    icon: 'google',
    balance: false,
    websites: {},
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
 * jsdom lays nothing out, so the pane measures zero and `useIsNarrow` answers
 * from the viewport — which is what makes the viewport-driven cases below still
 * mean what they always did. The last one drives the pane itself.
 */
function mockViewport(mobile: boolean) {
  resizeViewportTo(mobile ? 500 : 1024)
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
  })

  it('mobile: shows the list first without auto-selecting a provider', async () => {
    mockViewport(true)
    render(<ProviderSettings />)
    expect(await screen.findByText('Provider One')).toBeInTheDocument()
    expect(screen.getByText('Provider Two')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('common.back'))).not.toBeInTheDocument()
  })

  it('mobile: back button returns from detail to the list', async () => {
    mockViewport(true)
    const user = userEvent.setup()
    render(<ProviderSettings />)

    await user.click(await screen.findByText('Provider One'))
    expect(await screen.findByText(i18n.t('common.back'))).toBeInTheDocument()

    await user.click(screen.getByText(i18n.t('common.back')))
    expect(await screen.findByText('Provider Two')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('common.back'))).not.toBeInTheDocument()
  })

  it('desktop: auto-selects the first provider', async () => {
    mockViewport(false)
    render(<ProviderSettings />)
    expect(await screen.findByText(i18n.t('settings.provider.deleteProvider'))).toBeInTheDocument()
  })

  // Creating a provider names the vendor to the backend rather than leaving it
  // to be guessed from the address. Inference cannot survive the user pointing
  // the row at a relay afterwards, and the identity is what decides the logo and
  // the key-issuing link.
  it('creating a provider prefills from the catalog and states which vendor it is', async () => {
    mockViewport(false)
    const user = userEvent.setup()
    mockApi.createProvider.mockResolvedValue(makeProvider('p3', 'OpenAI'))
    render(<ProviderSettings />)
    await screen.findByText('Provider One')
    await user.click(screen.getByRole('button', { name: i18n.t('settings.provider.addProvider') }))
    expect(mockApi.createProvider).toHaveBeenCalledWith(
      'OpenAI',
      'openai',
      'https://api.openai.com/v1',
      'chat_completions',
      'openai',
      'api_key',
    )
  })

  // A single dialect means there is nothing to choose. This used to be the
  // `SINGLE_FORMAT_TYPES` denylist; it is now read off the entry, so a vendor
  // added to the catalog gets the right answer without a code change.
  it('hides the dialect selector for a vendor that offers one', async () => {
    mockViewport(false)
    mockApi.listProviderCatalog.mockResolvedValue([
      {
        ...CATALOG[0],
        id: 'single',
        provider_type: 'openai',
        auth: [{ ...CATALOG[0].auth[0], api_formats: ['chat_completions'] }],
      },
    ])
    render(<ProviderSettings />)
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))
    expect(screen.queryByText(i18n.t('settings.provider.apiFormat'))).not.toBeInTheDocument()
  })

  // A sign-in with no key must not be shown a key field: there is nothing to
  // type, and an empty one reads as a step left undone. What replaces it is the
  // account the session belongs to.
  it('a ChatGPT login is shown its account instead of a key field', async () => {
    mockViewport(false)
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

    expect(await screen.findByText('someone@example.com')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
    // Where we looked, which is the only way to explain "logged in at the
    // terminal but not here" when a GUI process has a different environment.
    expect(screen.getByText(/\.codex/)).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('settings.provider.apiKey'))).not.toBeInTheDocument()
  })

  /** An API-key provider keeps the field it has always had. */
  it('an API-key provider still gets a key field', async () => {
    mockViewport(false)
    render(<ProviderSettings />)
    expect(await screen.findByText(i18n.t('settings.provider.apiKey'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('settings.provider.codexAccount'))).not.toBeInTheDocument()
  })

  // The one control that writes `credential_kind`. Without it the catalog's
  // second sign-in option — the whole ChatGPT-login feature — was reachable
  // only by editing the database by hand: `create_provider` always took the
  // entry's default, and nothing on the panel could change it afterwards.
  it('a vendor with two sign-ins gets a selector, and choosing one writes the row', async () => {
    mockViewport(false)
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
    await screen.findByText(i18n.t('settings.provider.deleteProvider'))

    // A vendor with one way in never shows this — asserted by the tests above
    // never finding it. Here it exists and carries both options.
    await user.click(screen.getByRole('button', { name: new RegExp(i18n.t('settings.provider.authMethod')) }))
    await user.click(await screen.findByRole('option', { name: i18n.t('settings.provider.authMethodCodexCli') }))

    expect(mockApi.updateProvider).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        credentialKind: 'codex_cli',
        transportProfile: 'chatgpt_codex',
        apiFormat: 'responses',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
      }),
    )
  })

  it('shows the native GenerateContent protocol for Google connections', async () => {
    mockViewport(false)
    mockApi.listProviders.mockResolvedValue([
      {
        ...makeProvider('google-1', 'Gemini Relay'),
        provider_type: 'google',
        base_url: 'https://relay.example',
        api_format: 'gemini_generate_content',
      },
    ])
    render(<ProviderSettings />)
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

  // The old name for this was "desktop shrunk to mobile", and after the move to
  // a measured container that describes the wrong thing: the viewport does not
  // move here at all. What narrows is the pane — the sidebar being opened, or a
  // window drag that leaves the layer under two columns while the viewport is
  // still comfortably a desktop. The invariant it pins is unchanged, and it is
  // the one `useMasterDetail` calls load-bearing: the selection survives the
  // switch, and back returns to the list rather than out of settings.
  it('the pane narrowing below two columns: back still returns to the list', async () => {
    mockViewport(false)
    const user = userEvent.setup()
    const { act } = await import('@testing-library/react')
    render(<ProviderSettings />)

    expect(await screen.findByText(i18n.t('settings.provider.deleteProvider'))).toBeInTheDocument()

    const pane = document.querySelector('[data-slot="master-detail"]')!
    act(() => setContainerWidth(pane, 420))

    expect(await screen.findByText(i18n.t('common.back'))).toBeInTheDocument()
    await user.click(screen.getByText(i18n.t('common.back')))
    expect(await screen.findByText('Provider Two')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('common.back'))).not.toBeInTheDocument()
  })
})
