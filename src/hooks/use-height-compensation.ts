import { useEffect, useRef } from 'react'

/**
 * Keeps the viewport still when something above the fold changes height.
 *
 * The scroller absorbs height changes in `follow`, where re-sticking to the
 * live edge takes care of them. In `idle` — the reader has scrolled back
 * through history, and nothing may move without them — nothing compensates,
 * and the transcript would lurch by however much the element grew or shed.
 * Two things do that above a reader: a keyboard panel closing on its own as
 * its tool finishes, and a turn that was a placeholder box being drawn as the
 * reader scrolls up into it.
 *
 * The browser has its own answer to this, scroll anchoring, and the viewport
 * turns it off: it nudges `scrollTop` by a device pixel while the scroller is
 * re-solving its spacer, and the scroller reads an upward nudge it did not
 * make as the reader taking over. So the compensation is done here, in one
 * place, by the same rule the scroller uses to decide who owns the viewport.
 *
 * `scrollToMessage` looks like the fix and is not: it is a command, and a
 * command announces itself. It re-solves the spacer and parks the reader at a
 * row they never asked to be taken to. This adjusts `scrollTop` by exactly the
 * change and leaves the scroller's state machine untouched.
 *
 * Measured rather than predicted. A `ResizeObserver` sees every change,
 * animated ones a frame at a time, and runs after layout and before paint —
 * so the correction lands in the same frame as the change it corrects and
 * nothing is ever drawn displaced.
 */
export function useHeightCompensation<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastHeight = el.offsetHeight
    const observer = new ResizeObserver(() => {
      const height = el.offsetHeight
      const delta = height - lastHeight
      lastHeight = height
      if (delta === 0) return
      const viewport = el.closest<HTMLElement>('[data-slot="message-scroller-viewport"]')
      if (!viewport || viewport.getAttribute('data-scroll-mode') !== 'idle') return
      // Only a change above the fold moves what the reader is looking at.
      // Something at or below it pushes or pulls content underneath, which is
      // what the reader would expect to see happen.
      if (el.getBoundingClientRect().top >= viewport.getBoundingClientRect().top) return
      viewport.scrollTop += delta
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}
