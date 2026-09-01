import { useEffect, useRef, useState } from 'react'

/**
 * Files dropped onto the window, as `File` objects.
 *
 * DOM `dragover`/`drop`, not Tauri's `onDragDropEvent`. The native handler
 * those events come from (`dragDropEnabled`) is switched off in
 * `tauri.conf.json`, because on Windows it takes the WebView's drop target
 * with it — every in-page HTML5 drag, the sidebar's conversation filing
 * included, showed a refusal cursor wherever it went. What this costs is the
 * absolute path the native event used to carry: an HTML5 drop hands over
 * `File` objects with no path on any WebView, so the upload sends bytes — the
 * same shape the remote picker has always produced.
 *
 * Only a drag that carries files is touched. `preventDefault` on `dragover`
 * is what marks the window as a drop target, and doing it for every drag
 * would swallow the in-page drags this hook exists to make room for.
 *
 * The listener is window-wide — this hook is only mounted where a composer
 * is, so "dropped on the window" and "dropped on the composer" already mean
 * the same thing, and asking someone to land a file inside a two-line field
 * is asking a lot. The enter/leave depth is counted because a drag crossing
 * child elements fires a leave for every boundary.
 */
export function useFileDrop(onDrop: ((files: File[]) => void) | undefined): boolean {
  const [isDragging, setDragging] = useState(false)
  // Kept in a ref so a caller that rebuilds its handler every render does not
  // tear the subscription down and put it back.
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const enabled = onDrop !== undefined

  useEffect(() => {
    if (!enabled) return
    let depth = 0

    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDropEvent = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length > 0) onDropRef.current?.(files)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDropEvent)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDropEvent)
    }
  }, [enabled])

  return isDragging
}
