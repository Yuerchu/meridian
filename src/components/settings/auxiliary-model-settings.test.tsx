import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { ProviderInfoResponse } from '@/types'
import { AuxiliaryModelSettings } from './auxiliary-model-settings'

vi.mock('@/lib/transport', () => ({ isRemote: false }))
vi.mock('@/api', () => ({
  api: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    providers: {
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
  mockApi.preferences.get.mockResolvedValue({ key: 'auxiliary.model', value: null })
  // The component chains `.catch` on the save: a mock returning `undefined`
  // is an unhandled error the suite reports as a failure even when the
  // assertion passes.
  mockApi.preferences.set.mockResolvedValue(null as never)
})

it('saves a chosen pair as a provider:model preference', async () => {
  const user = userEvent.setup()
  mockApi.providers.listModels.mockResolvedValue([{ id: 'claude-haiku-5', name: 'claude-haiku-5' }])
  render(<AuxiliaryModelSettings providers={[PROVIDER]} />)

  // Pick a provider, then a model; onCommit fires once the pair settles.
  await user.click(await screen.findByRole('button', { name: /Provider/ }))
  await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
  await user.click(await screen.findByRole('button', { name: /Model/ }))
  await user.click(await screen.findByRole('option', { name: /claude-haiku-5/ }))

  await waitFor(() => {
    expect(mockApi.preferences.set).toHaveBeenCalledWith({
      key: 'auxiliary.model',
      value: { provider_id: 'p1', model_id: 'claude-haiku-5' },
    })
  })
})
