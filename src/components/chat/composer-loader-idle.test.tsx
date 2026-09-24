import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Composer } from './composer'
import { LOADER_FADE_MS, LOADER_PAUSED } from './composer-loader-idle'

/**
 * The loader stays mounted around the composer, so an idle one used to keep
 * its infinite SVG animation running at opacity 0. `css: false` means jsdom
 * cannot report a play state; what is asserted is the class that carries it.
 */
function composer(streaming: boolean) {
  return (
    <Composer value="" onChange={() => {}} onSubmit={() => {}} onStop={() => {}} streaming={streaming} ariaLabel="m" />
  )
}

/** composer-loader's root: the parent of the light layer (the span holding the svg). */
function loaderRoot(container: HTMLElement): HTMLElement {
  const light = [...container.querySelectorAll<HTMLElement>('span[aria-hidden]')].find((s) => s.querySelector('svg'))
  if (!light?.parentElement) throw new Error('no loader')
  return light.parentElement
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('composer loader when idle', () => {
  it('pauses the light, overriding the inline animation, once idle', () => {
    const { container } = render(composer(false))
    expect(loaderRoot(container).className).toContain(LOADER_PAUSED)
    // Inline `animation` would otherwise reset the play state to running.
    expect(LOADER_PAUSED).toMatch(/\[&_rect\]:\[animation-play-state:paused\]!$/)
  })

  it('runs while a turn runs', () => {
    const { container } = render(composer(true))
    expect(loaderRoot(container).className).not.toContain(LOADER_PAUSED)
  })

  it('keeps running through the fade-out and pauses only after it', () => {
    const { container, rerender } = render(composer(true))
    rerender(composer(false))
    expect(loaderRoot(container).className).not.toContain(LOADER_PAUSED)
    act(() => vi.advanceTimersByTime(LOADER_FADE_MS - 1))
    expect(loaderRoot(container).className).not.toContain(LOADER_PAUSED)
    act(() => vi.advanceTimersByTime(1))
    expect(loaderRoot(container).className).toContain(LOADER_PAUSED)
  })

  it('resumes at once when the next turn starts', () => {
    const { container, rerender } = render(composer(false))
    rerender(composer(true))
    expect(loaderRoot(container).className).not.toContain(LOADER_PAUSED)
  })
})
