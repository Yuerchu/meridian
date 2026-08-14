import { useEffect, useRef, useState } from 'react'

/**
 * Files dropped onto the window, as absolute paths.
 *
 * Not `dragover`/`drop`. Tauri v2 leaves `dragDropEnabled` on by default, which
 * hands the WebView's native drop handler to Tauri — the DOM events for a file
 * drag never reach JavaScript at all, so a listener on an element looks correct
 * and fires never. What Tauri gives back instead is better for this app anyway:
 * absolute paths rather than `File` objects, which is exactly what an
 * `AttachedFile` holds and what the backend reads.
 *
 * The event is webview-wide — there is no DOM target to hit-test against. That
 * is left as it is rather than compared against a rectangle: this hook is only
 * mounted where a composer is, so "dropped on the window" and "dropped on the
 * composer" already mean the same thing, and asking someone to land a file
 * inside a two-line field is asking a lot.
 *
 * Outside a Tauri webview — the dev playground runs in a plain browser — the
 * import throws and nothing is listening, which is the correct amount of
 * nothing.
 */
export function useFileDrop(onDrop: ((paths: string[]) => void) | undefined): boolean {
  const [isDragging, setDragging] = useState(false)
  // Kept in a ref so a caller that rebuilds its handler every render does not
  // tear the subscription down and put it back.
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const enabled = onDrop !== undefined

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload
          if (payload.type === 'enter' || payload.type === 'over') {
            setDragging(true)
          } else if (payload.type === 'leave') {
            setDragging(false)
          } else if (payload.type === 'drop') {
            setDragging(false)
            if (payload.paths.length > 0) onDropRef.current?.(payload.paths)
          }
        })
        if (cancelled) stop()
        else unlisten = stop
      } catch {
        // Not a Tauri webview.
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [enabled])

  return isDragging
}
