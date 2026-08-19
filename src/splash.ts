import { invoke } from '@tauri-apps/api/core'

import { DURATION_MS, R_RING, STATIC_ARC, clamp01, frameAt, prefersReducedMotion } from '@/lib/meridian-ring'

/**
 * The splash window's whole program.
 *
 * Its own entry point rather than a route inside the app: this has to be on
 * screen while the main window's bundle is still being parsed, so it must not
 * share that bundle. What it does share is `lib/meridian-ring` — the animation
 * is defined once, and the two windows cannot drift apart.
 *
 * It says when its animation has finished and nothing else. Deciding when the
 * window closes belongs to the shell, which is the only side that knows
 * whether the app behind it is ready — see `src-tauri/src/splash.rs`.
 */

const star = document.getElementById('star')
const segments = [document.getElementById('seg0'), document.getElementById('seg1')]

function settle() {
  star?.setAttribute('r', String(R_RING))
  star?.setAttribute('opacity', '1')
  segments[0]?.setAttribute('d', STATIC_ARC)
  segments[1]?.setAttribute('d', '')
}

function announceDone() {
  // Failure is deliberately silent. A splash that cannot reach the backend is
  // already being cleaned up by the timeout on the other side, and an error
  // dialog over a launch screen helps nobody.
  void invoke('splash_animation_done').catch(() => {})
}

if (prefersReducedMotion()) {
  settle()
  announceDone()
} else {
  const start = performance.now()
  const tick = (now: number) => {
    const t = clamp01((now - start) / DURATION_MS)
    if (t < 1) {
      const frame = frameAt(t)
      star?.setAttribute('r', frame.rStar.toFixed(2))
      star?.setAttribute('opacity', frame.starOpacity.toFixed(3))
      segments.forEach((el, i) => el?.setAttribute('d', frame.segments[i] ?? ''))
      requestAnimationFrame(tick)
    } else {
      settle()
      announceDone()
    }
  }
  requestAnimationFrame(tick)
}
