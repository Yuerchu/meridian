import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSettings } from './provider-settings'
import i18n from '@/i18n'
import { api } from '@/api'
import type { Provider } from '@/types'

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

function mockViewport(mobile: boolean) {
  const listeners: Array<() => void> = []
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: mobile ? 500 : 1024,
  })
  window.matchMedia = vi.fn().mockReturnValue({
    matches: mobile,
    addEventListener: vi.fn((_event: string, handler: () => void) => {
      listeners.push(handler)
    }),
    removeEventListener: vi.fn(),
  })
  return {
    resize(nowMobile: boolean) {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: nowMobile ? 500 : 1024,
      })
      listeners.forEach((fn) => fn())
    },
  }
}

describe('ProviderSettings mobile list/detail navigation', () => {
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

  it('desktop shrunk to mobile: back still returns to the list', async () => {
    const viewport = mockViewport(false)
    const user = userEvent.setup()
    const { act } = await import('@testing-library/react')
    render(<ProviderSettings />)

    // Auto-selected on desktop, then the window is narrowed below the breakpoint.
    expect(await screen.findByText(i18n.t('settings.provider.deleteProvider'))).toBeInTheDocument()
    act(() => viewport.resize(true))

    expect(await screen.findByText(i18n.t('common.back'))).toBeInTheDocument()
    await user.click(screen.getByText(i18n.t('common.back')))
    expect(await screen.findByText('Provider Two')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('common.back'))).not.toBeInTheDocument()
  })
})
