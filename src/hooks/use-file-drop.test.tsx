import { act, renderHook } from '@testing-library/react'

import { useFileDrop } from './use-file-drop'

/** jsdom has no `DragEvent` constructor; a plain event with the two fields the
 *  hook reads is the same thing to it. */
function dragEvent(type: string, types: string[], files: File[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } })
  return event
}

describe('useFileDrop', () => {
  it('hands over the dropped files and puts the overlay down', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDrop(onDrop))

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    act(() => {
      window.dispatchEvent(dragEvent('dragenter', ['Files'], [file]))
    })
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(dragEvent('drop', ['Files'], [file]))
    })
    expect(onDrop).toHaveBeenCalledWith([file])
    expect(result.current).toBe(false)
  })

  /**
   * `preventDefault` on `dragover` is what volunteers the window as a drop
   * target. Doing it for a drag that carries no files would swallow the
   * in-page drags — the sidebar's conversation filing — that disabling the
   * native handler exists to make room for.
   */
  it('leaves a drag that carries no files entirely alone', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDrop(onDrop))

    const over = dragEvent('dragover', ['meridian-conversation'])
    act(() => {
      window.dispatchEvent(dragEvent('dragenter', ['meridian-conversation']))
      window.dispatchEvent(over)
      window.dispatchEvent(dragEvent('drop', ['meridian-conversation']))
    })

    expect(over.defaultPrevented).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  /** A drag crossing child elements fires a leave per boundary; only leaving
   *  the window entirely puts the overlay down. */
  it('survives nested enter/leave pairs', () => {
    const { result } = renderHook(() => useFileDrop(vi.fn()))

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', ['Files']))
      window.dispatchEvent(dragEvent('dragenter', ['Files']))
      window.dispatchEvent(dragEvent('dragleave', ['Files']))
    })
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(dragEvent('dragleave', ['Files']))
    })
    expect(result.current).toBe(false)
  })
})
