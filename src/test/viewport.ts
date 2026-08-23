/**
 * Drives the viewport for a test.
 *
 * The `matchMedia` stub in `setup.ts` reads `innerWidth` on every match and
 * notifies its subscribers on `resize`, so these are the same two steps a real
 * browser takes and nothing under test knows it is a stub.
 *
 * Kept here rather than in each test file because two suites drive the viewport
 * and one of them had grown its own copy — one whose `matches` was a frozen
 * constant, so it only moved when the test remembered to call the listener by
 * hand. Two stubs for one thing is how they come to disagree.
 */
export function resizeViewportTo(width: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}
