import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'sidebar-width'
const DEFAULT_WIDTH = 240
const MIN_WIDTH = 200
const MAX_WIDTH = 480

export function useSidebarResize() {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_WIDTH
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed)) : DEFAULT_WIDTH
  })

  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_WIDTH)

  useEffect(() => {
    document.documentElement.style.setProperty('--app-sidebar-width', `${width}px`)
    return () => {
      document.documentElement.style.removeProperty('--app-sidebar-width')
    }
  }, [width])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = width
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const delta = e.clientX - startX.current
    const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta))
    setWidth(next)
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    const delta = e.clientX - startX.current
    const final = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta))
    setWidth(final)
    localStorage.setItem(STORAGE_KEY, String(final))
  }, [])

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH)
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH))
  }, [])

  return {
    width,
    resetWidth,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
  }
}
