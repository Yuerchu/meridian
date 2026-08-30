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
})
