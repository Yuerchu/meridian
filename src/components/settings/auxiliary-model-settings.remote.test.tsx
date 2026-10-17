import { render, screen } from '@testing-library/react'

import i18n from '@/i18n'
import type { ProviderInfoResponse } from '@/types'
import { AuxiliaryModelSettings } from './auxiliary-model-settings'

vi.mock('@/lib/transport', () => ({ isRemote: true }))

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
  await i18n.changeLanguage('en')
})

/**
 * The backend refuses this key on a remote client (`is_server_owned`), because
 * it chooses which provider every later summary is sent to — so the panel does
 * not offer a control the save would reject.
 */
it('is hidden on a remote client', () => {
  render(<AuxiliaryModelSettings providers={[PROVIDER]} />)
  expect(screen.queryByText('Auxiliary model')).not.toBeInTheDocument()
})
