import { renderHook } from '@testing-library/react'

import { useContextMenuGuard } from './use-context-menu-guard'

vi.mock('./use-coarse-pointer', () => ({ isCoarsePointer: () => false }))

describe('useContextMenuGuard', () => {
  it('keeps the native menu outside custom context-menu triggers', () => {
    const { unmount } = renderHook(() => useContextMenuGuard())
    const plain = document.createElement('div')
    const custom = document.createElement('div')
    const child = document.createElement('span')
    custom.dataset.slot = 'context-menu-trigger'
    custom.append(child)
    document.body.append(plain, custom)

    const plainEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    plain.dispatchEvent(plainEvent)
    expect(plainEvent.defaultPrevented).toBe(false)

    const customEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    child.dispatchEvent(customEvent)
    expect(customEvent.defaultPrevented).toBe(true)

    unmount()
    plain.remove()
    custom.remove()
  })
})
