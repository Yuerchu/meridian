import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptInput } from './prompt-input'

type Status = 'ready' | 'submitted' | 'streaming'

function Field({
  value = '',
  placeholder,
  status = 'ready',
  maxLines,
  maxHeight,
  style,
}: {
  value?: string
  placeholder?: string
  status?: Status
  maxLines?: number
  maxHeight?: number
  style?: React.CSSProperties
}) {
  return (
    <PromptInput value={value} status={status} onStop={() => {}} maxLines={maxLines} maxHeight={maxHeight}>
      <PromptInput.TextArea aria-label="Message" placeholder={placeholder} style={style} />
      <PromptInput.Send sendLabel="Send" stopLabel="Stop" />
    </PromptInput>
  )
}

const glyphs = () => {
  const glyph = document.querySelector('[data-slot="prompt-input-send-glyph"]')!
  const [arrow, stop] = [...glyph.querySelectorAll('svg')]
  return { arrow, stop }
}

describe('PromptInput.Send glyph', () => {
  it('keeps both glyphs in one slot and hides the one not in use', () => {
    const { rerender } = render(<Field />)
    let { arrow, stop } = glyphs()
    expect(arrow).toHaveAttribute('data-active')
    expect(stop.getAttribute('class')).toContain('opacity-0')
    expect(arrow.getAttribute('class')).not.toContain('opacity-0')

    rerender(<Field status="streaming" />)
    ;({ arrow, stop } = glyphs())
    expect(stop).toHaveAttribute('data-active')
    expect(arrow.getAttribute('class')).toContain('opacity-0')
    expect(stop.getAttribute('class')).not.toContain('opacity-0')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('is the same glyph element across a mode change, so the change can transition', () => {
    const { rerender } = render(<Field />)
    const before = document.querySelector('[data-slot="prompt-input-send-glyph"]')
    rerender(<Field status="streaming" />)
    expect(document.querySelector('[data-slot="prompt-input-send-glyph"]')).toBe(before)
  })
})

describe('PromptInput.TextArea ceiling', () => {
  // jsdom lays nothing out: give every textarea a tall content box.
  beforeEach(() => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(500)
  })
  afterEach(() => vi.restoreAllMocks())

  const field = () => screen.getByRole('textbox', { name: 'Message' })

  it('grows to a number of lines, then scrolls', () => {
    // No computed line height in jsdom: the 20px body-scale stand-in applies.
    const { rerender } = render(<Field maxLines={1} />)
    expect(field().style.height).toBe('20px')
    expect(field().style.overflowY).toBe('auto')
    rerender(<Field maxLines={8} />)
    expect(field().style.height).toBe('160px')
  })

  it('takes the lowest ceiling, a CSS max-height included', () => {
    render(<Field maxLines={8} maxHeight={300} style={{ maxHeight: '50px' }} />)
    expect(field().style.height).toBe('50px')
    expect(field().style.overflowY).toBe('auto')
  })
})

describe('PromptInput.TextArea placeholder', () => {
  const placeholders = () => [...document.querySelectorAll('[data-slot="prompt-input-field"] > span')]

  it('shows the first placeholder without animating it', () => {
    render(<Field placeholder="Ask anything" />)
    const [shown] = placeholders()
    expect(shown).toHaveTextContent('Ask anything')
    expect(shown.className).not.toContain('animate-label-in')
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-placeholder', 'Ask anything')
  })

  it('lifts the old one out while the new one rises in, then drops the old one', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Field placeholder="Ask anything" />)
    rerender(<Field placeholder="Queued until the turn ends" />)
    const [leaving, entering] = placeholders()
    expect(leaving).toHaveTextContent('Ask anything')
    expect(leaving.className).toContain('animate-label-out')
    expect(entering).toHaveTextContent('Queued until the turn ends')
    expect(entering.className).toContain('animate-label-in')
    act(() => vi.advanceTimersByTime(220))
    expect(placeholders()).toHaveLength(1)
    vi.useRealTimers()
  })

  it('is not drawn over text', () => {
    render(<Field value="hello" placeholder="Ask anything" />)
    expect(placeholders()).toHaveLength(0)
  })
})
