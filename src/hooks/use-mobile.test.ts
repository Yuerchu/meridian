import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from './use-mobile'
import { resizeViewportTo } from '@/test/viewport'

describe('useIsMobile', () => {
  it('returns true below 768', () => {
    resizeViewportTo(500)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false above 768, where Sidebar still draws the panel', () => {
    resizeViewportTo(1024)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  // Sidebar hides the panel at `max-width: 768px`, which includes 768. This
  // used to be `< 768`, and on that one pixel the sidebar was already a drawer
  // while the app still believed it was on a desktop.
  it('counts 768 itself as mobile, where the sidebar has already gone to the drawer', () => {
    resizeViewportTo(768)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('updates when the viewport crosses the breakpoint', () => {
    resizeViewportTo(1024)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      resizeViewportTo(500)
    })
    expect(result.current).toBe(true)
  })
})
