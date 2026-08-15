import { create } from 'zustand'

/**
 * A level that the back gesture can undo, as a pure reducer.
 *
 * There used to be two things stacked here — screens and the levels inside
 * them. The screens are gone: one shell now serves every platform, the
 * conversation list is the sidebar's mobile sheet and settings is a page beside
 * the chat, so nothing pushes a route any more. What is left is the part that
 * was never about layout: a drawer, a detail pane, a non-empty selection, each
 * wanting the back gesture to undo it before whatever is underneath.
 *
 * Deliberately knows nothing about `window.history` — that lives in
 * `lib/history-bridge.ts`, which is the only writer of browser history and the
 * only listener of `popstate`. Keeping them apart is what makes the rules below
 * testable without a DOM.
 *
 * The invariant tying this to history: `levels.length` is the number of history
 * entries we have pushed.
 */
export interface HistoryLevel {
  /** From `useId()`, so StrictMode's double mount registers once. */
  readonly id: string
  readonly dismiss: () => void
}

export interface HistoryState {
  /**
   * Whether the back gesture is ours to intercept.
   *
   * Set once by the shell, from the platform. A desktop window has no back
   * gesture to claim, so every level below is a no-op there — which is also
   * what makes it safe to call `useHistoryLevel` from a panel rendered
   * straight into a unit test.
   */
  enabled: boolean
  levels: readonly HistoryLevel[]

  setEnabled: (enabled: boolean) => void
  push: (level: HistoryLevel) => void
  /** Drops a level without running its `dismiss` — the component already did. */
  drop: (id: string) => void
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

export const useHistoryStore = create<HistoryState>((set, get) => ({
  enabled: false,
  levels: [],

  setEnabled: (enabled) => set((s) => (s.enabled === enabled ? s : { enabled })),

  push: (level) =>
    set((s) => {
      // Idempotent by id: StrictMode mounts effects twice with the same
      // `useId`, and without this every detail pane would cost two entries in
      // development.
      if (s.levels.some((l) => l.id === level.id)) return s
      return { levels: [...s.levels, level] }
    }),

  drop: (id) =>
    set((s) => {
      const levels = s.levels.filter((l) => l.id !== id)
      return levels.length === s.levels.length ? s : { levels }
    }),

  settleTo: (target) => {
    const clamped = Math.max(0, target)
    // One at a time, and dropped before dismissing: each `dismiss` is the
    // component's own setState, and an inner level may be what keeps an outer
    // one alive.
    while (get().levels.length > clamped) {
      const levels = get().levels
      const top = levels[levels.length - 1]
      set({ levels: levels.slice(0, -1) })
      top.dismiss()
    }
  },
}))
