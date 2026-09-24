import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { AcpSettings } from './acp-settings'

vi.mock('@/api', () => ({
  api: {
    acpGetConfig: vi.fn(),
    acpSaveConfig: vi.fn(),
    acpCheckAdapter: vi.fn(),
  },
}))

vi.mock('./dirty-guard', () => ({ useSettingsDirtyRegistration: () => {} }))

const mockApi = vi.mocked(api)

describe('AcpSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // `acp.command` is a binary this app executes. A failed read used to fill the
  // form with the default `npx` command, and Save wrote that over whatever the
  // user had configured (a `docker run …` launch, say).
  it('shows an error instead of a defaults form a Save would write back', async () => {
    mockApi.acpGetConfig.mockRejectedValueOnce('db locked')
    mockApi.acpGetConfig.mockResolvedValue({ command: 'docker', args: ['run', '-i', 'agent'] })
    const user = userEvent.setup()
    render(<AcpSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.acp.loadError'))
    expect(screen.queryByRole('button', { name: i18n.t('common.save') })).not.toBeInTheDocument()
    expect(mockApi.acpSaveConfig).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByRole('button', { name: i18n.t('common.save') })).toBeInTheDocument()
    expect(screen.getByDisplayValue('docker')).toBeInTheDocument()
  })
})
