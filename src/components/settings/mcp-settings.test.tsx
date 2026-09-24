import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { resizeViewportTo } from '@/test/viewport'
import type { McpServerInfoResponse } from '@/types'
import { McpSettings } from './mcp-settings'

vi.mock('@/api', () => ({
  api: {
    listMcpServers: vi.fn(),
    listMcpTools: vi.fn(),
    listMcpConnectionStatuses: vi.fn(),
    createMcpServer: vi.fn(),
    deleteMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

function makeServer(id: string, name: string, transportType: string): McpServerInfoResponse {
  return {
    id,
    name,
    transport_type: transportType,
    command: transportType === 'stdio' ? 'npx' : null,
    args: transportType === 'stdio' ? [] : null,
    env: transportType === 'stdio' ? {} : null,
    url: transportType === 'streamablehttp' ? 'https://example.com/mcp' : null,
    headers: transportType === 'streamablehttp' ? { Authorization: 'Bearer secret-token' } : null,
    is_enabled: false,
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
  } as McpServerInfoResponse
}

describe('McpSettings pages', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resizeViewportTo(1024)
    mockApi.listMcpServers.mockResolvedValue([
      makeServer('stdio-server', 'Local tools', 'stdio'),
      makeServer('http-server', 'Remote tools', 'streamablehttp'),
    ])
    mockApi.listMcpTools.mockResolvedValue([])
    mockApi.listMcpConnectionStatuses.mockResolvedValue([])
    mockApi.updateMcpServer.mockResolvedValue(undefined as never)
    mockApi.deleteMcpServer.mockResolvedValue(undefined as never)
  })

  it('lists servers as rows of one card, name and transport on one line', async () => {
    const { container } = render(<McpSettings />)

    const local = await screen.findByRole('button', { name: 'Local tools' })
    const remote = screen.getByRole('button', { name: 'Remote tools' })
    expect(local).toHaveAttribute('data-key', 'stdio-server')
    // The transport is a tag describing the row, not part of its name.
    expect(remote).toHaveAccessibleDescription(/HTTP/)
    const list = container.querySelector<HTMLElement>('[data-slot="mcp-server-list"]')!
    expect(list.lastElementChild).toHaveAttribute('data-slot', 'settings-add-row')
    expect(within(list).getByRole('button', { name: i18n.t('settings.mcp.addServer') })).toBeInTheDocument()
  })

  it('opens a server as a page over the list, and Back returns to it', async () => {
    const user = userEvent.setup()
    render(<McpSettings />)

    await user.click(await screen.findByRole('button', { name: 'Remote tools' }))
    expect(await screen.findByRole('heading', { name: 'Remote tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('settings.mcp.delete') })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(await screen.findByRole('button', { name: 'Local tools' })).toBeInTheDocument()
  })

  it('masks header values until they are shown, and saves them as a map', async () => {
    const user = userEvent.setup()
    render(<McpSettings />)
    await user.click(await screen.findByRole('button', { name: 'Remote tools' }))

    const value = await screen.findByRole('textbox', { name: 'Name 1' })
    expect(value).toHaveValue('Authorization')
    const secret = screen.getByLabelText('Value 1')
    expect(secret).toHaveAttribute('type', 'password')
    expect(secret).toHaveValue('Bearer secret-token')

    await user.click(screen.getByRole('button', { name: i18n.t('settings.mcp.kv.showValues') }))
    expect(screen.getByLabelText('Value 1')).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: i18n.t('settings.mcp.kv.addHeader') }))
    await user.type(screen.getByRole('textbox', { name: 'Name 2' }), 'X-Trace')
    await user.type(screen.getByLabelText('Value 2'), 'on')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() =>
      expect(mockApi.updateMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'http-server',
          headers: { Authorization: 'Bearer secret-token', 'X-Trace': 'on' },
        }),
      ),
    )
  })

  it('refuses a header name given twice instead of letting the last one win', async () => {
    const user = userEvent.setup()
    render(<McpSettings />)
    await user.click(await screen.findByRole('button', { name: 'Remote tools' }))

    await user.click(await screen.findByRole('button', { name: i18n.t('settings.mcp.kv.addHeader') }))
    await user.type(screen.getByRole('textbox', { name: 'Name 2' }), 'Authorization')
    await user.type(screen.getByLabelText('Value 2'), 'other')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Authorization')
    expect(mockApi.updateMcpServer).not.toHaveBeenCalled()
  })

  it('deletes from a danger row after confirming, and unwinds to the list', async () => {
    const user = userEvent.setup()
    render(<McpSettings />)
    await user.click(await screen.findByRole('button', { name: 'Local tools' }))

    mockApi.listMcpServers.mockResolvedValue([makeServer('http-server', 'Remote tools', 'streamablehttp')])
    await user.click(await screen.findByRole('button', { name: i18n.t('settings.mcp.delete') }))
    await user.click(await screen.findByRole('button', { name: i18n.t('common.confirm') }))

    await waitFor(() => expect(mockApi.deleteMcpServer).toHaveBeenCalledWith('stdio-server'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Local tools' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Remote tools' })).toBeInTheDocument()
  })
})
