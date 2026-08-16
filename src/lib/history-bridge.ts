import { useHistoryStore } from '@/stores/history-store'

/**
 * The only place in the app that touches `window.history`.
 *
 * Two rules make the level stack and the browser agree:
 *
 * 1. **Nothing pops the store directly.** Every "go back" — a dismissed drawer,
 *    a detail pane closed from React, the hardware key — calls {@link goBack},
 *    and the store only changes when `popstate` comes back. One writer, so the
 *    two cannot drift apart.
 * 2. **No URL is ever written.** `pushState` takes only a state object; the
 *    address never changes. A path would have to survive Tauri's asset
 *    protocol in production, and a hash would hit the `hashchange → reload`
 *    listener in `main.tsx` during browser development.
 *
 * The state payload carries a depth and nothing else. History state survives a
 * WebView process being killed while React state does not, so anything richer
 * in there would invite restoring from a snapshot that no longer matches — a
 * bug that only ever shows up on a real device. Depth is a checksum, not a
 * source of truth.
 */

const DEPTH_KEY = '__meridianDepth'

function readDepth(state: unknown): number {
  if (state && typeof state === 'object' && DEPTH_KEY in state) {
    const raw = (state as Record<string, unknown>)[DEPTH_KEY]
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw)
  }
  // The entry the app started on, or anything else that got here first.
  return 0
}

/** Adds one history entry. Call after the store has grown by one level. */
export function pushHistoryLevel(depth: number): void {
  window.history.pushState({ [DEPTH_KEY]: depth }, '')
}

/**
 * Steps back `count` entries.
 *
 * A single `go(-n)` rather than n × `back()`: the browser coalesces them into
 * one `popstate`, which `settleTo` is written to absorb.
 *
 * Never call this at depth 0. There is no entry of ours left to consume, so the
 * WebView would hand the gesture to Android and close the app.
 */
export function goBack(count = 1): void {
  if (count <= 0) return
  window.history.go(-count)
}

/**
 * Starts feeding `popstate` into the store. Returns the detach function.
 *
 * Mounted only where the gesture is ours — see `useBackGesture`. On a desktop
 * the back gesture belongs to the window, not to us.
 */
export function attachHistory(): () => void {
  const onPopState = (e: PopStateEvent) => {
    useHistoryStore.getState().settleTo(readDepth(e.state))
  }
  window.addEventListener('popstate', onPopState)
  return () => window.removeEventListener('popstate', onPopState)
}

export const __testing = { DEPTH_KEY, readDepth }
