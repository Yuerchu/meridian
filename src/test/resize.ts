/**
 * A `ResizeObserver` that can be told what happened.
 *
 * jsdom does no layout, so `clientWidth` is 0 for every element and nothing
 * ever resizes. That is fine for the code that merely tolerates a missing
 * observer, and useless for `useIsNarrow`, whose whole answer is a width.
 *
 * The alternative was a test-only input on the hook itself. This lies to the
 * environment instead: it lives under `src/test`, keeps the shape of the real
 * thing, and leaves the product with exactly one path through it. A branch only
 * tests take is a branch nothing proves equal to the real one — and the
 * `matchMedia` stub beside this one already set the precedent.
 *
 * Default behaviour is unchanged from the empty stub it replaces: an observer
 * never fires on its own. It fires when a test says a particular element is now
 * a particular width, and only for the observers actually watching it.
 */

type Watcher = { el: Element; notify: () => void }

const watchers = new Set<Watcher>()

/**
 * Installs the stub. Idempotent, and only where jsdom left the class missing —
 * a real implementation, should one ever appear, wins.
 */
export function installResizeObserverStub(): void {
  if ('ResizeObserver' in globalThis) return

  class ProgrammableResizeObserver implements ResizeObserver {
    #callback: ResizeObserverCallback
    #mine = new Set<Watcher>()

    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback
    }

    observe(el: Element) {
      // The entry is deliberately not built here: `setContainerWidth` is the
      // only thing that knows a size, and a first callback carrying zeroes
      // would tell every observer the box is empty the moment it starts
      // watching. The real thing fires on observe; this one cannot say
      // anything true yet, so it says nothing.
      const watcher = { el, notify: () => this.#callback([], this) }
      this.#mine.add(watcher)
      watchers.add(watcher)
    }

    unobserve(el: Element) {
      for (const watcher of this.#mine) {
        if (watcher.el !== el) continue
        this.#mine.delete(watcher)
        watchers.delete(watcher)
      }
    }

    disconnect() {
      for (const watcher of this.#mine) watchers.delete(watcher)
      this.#mine.clear()
    }
  }

  globalThis.ResizeObserver = ProgrammableResizeObserver as unknown as typeof ResizeObserver
}

/**
 * Says an element is now this wide, and tells whoever is watching it.
 *
 * The width is written as the element's own `clientWidth` because that is what
 * the code under test reads. The callback carries no entries: a reader that
 * measures the node it was handed sees the new width, and one that trusts
 * `entry.contentRect` would be trusting a number this file made up.
 */
export function setContainerWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width })
  for (const watcher of watchers) {
    if (watcher.el === el) watcher.notify()
  }
}
