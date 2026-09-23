import { fireEvent, render, screen } from '@testing-library/react'

import { VoiceButton } from './voice-button'

describe('VoiceButton', () => {
  it('routes virtual activation to the keyboard-style toggle handler', () => {
    const onKeyboardPress = vi.fn()
    render(<VoiceButton state="idle" aria-label="Voice input" onKeyboardPress={onKeyboardPress} />)

    // A programmatic click has no preceding pointer event, which React Aria
    // exposes as the same `virtual` press used by assistive technology.
    fireEvent.click(screen.getByRole('button', { name: 'Voice input' }))

    expect(onKeyboardPress).toHaveBeenCalledTimes(1)
  })

  // While a reply streams the composer disables the microphone. Its ink has to
  // stay the control's own: `text-text-disabled` is the pill colour in dark, and
  // the icon went black on the chip every time a turn started.
  it('keeps its icon ink when disabled and dims the whole control instead', () => {
    render(<VoiceButton state="idle" aria-label="Voice input" disabled />)
    const button = screen.getByRole('button', { name: 'Voice input' })

    expect(button).toHaveAttribute('data-disabled')
    expect(button.className).toContain('text-foreground-icon-primary')
    expect(button.className).not.toMatch(/data-\[disabled\]:text-/)
    expect(button.className).toContain('data-[disabled]:opacity-40')
  })
})
