import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { SelectTextModal } from './select-text-modal'

/**
 * One dialog serves every bubble of a group. Its copy state used to outlive
 * the text: copy bubble A, open bubble B within two seconds, and the button
 * already said "Copied" with A still on the clipboard.
 */
describe('SelectTextModal', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('forgets a copy once it is showing other text', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    const { rerender } = render(<SelectTextModal text="first bubble" isOpen onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Copy All' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    rerender(<SelectTextModal text="second bubble" isOpen onOpenChange={vi.fn()} />)
    expect(screen.getByText('second bubble')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy All' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull()
  })
})
