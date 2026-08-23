import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSettings } from './provider-settings'
import i18n from '@/i18n'
import { api } from '@/api'
import type { Provider } from '@/types'
import { resizeViewportTo } from '@/test/viewport'
import { setContainerWidth } from '@/test/resize'

vi.mock('@/api', () => ({
  api: {
    listProviders: vi.fn(),
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
  }
}

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
    expect(screen.getByPlaceholderText('https://api.example.com')).toBeInTheDocument()
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
