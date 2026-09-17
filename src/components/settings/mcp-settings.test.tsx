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
    headers: transportType === 'streamablehttp' ? {} : null,
    is_enabled: false,
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
  }
}

describe('McpSettings list/detail navigation', () => {
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
  })

  it('uses a controlled replace-selection ListView without peer-row chevrons', async () => {
    const user = userEvent.setup()
    render(<McpSettings />)

    const list = await screen.findByRole('listbox', { name: i18n.t('settings.mcp.title') })
    const local = within(list).getByRole('option', { name: /Local tools/ })
    const remote = within(list).getByRole('option', { name: /Remote tools/ })

    expect(local).toHaveAttribute('data-key', 'stdio-server')
    expect(remote).toHaveTextContent('HTTP')
    expect(within(list).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(local.querySelector('[data-slot="list-view-item-action"] svg')).not.toBeInTheDocument()

    await user.click(remote)
    await waitFor(() => expect(remote).toHaveAttribute('aria-selected', 'true'))
    expect(await screen.findByText(i18n.t('settings.mcp.deleteServer'))).toBeInTheDocument()
  })
})
