import { renderHook } from '@testing-library/react'

import { useContextMenuGuard } from './use-context-menu-guard'

vi.mock('./use-coarse-pointer', () => ({ isCoarsePointer: () => false }))

function rightClick(el: Element) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useContextMenuGuard', () => {
  it('cancels the native menu everywhere but an editable field with no menu of ours', () => {
    const { unmount } = renderHook(() => useContextMenuGuard())
    const plain = document.createElement('div')
    const looseInput = document.createElement('input')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    const custom = document.createElement('div')
    const child = document.createElement('span')
    const coveredInput = document.createElement('textarea')
    custom.dataset.slot = 'context-menu-trigger'
    custom.append(child, coveredInput)
    document.body.append(plain, looseInput, editable, custom)

    expect(rightClick(plain)).toBe(true)
    expect(rightClick(child)).toBe(true)
    expect(rightClick(coveredInput)).toBe(true)
    expect(rightClick(looseInput)).toBe(false)
    // jsdom does not implement `isContentEditable`; the attribute is what the
    // property would read on a real element.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(rightClick(editable)).toBe(false)

    unmount()
    plain.remove()
    looseInput.remove()
    editable.remove()
    custom.remove()
  })
})
