import { useEffect, useEffectEvent, useId, useRef } from 'react'

import { attachHistory, goBack, pushHistoryLevel } from '@/lib/history-bridge'
import { usePlatform } from '@/hooks/use-platform'
import { useHistoryStore } from '@/stores/history-store'

/**
 * Hands the back gesture to the level stack, on the platforms that have one.
 *
 * Called once, by the shell. Android's back key is routed through
 * `WebView.canGoBack()` by `MainActivity`, and iOS's edge swipe arrives the
 * same way, so both reach us as `popstate`. A desktop window has no such
 * gesture to claim. `null` is the frame before the platform is known and counts
 * as not ours — nothing is open that early, and attaching late costs nothing.
 *
 * Both halves are driven from the same value on purpose: a listener without the
 * flag would settle a stack nobody is pushing to, and the flag without the
 * listener would push entries nobody ever hears about again.
 */
export function useBackGesture(): void {
  const platform = usePlatform()
  const owned = platform === 'android' || platform === 'ios'

  useEffect(() => {
    if (!owned) return
    useHistoryStore.getState().setEnabled(true)
    const detach = attachHistory()
    return () => {
      useHistoryStore.getState().setEnabled(false)
      detach()
    }
  }, [owned])
}

/**
 * Claims one history entry for as long as `isOpen`.
 *
 * For the levels that live inside a screen — a detail pane, a drawer, a
 * non-empty selection — so that the back gesture undoes them one at a time
 * before the screen itself goes away. React state stays the source of truth and
 * history only mirrors it, which is why this cannot drift: there is no second
 * copy of "is the drawer open".
 *
 * Three ways out, and they must not run into each other:
 *
 * - **Back gesture.** `popstate` → `settleTo` drops the level and calls
 *   `dismiss`, which is `onClose`. The ref is cleared first, so the effect that
 *   then sees `isOpen === false` knows history has already moved.
 * - **Closed from React.** The effect drops the level and consumes its own
 *   entry with `goBack(1)`. The level is gone before that lands, so the
 *   resulting `popstate` cannot call `onClose` a second time.
 * - **Unmounted while open.** Drops the level but leaves the entry behind: a
 *   `history.back()` during cleanup is asynchronous and races whatever unmounted
 *   us. The cost is one back press that appears to do nothing, and it heals
 *   itself — `settleTo` converges on an absolute depth, so the stale entry is
 *   absorbed rather than accumulated.
 *
 * A no-op wherever {@link useBackGesture} did not claim the gesture, which is
 * every desktop and every unit test.
 */
export function useHistoryLevel(isOpen: boolean, onClose: () => void): void {
  const enabled = useHistoryStore((s) => s.enabled)
  const id = useId()

  const registeredRef = useRef(false)
  // An inline callback must stay fresh without becoming an effect dependency:
  // re-running this effect while open would re-push the same history level.
  const closeCurrent = useEffectEvent(onClose)

  useEffect(() => {
    if (!enabled) return
    const store = useHistoryStore.getState()

    if (isOpen && !registeredRef.current) {
      registeredRef.current = true
      store.push({
        id,
        dismiss: () => {
          registeredRef.current = false
          closeCurrent()
        },
      })
      pushHistoryLevel(useHistoryStore.getState().levels.length)
      return
    }

    if (!isOpen && registeredRef.current) {
      registeredRef.current = false
      store.drop(id)
      goBack(1)
    }
  }, [isOpen, enabled, id])

  useEffect(() => {
    if (!enabled) return
    return () => {
      if (!registeredRef.current) return
      registeredRef.current = false
      useHistoryStore.getState().drop(id)
    }
  }, [enabled, id])
}
