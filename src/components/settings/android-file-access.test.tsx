import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { AndroidFileAccess } from './android-file-access'

vi.mock('@/api', () => ({
  api: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    platform: {
      getManageStorageStatus: vi.fn(),
      listSafRoots: vi.fn(),
      openManageStorageSettings: vi.fn(),
      selectSafDirectory: vi.fn(),
      deleteSafRoot: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

describe('AndroidFileAccess', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.preferences.get.mockResolvedValue({ key: 'android.manage_storage_enabled', value: false })
    mockApi.platform.getManageStorageStatus.mockResolvedValue(false)
    mockApi.platform.listSafRoots.mockResolvedValue([])
    mockApi.preferences.set.mockResolvedValue(undefined)
    mockApi.platform.openManageStorageSettings.mockResolvedValue(undefined)
  })

  it('persists an enabled switch immediately and opens the system grant page', async () => {
    const user = userEvent.setup()
    render(<AndroidFileAccess />)

    const toggle = await screen.findByRole('switch', {
      name: i18n.t('settings.fileAccess.manageToggle'),
    })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    await waitFor(() => {
      expect(mockApi.preferences.set).toHaveBeenCalledWith({ key: 'android.manage_storage_enabled', value: true })
      expect(mockApi.platform.openManageStorageSettings).toHaveBeenCalledTimes(1)
    })
    expect(toggle).toBeChecked()
    expect(screen.getByText(i18n.t('settings.fileAccess.manageNotGranted'))).toBeInTheDocument()
  })

  it('says so when adding a directory fails, instead of logging it', async () => {
    const user = userEvent.setup()
    mockApi.platform.selectSafDirectory.mockRejectedValue('picker unavailable')
    render(<AndroidFileAccess />)

    await user.click(await screen.findByRole('button', { name: i18n.t('settings.fileAccess.addDir') }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('settings.fileAccess.error'))
    expect(alert).toHaveTextContent('picker unavailable')
  })

  it('puts the switch back and says so when the preference is not written', async () => {
    const user = userEvent.setup()
    mockApi.preferences.set.mockRejectedValue('db locked')
    render(<AndroidFileAccess />)

    const toggle = await screen.findByRole('switch', { name: i18n.t('settings.fileAccess.manageToggle') })
    await user.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('db locked')
    expect(toggle).not.toBeChecked()
    expect(mockApi.platform.openManageStorageSettings).not.toHaveBeenCalled()
  })
})
