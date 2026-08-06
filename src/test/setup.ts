/// <reference types="vitest/globals" />
import { createElement } from 'react'
import '@testing-library/jest-dom/vitest'

// `@lobehub/icons`' entry point re-exports its doc-site components, which reach
// `@lobehub/ui` and from there a JSON module that Node's ESM loader refuses
// without an import attribute. Vite handles it for the browser build, but
// running the whole icon set through that transform costs the suite ~18s — and
// which logo a provider draws is not what any of these tests are about.
vi.mock('@lobehub/icons', () => ({
  ModelIcon: ({ model }: { model?: string }) =>
    createElement('span', { 'data-slot': 'model-icon', 'data-model': model }),
}))

// jsdom ships neither observer. Components that animate on scroll (DecryptedText
// via framer-motion's inView) throw on mount without them, and the failure
// surfaces as an ErrorBoundary fallback rather than the component under test.
if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver
}

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
