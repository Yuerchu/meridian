import { render, screen } from '@testing-library/react'

import i18n from '@/i18n'
import { EmojiEmbedderSettings } from './emoji-embedder-settings'

vi.mock('@/lib/transport', () => ({ isRemote: true }))

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

/**
 * The backend refuses this key on a remote client (`is_server_owned`), because
 * it is an absolute path on the host — so the page does not offer a control
 * the save would reject.
 */
it('is hidden on a remote client', () => {
  render(<EmojiEmbedderSettings />)
  expect(screen.queryByText('Embedding model')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Choose model' })).not.toBeInTheDocument()
})
