import { useCallback, useRef } from 'react'

/**
 * Keeps the viewport still when a turn collapses above the fold.
 *
 * The scroller absorbs height changes in `follow`, where re-sticking to the live
 * edge takes care of them. In `idle` — the reader has scrolled back through
 * history, and nothing may move without them — nothing compensates, and the
 * transcript yanks upward by however much the collapsed region shed.
 *
 * `scrollToMessage` looks like the fix and is not: it is a command, and a
 * command announces itself. It re-solves the spacer and parks the reader at a
 * row they never asked to be taken to. This adjusts `scrollTop` by exactly what
 * the collapse removed and leaves the scroller's state machine untouched.
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
