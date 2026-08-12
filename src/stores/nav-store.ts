import { create } from 'zustand'

import { ROOT, type NavEntry, type NavGuard, type NavStack } from '@/lib/nav'

/**
 * The mobile navigation stack, as a pure reducer.
 *
 * Deliberately knows nothing about `window.history` — that lives in
 * `lib/history-bridge.ts`, which is the only writer of browser history and the
 * only listener of `popstate`. Keeping them apart is what makes the rules below
 * testable without a DOM.
 *
 * Two levels stack here. Routes are screens; guards are levels inside a screen
 * (an open drawer, a detail pane, a non-empty selection). Guards always sit
 * above routes, LIFO — an inner one is registered after the outer one because
 * it mounts later.
 *
 * The invariant tying this to history: `depth === stack.length - 1 +
 * guards.length`, and that number is the count of history entries we have
 * pushed.
 */
export interface NavState {
  stack: NavStack
  guards: readonly NavGuard[]
  depth: number

  push: (entry: NavEntry) => void
  replaceTop: (entry: NavEntry) => void
  registerGuard: (guard: NavGuard) => void
  /** Drops a guard without running its `dismiss` — the component already did. */
  dropGuard: (id: string) => void
  /**
   * Converge on `target` history entries.
   *
   * Not `pop()`: `history.go(-3)` fires a single `popstate`, so the handler has
   * to be able to shed three levels at once. Reading an absolute depth rather
   * than applying a relative step also makes a burst of back presses safe —
   * each event settles to its own target instead of compounding.
   */
  settleTo: (target: number) => void
}

function depthOf(stack: NavStack, guards: readonly NavGuard[]): number {
  return stack.length - 1 + guards.length
}

export const useNavStore = create<NavState>((set, get) => ({
  stack: [ROOT] as NavStack,
  guards: [],
  depth: 0,

  push: (entry) =>
    set((s) => {
      const stack = [...s.stack, entry] as unknown as NavStack
      return { stack, depth: depthOf(stack, s.guards) }
    }),

  replaceTop: (entry) =>
    set((s) => {
      if (s.stack.length === 1) return s
      const stack = [...s.stack.slice(0, -1), entry] as unknown as NavStack
      return { stack, depth: depthOf(stack, s.guards) }
    }),

  registerGuard: (guard) =>
    set((s) => {
      // Idempotent by id: StrictMode mounts effects twice with the same
      // `useId`, and without this every detail pane would cost two entries in
      // development.
      if (s.guards.some((g) => g.id === guard.id)) return s
      const guards = [...s.guards, guard]
      return { guards, depth: depthOf(s.stack, guards) }
    }),

  dropGuard: (id) =>
    set((s) => {
      const guards = s.guards.filter((g) => g.id !== id)
      if (guards.length === s.guards.length) return s
      return { guards, depth: depthOf(s.stack, guards) }
    }),

  settleTo: (target) => {
    const clamped = Math.max(0, target)
    // Guards first and one at a time: each `dismiss` is the component's own
    // setState, and an inner guard may be what keeps an outer one alive.
    while (depthOf(get().stack, get().guards) > clamped && get().guards.length > 0) {
      const guards = get().guards
      const top = guards[guards.length - 1]
      set({ guards: guards.slice(0, -1), depth: depthOf(get().stack, guards.slice(0, -1)) })
      top.dismiss()
    }
    // Then routes, in one write — nothing observes the intermediate stacks.
    const s = get()
    if (depthOf(s.stack, s.guards) > clamped) {
      const keep = Math.max(1, clamped + 1 - s.guards.length)
      const stack = s.stack.slice(0, keep) as unknown as NavStack
      set({ stack, depth: depthOf(stack, s.guards) })
    }
  },
}))
