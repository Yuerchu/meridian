import { useEffect } from 'react'

export function useContextMenuGuard() {
  useEffect(() => {
    function handler(e: MouseEvent) {
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])
}
