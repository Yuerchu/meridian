import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { GeneralSettings } from './general-settings'

vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('@/lib/theme', () => ({ useAppTheme: () => ({ theme: 'system', setTheme: () => {} }) }))
vi.mock('./remote-client-settings', () => ({ RemoteClientSettings: () => null }))
vi.mock('./android-file-access', () => ({ AndroidFileAccess: () => null }))
vi.mock('@/api', () => ({
  api: {
    getPreference: vi.fn(),
    setPreference: vi.fn(),
    getServiceKeyExists: vi.fn(),
    setServiceKey: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('GeneralSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.getServiceKeyExists.mockResolvedValue(false)
  })

  it('waits for the stored settings rather than showing defaults as if they were them', async () => {
    let finish: () => void = () => {}
    mockApi.getPreference.mockImplementation(
      ({ key }) =>
        new Promise((resolve) => {
          finish = () => resolve({ key, value: key === 'shell' ? 'powershell' : null } as never)
        }) as never,
    )
    render(<GeneralSettings />)

    expect(screen.getByRole('status', { name: i18n.t('common.loading') })).toBeInTheDocument()
    expect(screen.queryAllByText('Bash (Git Bash)')).toHaveLength(0)
  })

  it('reports a failed read with a retry, instead of drawing the defaults', async () => {
    const user = userEvent.setup()
    mockApi.getPreference.mockRejectedValueOnce('db locked')
    mockApi.getPreference.mockImplementation(async ({ key }) => ({ key, value: null }) as never)
    render(<GeneralSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.general.loadError'))
    expect(screen.queryAllByText('Bash (Git Bash)')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect((await screen.findAllByText('Bash (Git Bash)')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
