import { useEffect } from 'react'
import { isCoarsePointer } from './use-coarse-pointer'

/**
 * Suppresses the browser's own context menu.
 *
 * Every menu on the desktop is drawn by the app — Pro's `ContextMenu` on the
 * sidebar rows, the transcript and the composer — and the one the WebView draws
 * where none of ours is mounted (back, reload, inspect) is not a menu anyone
 * here asked for. Devtools stays reachable with Ctrl+Shift+I in a dev build.
 *
 * Two places keep the native one. Not on a touch screen, where the same event
 * carries the platform's text selection and paste affordances: there a long
 * press is the only way to get at them, and a custom ROM may have put
 * clipboard history or translation there too — cancelling it leaves the
 * composer with no way to paste at all. And not on an editable field that has
 * no menu of ours: a settings input's paste, undo and spell-check live in the
 * native menu and nothing else offers them. A field inside one of our triggers
 * — the composer — is already covered, so the guard closes it there.
 */
export function useContextMenuGuard() {
  useEffect(() => {
    if (isCoarsePointer()) return
    function handler(e: MouseEvent) {
      const target = e.target instanceof Element ? e.target : null
      if (target && isEditable(target) && !target.closest('[data-slot="context-menu-trigger"]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])
}

function isEditable(target: Element): boolean {
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return target.closest('input, textarea') !== null
}
