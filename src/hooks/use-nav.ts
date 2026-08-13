import { createContext, useCallback, useContext, useEffect, useEffectEvent, useId, useMemo, useRef } from 'react'
import { useStore } from 'zustand'

import { goBack, pushHistoryLevel } from '@/lib/history-bridge'
import { ROOT, type NavEntry, type NavStack } from '@/lib/nav'
import { useNavStore } from '@/stores/nav-store'

export type NavMode = 'stack' | 'panes'

export interface Nav {
  /** `stack` on a phone, `panes` anywhere the sidebar is always visible. */
  readonly mode: NavMode
  readonly top: NavEntry
  readonly stack: NavStack
  readonly canGoBack: boolean
  push: (entry: NavEntry) => void
  replaceTop: (entry: NavEntry) => void
  back: () => void
  /** Returns to the conversation, however deep the stack got. */
  popToRoot: () => void
}

const PANES: Nav = {
  mode: 'panes',
  top: ROOT,
  stack: [ROOT] as NavStack,
  canGoBack: false,
  push: () => {},
  replaceTop: () => {},
  back: () => {},
  popToRoot: () => {},
}

const NavContext = createContext<Nav | null>(null)

export const NavProvider = NavContext.Provider

/**
 * The navigation stack, or a no-op stand-in when there is no provider.
 *
 * Deliberately does *not* throw without a provider, unlike `useSidebar`. Panels
 * are rendered directly in unit tests and on the desktop, and neither has a
 * stack; making them all wrap a provider would buy nothing but churn. Please
 * leave it this way — turning this into an invariant breaks the settings tests
 * with no gain.
 */
export function useNav(): Nav {
  return useContext(NavContext) ?? PANES
}

/** Builds the live stack implementation. Only the mobile shell calls this. */
export function useStackNav(): Nav {
  const stack = useStore(useNavStore, (s) => s.stack)
  const depth = useStore(useNavStore, (s) => s.depth)

  const push = useCallback((entry: NavEntry) => {
    useNavStore.getState().push(entry)
    pushHistoryLevel(useNavStore.getState().depth)
  }, [])

  const replaceTop = useCallback((entry: NavEntry) => {
    // No history change: the entry count is the same, only its label differs.
    useNavStore.getState().replaceTop(entry)
  }, [])

  // Both of these go through history rather than the store, so that a tap on a
  // back arrow and a press of the hardware key follow the exact same path.
  const back = useCallback(() => {
    if (useNavStore.getState().depth > 0) goBack(1)
  }, [])

  const popToRoot = useCallback(() => {
    const d = useNavStore.getState().depth
    if (d > 0) goBack(d)
  }, [])

  return useMemo<Nav>(() => ({
    mode: 'stack',
    stack,
    top: stack[stack.length - 1],
    canGoBack: depth > 0,
    push,
    replaceTop,
    back,
    popToRoot,
  }), [stack, depth, push, replaceTop, back, popToRoot])
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
 * - **Back gesture.** `popstate` → `settleTo` drops the guard and calls
 *   `dismiss`, which is `onClose`. The ref is cleared first, so the effect that
 *   then sees `isOpen === false` knows history has already moved.
 * - **Closed from React.** The effect drops the guard and consumes its own
 *   entry with `goBack(1)`. The guard is gone before that lands, so the
 *   resulting `popstate` cannot call `onClose` a second time.
 * - **Unmounted while open.** Drops the guard but leaves the entry behind: a
 *   `history.back()` during cleanup is asynchronous and races whatever unmounted
 *   us. The cost is one back press that appears to do nothing, and it heals
 *   itself — `settleTo` converges on an absolute depth, so the stale entry is
 *   absorbed rather than accumulated.
 *
 * A no-op in `panes` mode.
 */
export function useHistoryLevel(isOpen: boolean, onClose: () => void): void {
  const { mode } = useNav()
  const id = useId()

  const registeredRef = useRef(false)
  // An inline callback must stay fresh without becoming an effect dependency:
  // re-running this effect while open would re-push the same history level.
  const closeCurrent = useEffectEvent(onClose)

  useEffect(() => {
    if (mode !== 'stack') return
    const store = useNavStore.getState()

    if (isOpen && !registeredRef.current) {
      registeredRef.current = true
      store.registerGuard({
        id,
        dismiss: () => {
          registeredRef.current = false
          closeCurrent()
        },
      })
      pushHistoryLevel(useNavStore.getState().depth)
      return
    }

    if (!isOpen && registeredRef.current) {
      registeredRef.current = false
      store.dropGuard(id)
      goBack(1)
    }
  }, [isOpen, mode, id])

  useEffect(() => {
    if (mode !== 'stack') return
    return () => {
      if (!registeredRef.current) return
      registeredRef.current = false
      useNavStore.getState().dropGuard(id)
    }
  }, [mode, id])
}
