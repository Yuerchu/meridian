import { useHistoryStore } from '@/stores/history-store'

/**
 * The only place in the app that touches `window.history`.
 *
 * Two rules make the level stack and the browser agree:
 *
 * 1. **Nobody writes history directly.** Components change the store and then
 *    ask {@link syncHistory} to catch up; it is the only code that calls
 *    `pushState` or `go`. One writer, reconciling against an absolute depth,
 *    so the two cannot drift — and so two changes in one commit cannot issue
 *    two operations that undo each other.
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

let scheduled = false

/**
 * Brings `window.history` back in line with the level stack, once per tick.
 *
 * Every caller asks for the same thing — "make history match the store" — and
 * asks for it *after* changing the store. Nothing says how many entries to add
 * or remove, because no single caller knows: a hand-over changes the store
 * twice before anything runs.
 *
 * **Why it has to be deferred.** Tapping a row inside the mobile drawer closes
 * the drawer and opens a page in one commit. Applied eagerly that was
 * `go(-1)` from the drawer's effect followed by `pushState` from the page's,
 * and those do not commute: a queued traversal resolves against the entry that
 * was current when `go` was called, not the one current when the task runs. So
 * the traversal skipped the entry `pushState` had just added and landed on the
 * one *before* the drawer's, whose state is `null` — depth 0 — and `settleTo`
 * dutifully closed the page that had just opened. It read as the page flashing
 * and bouncing straight back.
 *
 * Coalesced, that pair nets to zero: one level left, one entry, nothing to do.
 * The general rule falls out of it — history is a mirror of `levels.length`,
 * and a mirror is only ever wrong between the change and the next microtask.
 */
export function syncHistory(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    const want = useHistoryStore.getState().levels.length
    const have = readDepth(window.history.state)
    // One `go(-n)` rather than n × `back()`: the browser coalesces them into a
    // single `popstate`, which `settleTo` is written to absorb. Going forward is
    // one entry at a time because each carries its own depth.
    if (want > have) {
      for (let depth = have + 1; depth <= want; depth++) {
        window.history.pushState({ [DEPTH_KEY]: depth }, '')
      }
    } else if (want < have) {
      window.history.go(want - have)
    }
  })
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
