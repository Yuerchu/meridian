import { render, screen } from '@testing-library/react'

import i18n from '@/i18n'
import { VoiceOverlay } from './voice-overlay'

describe('VoiceOverlay announcements and meter', () => {
  beforeEach(() => i18n.changeLanguage('en'))

  it('announces only the state while hiding rapid timer and meter updates', () => {
    const { container, rerender } = render(<VoiceOverlay state="recording-hold" elapsed={12} peak={0.6} />)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('chat.voice.releaseToSend'))
    expect(screen.getByText('0:12')).toHaveAttribute('aria-hidden', 'true')
    const meter = container.querySelector('[aria-hidden="true"].h-10')
    expect(meter).not.toBeNull()
    expect(meter!.querySelectorAll('span')).toHaveLength(21)
    expect(meter!.querySelectorAll('span')[10]).toHaveStyle({ transform: 'scaleY(1)' })
    expect(meter!.querySelector('span')!.className).toContain('motion-reduce:transition-none')

    rerender(<VoiceOverlay state="cancelling" elapsed={12.5} peak={0.1} />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('chat.voice.releaseToCancel'))
  })
})
