import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { AndroidFileAccess } from './android-file-access'

vi.mock('@/api', () => ({
  api: {
    getPreference: vi.fn(),
    getManageStorageStatus: vi.fn(),
    listSafRoots: vi.fn(),
    setPreference: vi.fn(),
    requestManageStorage: vi.fn(),
    pickSafDirectory: vi.fn(),
    removeSafRoot: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('AndroidFileAccess', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.getPreference.mockResolvedValue({ key: 'android.manage_storage_enabled', value: false })
    mockApi.getManageStorageStatus.mockResolvedValue(false)
    mockApi.listSafRoots.mockResolvedValue([])
    mockApi.setPreference.mockResolvedValue(undefined)
    mockApi.requestManageStorage.mockResolvedValue(undefined)
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
      expect(mockApi.setPreference).toHaveBeenCalledWith({ key: 'android.manage_storage_enabled', value: true })
      expect(mockApi.requestManageStorage).toHaveBeenCalledTimes(1)
    })
    expect(toggle).toBeChecked()
    expect(screen.getByText(i18n.t('settings.fileAccess.manageNotGranted'))).toBeInTheDocument()
  })
})
