import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { ProviderInfoResponse } from '@/types'
import { EmojiSuggestSettings } from './emoji-suggest-settings'

vi.mock('@/lib/transport', () => ({ isRemote: false }))
vi.mock('@/api', () => ({
  api: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    providers: {
      list: vi.fn(),
      listModels: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

const PROVIDER: ProviderInfoResponse = {
  id: 'p1',
  name: 'Anthropic',
  provider_type: 'anthropic',
  base_url: 'https://api.anthropic.com',
  api_format: 'chat_completions',
  transport_profile: 'standard',
  credential_kind: 'api_key',
  catalog_id: null,
  has_api_key: true,
  models: [],
  default_model: null,
  created_at: 0,
  updated_at: 0,
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mockApi.preferences.get.mockResolvedValue({ key: 'emoji.suggest.model', value: null })
  mockApi.preferences.set.mockResolvedValue(undefined)
  mockApi.providers.list.mockResolvedValue([PROVIDER])
  mockApi.providers.listModels.mockResolvedValue([{ id: 'claude-haiku-5', name: 'claude-haiku-5' }])
})

it('saves a chosen pair as the sticker suggestion model', async () => {
  const user = userEvent.setup()
  render(<EmojiSuggestSettings />)

  await user.click(await screen.findByRole('button', { name: /Provider/ }))
  await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
  await user.click(await screen.findByRole('button', { name: /Model/ }))
  await user.click(await screen.findByRole('option', { name: /claude-haiku-5/ }))

  await waitFor(() => {
    expect(mockApi.preferences.set).toHaveBeenCalledWith({
      key: 'emoji.suggest.model',
      value: { provider_id: 'p1', model_id: 'claude-haiku-5' },
    })
  })
})
