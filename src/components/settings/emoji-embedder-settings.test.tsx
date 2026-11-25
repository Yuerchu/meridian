import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { EmojiEmbedderSettings } from './emoji-embedder-settings'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@/lib/transport', () => ({ isRemote: false }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@/api', () => ({
  api: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)
const PATH = 'C:\\models\\embeddinggemma.litertlm'

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mockApi.preferences.get.mockResolvedValue({ key: 'emoji.embedder', value: null })
  mockApi.preferences.set.mockResolvedValue(undefined)
  mocks.open.mockResolvedValue(null)
})

it('saves a chosen .litertlm path', async () => {
  const user = userEvent.setup()
  mocks.open.mockResolvedValue(PATH)
  render(<EmojiEmbedderSettings />)

  await user.click(await screen.findByRole('button', { name: 'Choose model' }))
  await waitFor(() => {
    expect(mockApi.preferences.set).toHaveBeenCalledWith({ key: 'emoji.embedder', value: PATH })
  })
  expect(await screen.findByText(PATH)).toBeInTheDocument()
})

it('clears the path back to the lexical pick', async () => {
  const user = userEvent.setup()
  mockApi.preferences.get.mockResolvedValue({ key: 'emoji.embedder', value: PATH })
  render(<EmojiEmbedderSettings />)

  await user.click(await screen.findByRole('button', { name: 'Clear embedding model' }))
  await waitFor(() => {
    expect(mockApi.preferences.set).toHaveBeenCalledWith({ key: 'emoji.embedder', value: null })
  })
  expect(await screen.findByText('Not set (name and tag match)')).toBeInTheDocument()
})

it('does not write when the picker is cancelled', async () => {
  const user = userEvent.setup()
  render(<EmojiEmbedderSettings />)
  await user.click(await screen.findByRole('button', { name: 'Choose model' }))
  expect(mockApi.preferences.set).not.toHaveBeenCalled()
})
