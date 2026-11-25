import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { LogEntryInfoResponse } from '@/types'
import { LogViewer } from './log-viewer'

const dialog = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@/lib/capabilities', () => ({ can: { exportToDisk: true } }))
vi.mock('./log-row', () => ({
  LogRow: ({ entry }: { entry: { message: string } }) => <div data-slot="log-row">{entry.message}</div>,
}))
vi.mock('@/api', () => ({
  api: {
    logs: {
      read: vi.fn(),
      getSettings: vi.fn(),
      export: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

function page(message: string) {
  return {
    entries: [{ message, cursor: { file_index: 0, byte_offset: 1 } } as unknown as LogEntryInfoResponse],
    next_cursor: null,
    scan_truncated: false,
    files_scanned: [],
  }
}

describe('LogViewer', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.logs.getSettings.mockResolvedValue({ available: true } as never)
    mockApi.logs.read.mockResolvedValue(page('first line'))
  })

  it('keeps the rows on screen while a refresh is in flight', async () => {
    const user = userEvent.setup()
    render(<LogViewer onBack={() => {}} />)
    expect(await screen.findByText('first line')).toBeInTheDocument()

    let finish: (value: ReturnType<typeof page>) => void = () => {}
    mockApi.logs.read.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    await user.click(screen.getByRole('button', { name: i18n.t('settings.about.logs.refresh') }))

    expect(screen.getByText('first line')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: i18n.t('common.loading') })).toBeNull()
    finish(page('second line'))
    expect(await screen.findByText('second line')).toBeInTheDocument()
  })

  it('says so when writing the export fails', async () => {
    const user = userEvent.setup()
    dialog.save.mockResolvedValue('C:/logs.jsonl')
    mockApi.logs.export.mockRejectedValue('disk full')
    render(<LogViewer onBack={() => {}} />)
    await screen.findByText('first line')

    await user.click(screen.getByRole('button', { name: i18n.t('settings.about.logs.export') }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        i18n.t('settings.about.logs.exportFailed', { error: 'disk full' }),
      ),
    )
    expect(screen.queryByText(i18n.t('settings.about.logs.exported'))).toBeNull()
  })
})
