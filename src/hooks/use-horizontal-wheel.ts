import { useCallback, useRef } from 'react'

/** One "line" of a line-mode wheel, in px; what Chromium scrolls per notch. */
const LINE = 16

/**
 * Lets a mouse wheel scroll a row sideways.
 *
 * A row that scrolls only horizontally is unreachable with an ordinary wheel,
 * which only sends vertical movement. This turns that movement sideways while
 * the row can still move that way — and only then: at either end, and on a row
 * with nothing hidden, the event is left alone so the page behind it scrolls
 * as it would anywhere else. A gesture that is already mostly horizontal (a
 * trackpad, a tilt wheel) is the browser's own, and so is Ctrl+wheel, which is
 * zoom.
 *
 * A callback ref, because the listener has to be non-passive to cancel the
 * vertical scroll, and React's `onWheel` is registered passive.
 */
export function useHorizontalWheel<T extends HTMLElement>() {
  const detach = useRef<(() => void) | null>(null)

  return useCallback((el: T | null) => {
    detach.current?.()
    detach.current = null
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * LINE
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * el.clientWidth
            : event.deltaY
      const next = Math.min(max, Math.max(0, el.scrollLeft + delta))
      // Under a pixel is the end of the row (scrollLeft is fractional).
      if (Math.abs(next - el.scrollLeft) < 1) return
      event.preventDefault()
      el.scrollLeft = next
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    detach.current = () => el.removeEventListener('wheel', onWheel)
  }, [])
}
