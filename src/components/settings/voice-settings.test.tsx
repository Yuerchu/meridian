import { act, render, screen } from '@testing-library/react'
import { VoiceSettings } from './voice-settings'
import i18n from '@/i18n'
import type { VoiceModelDownloadEvent } from '@/lib/app-event'

const mocks = vi.hoisted(() => ({
  progress: null as ((event: { payload: VoiceModelDownloadEvent }) => void) | null,
}))

vi.mock('@/lib/transport', () => ({
  listen: vi.fn((event: string, callback: typeof mocks.progress) => {
    if (event === 'voice-model-download') mocks.progress = callback
    return Promise.resolve(() => {})
  }),
}))
vi.mock('@/api', () => ({
  api: {
    voice: {
      getModelStatus: vi.fn(async () => ({ installed: false, size_bytes: 0, path: '' })),
    },
    preferences: {
      get: vi.fn(async () => ({ value: null })),
    },
  },
}))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('@/hooks/use-confirm', () => ({ useConfirm: () => ({ confirm: vi.fn(), confirmDialog: null }) }))
vi.mock('@/lib/capabilities', () => ({ can: { importFromDisk: true } }))

async function download(total: number | null, downloaded = 25) {
  render(<VoiceSettings />)
  await screen.findByText(i18n.t('settings.voice.modelMissing'))
  act(() => mocks.progress?.({ payload: { type: 'progress', downloaded, total } }))
  return screen.getByRole('progressbar', { name: i18n.t('settings.voice.downloading') })
}

describe('VoiceSettings download progress', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('names a determinate byte reading using the library preset', async () => {
    const ring = await download(100)
    expect(ring).toHaveClass('ui-progress-circle')
    expect(ring).toHaveAttribute('data-size', 'sm')
    expect(ring).toHaveAttribute('aria-valuenow', '25')
    expect(ring).toHaveAttribute('aria-valuemax', '100')
    expect(ring.querySelector('.ui-progress-circle__fill')).toHaveAttribute('stroke-dashoffset', '75')
  })

  it.each([null, 0])('keeps an unknown total (%s) indeterminate', async (total) => {
    const ring = await download(total)
    expect(ring).not.toHaveAttribute('aria-valuenow')
    expect(ring.querySelector('.ui-progress-circle__svg')).toHaveAttribute('data-indeterminate', 'true')
  })

  it('clamps an overrun to the announced maximum', async () => {
    const ring = await download(100, 125)
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring.querySelector('.ui-progress-circle__fill')).toHaveAttribute('stroke-dashoffset', '0')
  })
})
