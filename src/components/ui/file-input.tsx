import { useImperativeHandle, useRef, type RefObject } from 'react'

/**
 * The browser's own file picker, opened from somewhere else.
 *
 * There is no component-library equivalent and there could not be: the point is the native
 * element, which is the only thing that can hand JavaScript a `File` rather
 * than a path. Connected to another machine that distinction is the whole
 * feature — a path names a file on the wrong computer — so this is what the
 * composer reaches for instead of the Tauri dialog.
 *
 * Rendered hidden and driven through a ref, because the visible trigger is a
 * menu item several components away and a label wrapping it is not available
 * from there. `hidden` takes it out of the accessibility tree as well as the
 * layout, which is right: whatever calls `open()` is what a screen reader
 * should be announcing.
 */
export interface FileInputHandle {
  /** `capture` asks a phone for the camera rather than the gallery. */
  open(options?: { accept?: string; capture?: boolean }): void
}

export function FileInput({
  ref,
  multiple,
  onFiles,
}: {
  ref: RefObject<FileInputHandle | null>
  multiple?: boolean
  onFiles: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    open(options) {
      const input = inputRef.current
      if (!input) return
      // Set per call rather than per render: one element serves "any file",
      // "an image" and "a photo taken now", and three hidden inputs would be
      // three things to keep in step.
      input.accept = options?.accept ?? ''
      if (options?.capture) input.setAttribute('capture', 'environment')
      else input.removeAttribute('capture')
      input.click()
    },
  }))

  return (
    <input
      ref={inputRef}
      data-slot="file-input"
      type="file"
      hidden
      multiple={multiple}
      onChange={(e) => {
        const chosen = Array.from(e.target.files ?? [])
        // Choosing the same file twice in a row fires no change event unless
        // the value is cleared first, which reads as the second attempt being
        // ignored.
        e.target.value = ''
        if (chosen.length > 0) onFiles(chosen)
      }}
    />
  )
}
