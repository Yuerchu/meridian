import type { PointerEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isTruncated, titleIfTruncated } from './truncation'

/**
 * jsdom has no layout, so each case states the measurements a browser would
 * report: the element's integer scroll/client sizes, its fractional box, and
 * the fractional extent of the text inside it.
 */
function laidOut({
  scroll = [100, 20],
  client = [100, 20],
  box = [100, 20],
  text = [90, 20],
}: {
  scroll?: [number, number]
  client?: [number, number]
  box?: [number, number]
  text?: [number, number]
}) {
  const el = document.createElement('span')
  el.textContent = 'a long conversation title'
  Object.defineProperties(el, {
    scrollWidth: { value: scroll[0], configurable: true },
    scrollHeight: { value: scroll[1], configurable: true },
    clientWidth: { value: client[0], configurable: true },
    clientHeight: { value: client[1], configurable: true },
  })
  el.getBoundingClientRect = () => new DOMRect(0, 0, box[0], box[1])
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = new Range()
    range.getBoundingClientRect = () => new DOMRect(0, 0, text[0], text[1])
    return range
  })
  document.body.append(el)
  return el
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('isTruncated', () => {
  it('says no for text that fits', () => {
    expect(isTruncated(laidOut({}))).toBe(false)
  })

  it('says yes when the browser reports the overflow in whole pixels', () => {
    expect(isTruncated(laidOut({ scroll: [140, 20], text: [140, 20] }))).toBe(true)
  })

  // The case `scrollWidth` misses: both sizes round to 100.
  it('says yes for text that overflows by less than a pixel', () => {
    expect(isTruncated(laidOut({ box: [100.2, 20], text: [100.6, 20] }))).toBe(true)
  })

  it('does not call rounding an overflow', () => {
    expect(isTruncated(laidOut({ box: [100.2, 20], text: [100.205, 20] }))).toBe(false)
  })

  it('catches a clamp that hides lines', () => {
    expect(isTruncated(laidOut({ box: [100, 40], client: [100, 40], scroll: [100, 40], text: [100, 60] }))).toBe(true)
  })
})

describe('titleIfTruncated', () => {
  it('gives cut-off text its full text as a title, and takes it away once it fits', () => {
    const el = laidOut({ scroll: [140, 20], text: [140, 20] })
    const enter = () => titleIfTruncated({ currentTarget: el } as unknown as PointerEvent<HTMLElement>)

    enter()
    expect(el.title).toBe('a long conversation title')

    Object.defineProperty(el, 'scrollWidth', { value: 100 })
    vi.mocked(document.createRange).mockImplementation(() => {
      const range = new Range()
      range.getBoundingClientRect = () => new DOMRect(0, 0, 90, 20)
      return range
    })
    enter()
    expect(el.hasAttribute('title')).toBe(false)
  })
})
