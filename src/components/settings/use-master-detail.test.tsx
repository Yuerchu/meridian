import { act, renderHook } from '@testing-library/react'

import { useMasterDetail } from './use-master-detail'
import { setContainerWidth } from '@/test/resize'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('@/hooks/use-history-level', () => ({ useHistoryLevel: vi.fn() }))

describe('useMasterDetail', () => {
  // The two halves of the fallback contract, stated on their own so that the
  // navigation tests below are not the only thing holding them up.
  it('answers from the viewport while no pane has been measured', () => {
    const { result } = renderHook(() => useMasterDetail())
    expect(result.current.isNarrow).toBe(true)
  })

  it('lets a measured pane overrule the viewport', () => {
    const { result } = renderHook(() => useMasterDetail())
    const pane = document.createElement('div')

    act(() => {
      setContainerWidth(pane, 900)
      result.current.ref(pane)
    })
    // A phone-sized viewport, but the box says there is room for two columns.
    expect(result.current.isNarrow).toBe(false)
  })

  it('unwinds aux content before clearing the selected item', () => {
    const { result } = renderHook(() => useMasterDetail<'import'>())

    act(() => result.current.openItem('server-1'))
    act(() => result.current.openAux('import'))
    expect(result.current.selectedId).toBe('server-1')
    expect(result.current.aux).toBe('import')

    act(() => result.current.back())
    expect(result.current.aux).toBeNull()
    expect(result.current.selectedId).toBe('server-1')

    act(() => result.current.back())
    expect(result.current.selectedId).toBeNull()
  })
})
