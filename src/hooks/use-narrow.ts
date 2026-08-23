import * as React from 'react'

/**
 * Whether a particular box is too narrow for a layout, measured rather than
 * inferred from the viewport.
 *
 * The viewport is the wrong ruler wherever something else already took width
 * away. Settings is the case that forced this: it is a layer over the chat, so
 * its width is the window minus the 240px sidebar, and a 769px window leaves it
 * 519px — a desktop by {@link useIsMobile} and a phone by the only measure that
 * matters. The same window with the sidebar collapsed to icons leaves 703px,
 * which really does fit two columns. Nothing about the viewport tells those two
 * apart.
 *
 * `fallback` is not a seed for the first frame — it is the answer for as long
 * as there is no measurement, and it is re-read on every render. Two things
 * produce no measurement: a `ref` that was never attached (every `renderHook`
 * test), and a box with no width (jsdom, `display: none`, a detached node).
 * Both mean the container has nothing to say, and the viewport is then the only
 * thing that still knows something.
 *
 * **The measured box must not depend on the answer.** Hang this on something
 * whose width is decided from above — never on the column that the answer
 * decides whether to render, which would feed the observer its own output.
 */
export function useIsNarrow(
  minWidth: number,
  fallback: boolean,
): { ref: (node: HTMLElement | null) => void; isNarrow: boolean } {
  // The boolean, not the width. A drag reports every intermediate pixel and
  // only the crossings change what is rendered.
  const [narrow, setNarrow] = React.useState<boolean | null>(null)

  // Read inside the ref callback, which only re-runs when the node changes — so
  // the threshold cannot be a dependency of it without re-observing on every
  // render that happens to pass a fresh one.
  const min = React.useRef(minWidth)
  min.current = minWidth

  const ref = React.useCallback((node: HTMLElement | null) => {
    if (!node) {
      setNarrow(null)
      return
    }

    const measure = () => {
      const width = node.clientWidth
      // Zero is "not measured", not "very narrow". It is what a detached node,
      // a `display: none` ancestor and an environment that does no layout at
      // all all report, and reading it as a width would put every one of them
      // into the narrow layout on the strength of no evidence.
      setNarrow(width > 0 ? width < min.current : null)
    }

    // In the commit phase the DOM is in place and the browser has not painted,
    // so this measurement lands before anything is on screen: `fallback` is the
    // long-run answer where nothing can be measured, not a frame anyone sees.
    measure()

    if (typeof ResizeObserver === 'undefined') return
    // The entry is only a signal that something moved; the width always comes
    // from `clientWidth`. One measurement path means the first read and every
    // later one agree, and `clientWidth` is the integer content box — which is
    // the number the threshold is written in.
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
      setNarrow(null)
    }
  }, [])

  return { ref, isNarrow: narrow ?? fallback }
}
