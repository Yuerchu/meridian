import { render, screen } from '@testing-library/react'

import i18n from '@/i18n'
import { EmojiSuggestSettings } from './emoji-suggest-settings'

vi.mock('@/lib/transport', () => ({ isRemote: true }))

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

/**
 * The backend refuses this key on a remote client (`is_server_owned`), because
 * sticker images go to the chosen provider.
 */
it('is hidden on a remote client', () => {
  render(<EmojiSuggestSettings />)
  expect(screen.queryByText('Suggestion model')).not.toBeInTheDocument()
})
