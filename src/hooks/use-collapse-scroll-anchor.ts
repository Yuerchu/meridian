import { useCallback, useRef } from 'react'

/**
 * Keeps the viewport still when a turn collapses above the fold.
 *
 * The scroller compensates for height changes on its own in two of its four
 * modes: it re-anchors when pinned to a message, and re-sticks to the bottom
 * when following it. In `free-scrolling` — the user has scrolled back through
 * history — nothing compensates, and the page yanks upward by however much the
 * collapsed region shed.
 *
 * `scrollToMessage` looks like the fix and is not: it routes to `scrollToElement`
 * without `keepPreviousPeek`, which drops the scroller into `settling-jump` and
 * clears its anchor. Every later height change then goes uncompensated, and
 * `settling-jump` is excluded from the return to `following-bottom`, so the
 * scroller stays stuck there. This adjusts `scrollTop` directly and leaves the
 * scroller's state machine untouched.
 */
export function useCollapseScrollAnchor<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)

  const viewportOf = useCallback((el: HTMLElement): HTMLElement | null => {
    return el.closest('[data-slot="message-scroller-viewport"]')
  }, [])

  /** Whether the element fits entirely on screen; callers skip the collapse
   *  animation when it does not, so the correction lands in one layout pass. */
  const isFullyVisible = useCallback((): boolean => {
    const el = ref.current
    const vp = el && viewportOf(el)
    if (!el || !vp) return true
    const elRect = el.getBoundingClientRect()
    const vpRect = vp.getBoundingClientRect()
    return elRect.top >= vpRect.top && elRect.bottom <= vpRect.bottom
  }, [viewportOf])

  /**
   * Call immediately before collapsing. The returned function applies the
   * correction and must run after the DOM has settled — inside `useLayoutEffect`
   * or a `requestAnimationFrame`, once the panel has actually shrunk.
   */
  const beginCollapse = useCallback((): (() => void) => {
    const el = ref.current
    const vp = el && viewportOf(el)
    if (!el || !vp) return () => {}

    const beforeHeight = el.offsetHeight
    const topBefore = el.getBoundingClientRect().top - vp.getBoundingClientRect().top

    // Collapsing something at or below the fold pulls content up from underneath,
    // which is the point of collapsing. Only a collapse above the fold moves what
    // the user is currently reading.
    if (topBefore >= 0) return () => {}

    return () => {
      const shrunkBy = beforeHeight - el.offsetHeight
      if (shrunkBy > 0) vp.scrollTop -= shrunkBy
    }
  }, [viewportOf])

  return { ref, beginCollapse, isFullyVisible }
}
