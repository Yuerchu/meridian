import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { RemoteAccessSettings } from './remote-access-settings'
import { RemoteClientSettings } from './remote-client-settings'

const transport = vi.hoisted(() => ({ probeRemote: vi.fn() }))
vi.mock('@/lib/transport', () => ({
  isRemote: false,
  probeRemote: transport.probeRemote,
  readRemoteConfig: () => null,
  writeRemoteConfig: vi.fn(),
}))
vi.mock('@/hooks/use-connection-state', () => ({ useConnectionState: () => 'connected' }))
vi.mock('@/api', () => ({
  api: {
    getListenConfig: vi.fn(),
    getListenStatus: vi.fn(),
    getListenAddresses: vi.fn(),
    setSecret: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('RemoteAccessSettings token', () => {
  // After `userEvent.setup()`, which installs a clipboard of its own.
  function stubClipboard() {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.getListenConfig.mockResolvedValue({
      enabled: true,
      host: '0.0.0.0',
      port: 8787,
      token: 'secret-token-123456',
    })
    mockApi.getListenStatus.mockResolvedValue({ running: false, port: null } as never)
    mockApi.getListenAddresses.mockResolvedValue([])
  })

  it('copies the token', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard().mockResolvedValue(undefined)
    render(<RemoteAccessSettings />)

    await user.click(await screen.findByRole('button', { name: i18n.t('settings.remote.copyToken') }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('secret-token-123456'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so when the clipboard refuses', async () => {
    const user = userEvent.setup()
    stubClipboard().mockRejectedValue(new Error('not allowed'))
    render(<RemoteAccessSettings />)

    await user.click(await screen.findByRole('button', { name: i18n.t('settings.remote.copyToken') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('settings.remote.copyFailed', { error: 'Error: not allowed' }),
    )
  })
})

describe('RemoteClientSettings probe', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('announces a failed connection test as an alert', async () => {
    const user = userEvent.setup()
    transport.probeRemote.mockResolvedValue({ ok: false, reason: 'unreachable' })
    render(<RemoteClientSettings />)

    await user.type(screen.getByLabelText(i18n.t('settings.client.host')), '192.168.1.2')
    await user.click(screen.getByRole('button', { name: i18n.t('settings.client.test') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.client.testUnreachable'))
  })
})
