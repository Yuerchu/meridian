import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from './use-mobile'

/**
 * The stub in `test/setup.ts` reads `innerWidth` on every match and notifies
 * its subscribers on `resize`, so driving it is the same two steps a real
 * browser takes. Nothing here knows it is a stub.
 */
function resizeTo(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

describe('useIsMobile', () => {
  it('returns true when window width < 768', () => {
    resizeTo(500)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false when window width >= 768', () => {
    resizeTo(1024)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('updates when the viewport crosses the breakpoint', () => {
    resizeTo(1024)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      resizeTo(500)
    })
    expect(result.current).toBe(true)
  })
})
