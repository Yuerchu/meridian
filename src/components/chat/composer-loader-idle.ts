import { useEffect, useState } from 'react'

/**
 * How long the registry's `ComposerLoader` takes to fade out: its clip span is
 * `transition: opacity 450ms ease`. Kept beside the one place that waits for it.
 */
export const LOADER_FADE_MS = 450

/**
 * Stops the loader's light from running while nobody can see it.
 *
 * `ComposerLoader` stays mounted around the composer for the life of the
 * conversation, and `active={false}` only takes its opacity to 0. Every `rect`
 * still carries an infinite `bui-composer-loader-dash` animation through three
 * `feGaussianBlur` filters, so an idle composer was repainting an invisible
 * blurred SVG on every frame — CPU and battery for nothing, most of all on a
 * phone.
 *
 * The rects' animation is an *inline* `animation` shorthand, which resets
 * `animation-play-state` to `running` at inline precedence; only an
 * `!important` declaration from a stylesheet outranks it, hence the `!`.
 */
export const LOADER_PAUSED = '[&_rect]:[animation-play-state:paused]!'

/**
 * True once the loader has been inactive long enough to have finished fading.
 *
 * Pausing the moment `active` drops would freeze the band mid-lap for the whole
 * 450ms fade — a still smear dimming out instead of light leaving. So the pause
 * waits out the fade, and lifting it is immediate: the fade-in has to start
 * with the band already moving.
 */
export function useLoaderSettledIdle(active: boolean): boolean {
  const [settled, setSettled] = useState(!active)
  useEffect(() => {
    if (active) {
      setSettled(false)
      return
    }
    const timer = window.setTimeout(() => setSettled(true), LOADER_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [active])
  return settled && !active
}
