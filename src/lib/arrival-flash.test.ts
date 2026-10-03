import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ARRIVAL_MS, markArrival } from './arrival-flash'

describe('markArrival', () => {
  let viewport: HTMLElement
  let item: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    viewport = document.createElement('div')
    viewport.dataset.slot = 'message-scroller-viewport'
    item = document.createElement('div')
    item.dataset.slot = 'message-scroller-item'
    item.dataset.messageId = 'turn-7'
    viewport.append(item)
    document.body.append(viewport)
  })
  afterEach(() => {
    viewport.remove()
    vi.useRealTimers()
  })

  const marked = () => item.hasAttribute('data-arrival')

  it('marks a turn already in view once nothing has scrolled for a moment, then lets go', () => {
    markArrival('turn-7')
    expect(marked()).toBe(false)
    vi.advanceTimersByTime(120)
    expect(marked()).toBe(true)
    vi.advanceTimersByTime(ARRIVAL_MS)
    expect(marked()).toBe(false)
  })

  it('waits for a smooth scroll to settle before marking', () => {
    markArrival('turn-7')
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50)
      viewport.dispatchEvent(new Event('scroll'))
    }
    expect(marked()).toBe(false)
    vi.advanceTimersByTime(120)
    expect(marked()).toBe(true)
  })

  it('keeps a second jump to the same turn marked for its full time', () => {
    markArrival('turn-7')
    vi.advanceTimersByTime(120)
    vi.advanceTimersByTime(ARRIVAL_MS - 200)
    markArrival('turn-7')
    vi.advanceTimersByTime(120)
    // The first mark's timer falls due here; it no longer owns the mark.
    vi.advanceTimersByTime(200)
    expect(marked()).toBe(true)
    vi.advanceTimersByTime(ARRIVAL_MS)
    expect(marked()).toBe(false)
  })

  it('does nothing for a turn that is not on screen', () => {
    expect(() => markArrival('nowhere')).not.toThrow()
  })
})
