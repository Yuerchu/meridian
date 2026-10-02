import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useHorizontalWheel } from './use-horizontal-wheel'

function Row() {
  const ref = useHorizontalWheel<HTMLDivElement>()
  return <div ref={ref} />
}

/** A row 300px wide showing 100px of it, scrolled to `left`. */
function row(left: number, { scrollWidth = 300 } = {}) {
  const el = render(<Row />).container.firstElementChild as HTMLElement
  Object.defineProperties(el, {
    scrollWidth: { value: scrollWidth, configurable: true },
    clientWidth: { value: 100, configurable: true },
  })
  el.scrollLeft = left
  return el
}

function wheel(el: HTMLElement, init: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

describe('useHorizontalWheel', () => {
  it('turns a vertical wheel into sideways movement', () => {
    const el = row(0)
    const event = wheel(el, { deltaY: 60 })
    expect(event.defaultPrevented).toBe(true)
    expect(el.scrollLeft).toBe(60)
  })

  it('counts a line-mode notch in pixels', () => {
    const el = row(0)
    wheel(el, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(el.scrollLeft).toBe(48)
  })

  // Trapping the wheel at the end is what made a page stop scrolling under a row.
  it('lets the page scroll once the row is at the end it is moving towards', () => {
    const atEnd = row(200)
    expect(wheel(atEnd, { deltaY: 60 }).defaultPrevented).toBe(false)
    const atStart = row(0)
    expect(wheel(atStart, { deltaY: -60 }).defaultPrevented).toBe(false)
  })

  it('leaves a row with nothing hidden, a horizontal gesture and Ctrl+wheel alone', () => {
    expect(wheel(row(0, { scrollWidth: 100 }), { deltaY: 60 }).defaultPrevented).toBe(false)
    expect(wheel(row(0), { deltaX: 40, deltaY: 10 }).defaultPrevented).toBe(false)
    expect(wheel(row(0), { deltaY: 60, ctrlKey: true }).defaultPrevented).toBe(false)
  })
})
