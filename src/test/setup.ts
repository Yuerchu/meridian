/// <reference types="vitest/globals" />
import { createElement } from 'react'
import '@testing-library/jest-dom/vitest'

import { installResizeObserverStub } from './resize'

// `@lobehub/icons`' entry point re-exports its doc-site components, which reach
// `@lobehub/ui` and from there a JSON module that Node's ESM loader refuses
// without an import attribute. Vite handles it for the browser build, but
// running the whole icon set through that transform costs the suite ~18s — and
// which logo a provider draws is not what any of these tests are about.
vi.mock('@lobehub/icons', () => ({
  ModelIcon: ({ model }: { model?: string }) =>
    createElement('span', { 'data-slot': 'model-icon', 'data-model': model }),
  ProviderIcon: ({ provider }: { provider?: string }) =>
    createElement('span', { 'data-slot': 'provider-icon', 'data-provider': provider }),
  // Three of the hundred and fifty, which is enough for the picker to have a
  // list, a filter that excludes something, and a name to choose.
  ModelProvider: { Anthropic: 'anthropic', OpenAI: 'openai', VertexAI: 'vertexai' },
}))

// jsdom ships neither observer. `message-scroller` uses both — an
// IntersectionObserver to know which rows are on screen, a ResizeObserver to
// re-solve the spacer — and while it degrades rather than throws when they are
// missing, that degraded path is not the one under test.
if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver
}

// The ResizeObserver half is programmable — see `test/resize.ts`. It still
// never fires on its own, so everything that merely wants the class to exist is
// unaffected; what it adds is `setContainerWidth`, which is the only way a test
// can hand `useIsNarrow` a width in an environment that does no layout.
installResizeObserverStub()

// jsdom implements none of the Web Animations API. React Aria's
// `SharedElementTransition` — which is what `Tabs.Indicator` slides with —
// calls `element.getAnimations()` in a layout effect, so without this every
// component carrying a selection indicator throws on mount rather than
// degrading. An empty list is the honest answer: nothing is animating, because
// nothing here can.
if (typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => []
}

// jsdom has `PointerEvent` but none of pointer capture. A sheet's drag handle
// captures on pointerdown so a finger that slides off the pill keeps dragging;
// here the capture is a no-op and `fireEvent` addresses the handle directly.
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
}

// `useIsMobile` calls `matchMedia` and subscribes with `addEventListener`.
// Where jsdom has the method at all it returns a list that never matches and
// only carries the deprecated `addListener`, so the check is for a usable one
// rather than for its presence — anything that renders `useIsMobile` throws
// otherwise, which is why every test that reaches it has been mocking this by
// hand.
//
// Width comes from `window.innerWidth` on every read, so a test changes the
// viewport by assigning it; dispatching `resize` then notifies subscribers.
// That is the same shape the real thing has, which is what lets a test drive it
// without knowing it is a stub.
{
  const probe = window.matchMedia?.('(max-width: 100px)')
  if (typeof probe?.addEventListener !== 'function') {
    type Listener = (e: MediaQueryListEvent) => void
    const live = new Set<{ query: string; matches: () => boolean; listeners: Set<Listener> }>()

    window.addEventListener('resize', () => {
      for (const entry of live) {
        const event = { matches: entry.matches(), media: entry.query } as MediaQueryListEvent
        for (const fn of entry.listeners) fn(event)
      }
    })

    window.matchMedia = (query: string): MediaQueryList => {
      const max = /max-width:\s*(\d+)px/.exec(query)
      const min = /min-width:\s*(\d+)px/.exec(query)
      const matches = () => {
        if (max && window.innerWidth > Number(max[1])) return false
        if (min && window.innerWidth < Number(min[1])) return false
        return Boolean(max || min)
      }
      const listeners = new Set<Listener>()
      live.add({ query, matches, listeners })
      return {
        media: query,
        get matches() {
          return matches()
        },
        onchange: null,
        addEventListener: (_type: string, fn: Listener) => {
          listeners.add(fn)
        },
        removeEventListener: (_type: string, fn: Listener) => {
          listeners.delete(fn)
        },
        addListener: (fn: Listener) => {
          listeners.add(fn)
        },
        removeListener: (fn: Listener) => {
          listeners.delete(fn)
        },
        dispatchEvent: () => true,
      } as unknown as MediaQueryList
    }
  }
}
