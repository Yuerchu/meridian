import type { PointerEvent } from 'react'

/**
 * Below this, a difference between the text and its box is rounding, not
 * clipping. Layout widths are fractional and the two are measured separately,
 * so text that fits exactly can come out a few thousandths wider.
 */
const ROUNDING = 0.01

function edges(style: CSSStyleDeclaration, a: 'Left' | 'Top', b: 'Right' | 'Bottom') {
  return (
    parseFloat(style[`padding${a}`]) +
    parseFloat(style[`padding${b}`]) +
    parseFloat(style[`border${a}Width`]) +
    parseFloat(style[`border${b}Width`])
  )
}

/**
 * Whether CSS is cutting this element's text off — `truncate` (one line) or
 * `line-clamp-*` (several).
 *
 * `scrollWidth > clientWidth` is the usual test and misses a case: both are
 * rounded to whole pixels, so text that overflows by less than one is drawn
 * with an ellipsis and reported as fitting. The text's own extent, measured
 * with a `Range` over the element's contents, is fractional; that is compared
 * with the content box, past a rounding allowance in the other direction. A
 * range covers the lines a clamp hides as well as the ones it shows, so the
 * same comparison on height catches `line-clamp`.
 */
export function isTruncated(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) return true
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  // jsdom has no layout and no `Range.getBoundingClientRect`.
  if (typeof range.getBoundingClientRect !== 'function') return false
  const text = range.getBoundingClientRect()
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return (
    text.width - (box.width - edges(style, 'Left', 'Right')) > ROUNDING ||
    text.height - (box.height - edges(style, 'Top', 'Bottom')) > ROUNDING
  )
}

/**
 * `onPointerEnter` for an element whose text CSS may cut off: the full text
 * becomes its native `title`, and only while it is actually cut off.
 *
 * Measured when the pointer arrives rather than kept up to date, because a
 * list of a few hundred rows each watching its own width is a few hundred
 * observers for a question nobody asks until they hover. The browser waits
 * before it draws a title, so one set here is in place in time. A `title`
 * rather than a tooltip, per the UI conventions: this is plain overflow text,
 * and a tooltip would need a focusable wrapper for each one. Text a keyboard
 * user needs too takes `ui/hint.tsx` instead.
 *
 * Not for an element that has a `title` of its own; this one would replace it.
 */
export function titleIfTruncated(event: PointerEvent<HTMLElement>) {
  const el = event.currentTarget
  if (isTruncated(el)) el.title = el.textContent ?? ''
  else el.removeAttribute('title')
}
