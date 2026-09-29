import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { ImeDictionaryStagedInfoResponse } from '@/types'
import { ImeSettings } from './ime-settings'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('@/api', () => ({
  api: {
    getImeStatus: vi.fn(),
    getImeConfig: vi.fn(),
    listImeDictionaries: vi.fn(),
    getImeLmStatus: vi.fn(),
    getImeLearning: vi.fn(),
    stageImeDictionary: vi.fn(),
    cancelStagedImeDictionaries: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

const twoRoots: ImeDictionaryStagedInfoResponse = {
  staging_id: 'stage-7',
  roots: [
    { path: 'rime_ice.dict.yaml', name: 'rime_ice', imports: 3 },
    { path: 'melt_eng.dict.yaml', name: 'melt_eng', imports: 0 },
  ],
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.clearAllMocks()
  mockApi.getImeStatus.mockResolvedValue({
    registered_x64: true,
    registered_x86: true,
    profile_enabled: true,
    host_running: true,
    host_version: '0.3.0',
    installed: true,
    data_dir: 'C:\\ime',
    protocol_version: 3,
    dll_version: '0.3.0',
  } as never)
  mockApi.getImeConfig.mockResolvedValue({
    scheme: 'pinyin',
    page_size: 5,
    punctuation: 'full_width',
    learning: true,
    private_apps: [],
    debug_log: false,
    context_apps: [],
    prediction: true,
  })
  mockApi.listImeDictionaries.mockResolvedValue([])
  mockApi.getImeLmStatus.mockResolvedValue({ bundles: [], active: null, runtime_found: true } as never)
  mockApi.getImeLearning.mockResolvedValue({ words: [], transitions: 0, pending: 0 })
  mockApi.stageImeDictionary.mockResolvedValue(twoRoots)
  mockApi.cancelStagedImeDictionaries.mockResolvedValue(null)
  mocks.open.mockResolvedValue('C:\\Downloads\\rime-ice.zip')
})

async function stageTwoRoots() {
  const user = userEvent.setup()
  const view = render(<ImeSettings />)
  await user.click(await screen.findByRole('button', { name: i18n.t('settings.ime.importDictionary') }))
  await screen.findByText(i18n.t('settings.ime.chooseRoots', { count: 2 }))
  return { user, view }
}

/** Found in review: the unpacked archive stayed on disk until nothing deleted it. */
describe('a staged archive is handed back', () => {
  it('when the chooser is cancelled', async () => {
    const { user } = await stageTwoRoots()
    await user.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(mockApi.cancelStagedImeDictionaries).toHaveBeenCalledWith({ staging_id: 'stage-7' })
    expect(screen.queryByText(i18n.t('settings.ime.chooseRoots', { count: 2 }))).toBeNull()
  })

  it('when the page is left with the chooser open', async () => {
    const { view } = await stageTwoRoots()
    view.unmount()
    await waitFor(() => expect(mockApi.cancelStagedImeDictionaries).toHaveBeenCalledWith({ staging_id: 'stage-7' }))
  })
})
