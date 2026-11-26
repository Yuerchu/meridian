import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { EmojiEmbedderStatusResponse } from '@/types'
import { EmojiEmbedderSettings } from './emoji-embedder-settings'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  listener: null as ((event: { payload: EmojiEmbedderStatusResponse }) => void) | null,
}))

vi.mock('@/lib/transport', () => ({
  isRemote: false,
  listen: vi.fn((_channel: string, handler: (event: { payload: EmojiEmbedderStatusResponse }) => void) => {
    mocks.listener = handler
    return Promise.resolve(() => {
      if (mocks.listener === handler) mocks.listener = null
    })
  }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@/api', () => ({
  api: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    emojis: {
      getEmbedderStatus: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)
const PATH = 'C:\\models\\embeddinggemma.litertlm'

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.listener = null
  await i18n.changeLanguage('en')
  mockApi.preferences.get.mockResolvedValue({ key: 'emoji.embedder', value: null })
  mockApi.preferences.set.mockResolvedValue(undefined)
  mockApi.emojis.getEmbedderStatus.mockResolvedValue({
    state: 'disabled',
    vision: false,
    indexed: 0,
    total: 0,
    error: null,
  })
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

it('shows live background indexing progress and ready/error states', async () => {
  mockApi.preferences.get.mockResolvedValue({ key: 'emoji.embedder', value: PATH })
  mockApi.emojis.getEmbedderStatus.mockResolvedValue({
    state: 'indexing',
    vision: true,
    indexed: 12,
    total: 100,
    error: null,
  })
  render(<EmojiEmbedderSettings />)

  expect(await screen.findByText('Indexing stickers… 12/100')).toBeInTheDocument()

  act(() => {
    mocks.listener?.({
      payload: { state: 'ready', vision: true, indexed: 100, total: 100, error: null },
    })
  })
  expect(await screen.findByText('Ready (100 stickers indexed, image + text)')).toBeInTheDocument()

  act(() => {
    mocks.listener?.({
      payload: { state: 'error', vision: false, indexed: 0, total: 0, error: 'missing file' },
    })
  })
  expect(await screen.findByText('Indexing failed: missing file')).toBeInTheDocument()
})
