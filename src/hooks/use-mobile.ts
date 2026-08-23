import * as React from 'react'

// Inclusive, matching Pro: its sidebar CSS hides the panel at
// `@media (max-width: 768px)` and offers the drawer instead. This was `< 768`,
// and on that one pixel the sidebar was already a drawer while the app was
// still drawing the desktop — the changes toggle was offered, and the header
// buttons shrank to their pointer size.
const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`

/**
 * Whether this is a phone-sized *viewport*, and nothing more.
 *
 * It does not answer "is there room for two columns here". Settings is a layer
 * over the chat and its width is the window minus the 240px sidebar, so between
 * 768 and 1000px the viewport says desktop while the container holds 530–760px:
 * `MasterDetail`'s detail column came out at ~280px in a 769px window, with four
 * price fields inside it at 130px each. Ask {@link useIsNarrow} for that — it
 * measures the box that actually constrains the content.
 *
 * The two callers left are genuinely about the viewport. `app-shell` decides
 * whether the changes panel may mount at all, which is a question about the
 * device rather than about any one pane. `settings-drilldown` picks between a
 * modal and an inline section, and there is no box that exists in both layouts
 * to measure — its own pane is capped at `max-w-lg`, so the two answers only
 * ever disagree where neither is wrong.
 */
export function useIsMobile() {
  // One source for the answer. This used to subscribe to the media query and
  // then read `window.innerWidth` on every change, which is two definitions of
  // the same boundary that a stub — or a browser rounding a fractional
  // viewport — can disagree about.
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia(MOBILE_QUERY).matches)

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    // Re-read on subscribe: the width can have moved between the first render
    // and this effect, and nothing would announce that.
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
