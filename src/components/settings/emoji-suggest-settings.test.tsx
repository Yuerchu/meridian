import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { ProviderInfoResponse } from '@/types'
import { EmojiSuggestSettings } from './emoji-suggest-settings'

vi.mock('@/lib/transport', () => ({ isRemote: false }))
vi.mock('@/api', () => ({
  api: {
    getPreference: vi.fn(),
    setPreference: vi.fn(),
    listProviders: vi.fn(),
    fetchProviderModels: vi.fn(),
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
  mockApi.getPreference.mockResolvedValue({ key: 'emoji.suggest.model', value: null })
  mockApi.setPreference.mockResolvedValue(null)
  mockApi.listProviders.mockResolvedValue([PROVIDER])
  mockApi.fetchProviderModels.mockResolvedValue([{ id: 'claude-haiku-5', name: 'claude-haiku-5' }])
})

it('saves a chosen pair as the sticker suggestion model', async () => {
  const user = userEvent.setup()
  render(<EmojiSuggestSettings />)

  await user.click(await screen.findByRole('button', { name: /Provider/ }))
  await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
  await user.click(await screen.findByRole('button', { name: /Model/ }))
  await user.click(await screen.findByRole('option', { name: /claude-haiku-5/ }))

  await waitFor(() => {
    expect(mockApi.setPreference).toHaveBeenCalledWith({
      key: 'emoji.suggest.model',
      value: { providerId: 'p1', modelId: 'claude-haiku-5' },
    })
  })
})
