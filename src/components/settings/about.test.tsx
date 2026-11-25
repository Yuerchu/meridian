import { act, render, screen } from '@testing-library/react'
import { api } from '@/api'
import i18n from '@/i18n'
import type { AppInfoResponse } from '@/types'
import { About } from './about'

vi.mock('@/api', () => ({ api: { platform: { getAppInfo: vi.fn() } } }))
vi.mock('./logs/log-viewer', () => ({ LogViewer: () => null }))

it('names pending system values and retires their loading regions when the values arrive', async () => {
  let finish!: (info: AppInfoResponse) => void
  vi.mocked(api.platform.getAppInfo).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const { container } = render(<About />)
  const name = `${i18n.t('settings.about.system.version')}: ${i18n.t('common.loadingLabel')}`
  const pending = screen.getByRole('status', { name })
  expect(pending).toHaveAttribute('aria-busy', 'true')
  expect(pending.querySelector('.ui-skeleton')).toHaveAttribute('aria-hidden', 'true')
  expect(container.querySelectorAll('.ui-skeleton')).toHaveLength(4)
  await act(async () => {
    finish({ version: '1.2.3', tauri_version: '2.0.0', os: 'windows', arch: 'x86_64', data_dir: 'C:/Meridian' })
  })
  expect(screen.queryByRole('status', { name })).not.toBeInTheDocument()
  expect(container.querySelector('.ui-skeleton')).not.toBeInTheDocument()
  expect(screen.getByText('1.2.3')).toBeInTheDocument()
})
