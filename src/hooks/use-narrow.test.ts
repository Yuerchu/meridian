import { renderHook, act } from '@testing-library/react'
import { useIsNarrow } from './use-narrow'
import { setContainerWidth } from '@/test/resize'

describe('useIsNarrow', () => {
  it('answers from the fallback while no box has been attached', () => {
    const { result } = renderHook(() => useIsNarrow(500, true))
    expect(result.current.isNarrow).toBe(true)
  })

  it('re-reads the fallback rather than seeding from it', () => {
    const { result, rerender } = renderHook(({ fallback }) => useIsNarrow(500, fallback), {
      initialProps: { fallback: true },
    })
    expect(result.current.isNarrow).toBe(true)

    rerender({ fallback: false })
    expect(result.current.isNarrow).toBe(false)
  })

  it('lets a measured box overrule the fallback', () => {
    const { result } = renderHook(() => useIsNarrow(500, true))
    const box = document.createElement('div')

    act(() => {
      setContainerWidth(box, 900)
      result.current.ref(box)
    })
    expect(result.current.isNarrow).toBe(false)
  })

  it('reports narrow once the box drops below the threshold', () => {
    const { result } = renderHook(() => useIsNarrow(500, false))
    const box = document.createElement('div')

    act(() => {
      setContainerWidth(box, 900)
      result.current.ref(box)
    })
    expect(result.current.isNarrow).toBe(false)

    act(() => setContainerWidth(box, 420))
    expect(result.current.isNarrow).toBe(true)
  })

  // A zero-width box is what a detached node, a `display: none` ancestor and an
  // environment with no layout all report. Reading it as a width would put all
  // three into the narrow layout without having measured anything.
  it('treats a zero width as no measurement at all', () => {
    const { result } = renderHook(() => useIsNarrow(500, false))
    const box = document.createElement('div')

    act(() => result.current.ref(box))
    expect(result.current.isNarrow).toBe(false)
  })

  it('goes back to the fallback when the box is detached', () => {
    const { result } = renderHook(() => useIsNarrow(500, false))
    const box = document.createElement('div')

    act(() => {
      setContainerWidth(box, 420)
      result.current.ref(box)
    })
    expect(result.current.isNarrow).toBe(true)

    act(() => result.current.ref(null))
    expect(result.current.isNarrow).toBe(false)
  })
})
