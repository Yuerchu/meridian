import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { PriceTierEditor } from './price-tier-editor'
import { blankTier, type TierDraft } from './pricing'

function Editor({ initial }: { initial: TierDraft[] }) {
  const [tiers, setTiers] = useState(initial)
  return <PriceTierEditor tiers={tiers} onChange={setTiers} />
}

const card = (threshold: string) => screen.getByDisplayValue(threshold).closest('[data-slot="price-tier"]')

/**
 * Tiers were keyed by index: deleting the first gave its card's element to the
 * second, with focus still on the delete button — which now deleted the tier
 * that had been second.
 */
describe('PriceTierEditor', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps the card of a tier that stays when one before it is removed', async () => {
    const user = userEvent.setup()
    render(
      <Editor
        initial={[
          { ...blankTier(), threshold: '100' },
          { ...blankTier(), threshold: '200' },
        ]}
      />,
    )
    const second = card('200')

    await user.click(screen.getAllByRole('button', { name: i18n.t('settings.model.removeTier') })[0])

    expect(screen.queryByDisplayValue('100')).toBeNull()
    expect(second).not.toBeNull()
    expect(card('200')).toBe(second)
  })

  it('keeps the field being typed in', async () => {
    const user = userEvent.setup()
    render(<Editor initial={[{ ...blankTier(), threshold: '1' }]} />)

    await user.click(screen.getByDisplayValue('1'))
    await user.keyboard('23')

    expect(screen.getByDisplayValue('123')).toHaveFocus()
  })
})
