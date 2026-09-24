/**
 * A programmable `IntersectionObserver`, for tests that need to say what is on
 * screen. `setup.ts` installs one that never fires, which is right for
 * everything that merely wants the class to exist; this one fires when told.
 *
 * `auto` decides what an element reports the moment it is observed — the
 * first callback a real observer delivers — and `intersect` changes it later.
 * Each observer keeps its options, so a test can address the "near" observer
 * (it has a margin) apart from the "visible" one (it has none).
 */

export interface MockObserver {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit
  targets: Set<Element>
}

export interface IntersectionControl {
  observers: MockObserver[]
  /** Report `el` to every observer watching it that `which` accepts. */
  intersect: (el: Element, isIntersecting: boolean, which?: (observer: MockObserver) => boolean) => void
  restore: () => void
}

export function installIntersectionObserver(
  auto: (el: Element, observer: MockObserver) => boolean | undefined = () => undefined,
): IntersectionControl {
  const real = globalThis.IntersectionObserver
  const observers: MockObserver[] = []

  const report = (observer: MockObserver, el: Element, isIntersecting: boolean) =>
    observer.callback(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    )

  class Mock {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
    #self: MockObserver
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      this.#self = { callback, options, targets: new Set() }
      observers.push(this.#self)
    }
    observe(el: Element) {
      this.#self.targets.add(el)
      const initial = auto(el, this.#self)
      if (initial !== undefined) queueMicrotask(() => this.#self.targets.has(el) && report(this.#self, el, initial))
    }
    unobserve(el: Element) {
      this.#self.targets.delete(el)
    }
    disconnect() {
      this.#self.targets.clear()
    }
    takeRecords() {
      return []
    }
  }
  globalThis.IntersectionObserver = Mock as unknown as typeof IntersectionObserver

  return {
    observers,
    intersect: (el, isIntersecting, which = () => true) => {
      for (const observer of observers) {
        if (observer.targets.has(el) && which(observer)) report(observer, el, isIntersecting)
      }
    },
    restore: () => {
      globalThis.IntersectionObserver = real
    },
  }
}

/** The playback scope's "near" observer is the one with a margin. */
export const isNearObserver = (observer: MockObserver) => Boolean(observer.options.rootMargin)
