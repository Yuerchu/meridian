import { act, renderHook } from '@testing-library/react'

import { useMasterDetail } from './use-master-detail'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('@/hooks/use-nav', () => ({ useHistoryLevel: vi.fn() }))

describe('useMasterDetail', () => {
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
