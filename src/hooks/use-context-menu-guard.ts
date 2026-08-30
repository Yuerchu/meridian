import { useEffect } from 'react'
import { isCoarsePointer } from './use-coarse-pointer'

/**
 * Suppresses the browser's own context menu only where a custom one is mounted,
 * so that the two menus do not stack.
 *
 * Not on a touch screen, where the same event carries the platform's text
 * selection and paste affordances. There a long press is the only way to get at
 * them, and a custom ROM may have put clipboard history or translation there
 * too — cancelling it leaves the composer with no way to paste at all.
 */
export function useContextMenuGuard() {
  useEffect(() => {
    if (isCoarsePointer()) return
    function handler(e: MouseEvent) {
      const target = e.target instanceof Element ? e.target : null
      if (!target?.closest('[data-slot="context-menu-trigger"]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])
}
