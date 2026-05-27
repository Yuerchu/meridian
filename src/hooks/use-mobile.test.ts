import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from './use-mobile'

describe('useIsMobile', () => {
  let listeners: Array<() => void> = []

  const mockMatchMedia = (matches: boolean) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: matches ? 500 : 1024,
    })

    window.matchMedia = vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        listeners.push(handler)
      }),
      removeEventListener: vi.fn(),
    })
  }

  beforeEach(() => {
    listeners = []
  })

  it('returns true when window width < 768', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false when window width >= 768', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('updates when media query changes', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    })
    act(() => {
      listeners.forEach((fn) => fn())
    })
    expect(result.current).toBe(true)
  })
})
