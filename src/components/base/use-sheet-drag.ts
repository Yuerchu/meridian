import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/**
 * Pulling a bottom sheet down to dismiss it.
 *
 * Hand-rolled rather than `motion`'s `drag`, which needs the `domMax` feature
 * set — layout projection and the whole gesture stack — where the only other
 * use of `motion` in this app deliberately stays on `domAnimation` and says so.
 * What is actually wanted here is one axis, one element and one threshold, and
 * `use-sidebar-resize.ts` already establishes the shape: capture the pointer on
 * the way down, read a delta on the way up.
 *
 * The offset is written straight to the element's `style` rather than held in
 * state. A re-render per pointer sample is waste on a WebView, and nothing else
 * needs to know where the finger is.
 */

/** Past this far down, or a flick faster than this, the sheet goes. */
const DISMISS_DISTANCE_PX = 120
const DISMISS_FRACTION = 0.35
const DISMISS_VELOCITY_PX_PER_MS = 0.6
/** A flick still has to have travelled; a tap that jitters is not a dismissal. */
const FLICK_MIN_DISTANCE_PX = 24
/** Pulling *up* barely moves it: there is nowhere for the sheet to go. */
const UPWARD_RESISTANCE = 0.15

interface SheetDragOptions {
  enabled: boolean
  /** The same funnel every other dismissal goes through. */
  requestClose: () => boolean
}

interface Gesture {
  id: number
  startY: number
  height: number
  lastY: number
  lastAt: number
  velocity: number
}

export interface SheetDragApi {
  layerRef: RefObject<HTMLDivElement | null>
  isDragging: boolean
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  }
}

export function useSheetDrag({ enabled, requestClose }: SheetDragOptions): SheetDragApi {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setDragging] = useState(false)
  const gesture = useRef<Gesture | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (startsWhereDragIsRefused(event.target as Element | null)) return
      // No text selection, and no scroll started underneath the gesture.
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const rect = layerRef.current?.getBoundingClientRect()
      gesture.current = {
        id: event.pointerId,
        startY: event.clientY,
        height: rect?.height ?? 0,
        lastY: event.clientY,
        lastAt: event.timeStamp,
        velocity: 0,
      }
      setDragging(true)
    },
    [enabled],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || event.pointerId !== current.id) return
    const raw = event.clientY - current.startY
    const offset = raw < 0 ? raw * UPWARD_RESISTANCE : raw
    const elapsed = event.timeStamp - current.lastAt
    if (elapsed > 0) current.velocity = (event.clientY - current.lastY) / elapsed
    current.lastY = event.clientY
    current.lastAt = event.timeStamp
    if (layerRef.current) layerRef.current.style.transform = `translateY(${offset}px)`
  }, [])

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const current = gesture.current
      if (!current || event.pointerId !== current.id) return
      gesture.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      setDragging(false)

      const travelled = Math.max(0, event.clientY - current.startY)
      // A third of the sheet, but never more than a thumb's reach. Measured at
      // zero — which is jsdom, and only jsdom — the fraction would make every
      // touch a dismissal, so the absolute rule stands alone there.
      const threshold =
        current.height > 0 ? Math.min(DISMISS_DISTANCE_PX, current.height * DISMISS_FRACTION) : DISMISS_DISTANCE_PX
      const flicked = travelled >= FLICK_MIN_DISTANCE_PX && current.velocity >= DISMISS_VELOCITY_PX_PER_MS
      const dismissed = !cancelled && (travelled >= threshold || flicked) && requestClose()

      // A short drag and a refused close both spring back. A real close keeps
      // the offset, so the exit keyframe carries on from where the finger left
      // it rather than snapping home first.
      if (!dismissed && layerRef.current) layerRef.current.style.transform = ''
    },
    [requestClose],
  )

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, false), [finish])
  // Android's WebView fires this when it takes the gesture for a scroll.
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, true), [finish])

  return { layerRef, isDragging, handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } }
}

/**
 * Whether a drag may start where the pointer went down.
 *
 * `data-sheet-no-drag` is an opt-out three sheet bodies already carry, and a
 * scroller that is not at its top has first claim on a downward gesture —
 * otherwise the sheet leaves while the reader was scrolling back up inside it.
 * The search stops at the sheet's own root so it never walks out into the page.
 */
function startsWhereDragIsRefused(target: Element | null): boolean {
  for (let node = target; node; node = node.parentElement) {
    if (node.hasAttribute('data-sheet-no-drag')) return true
    if (node.getAttribute('data-slot') === 'sheet-content') return false
    if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) return true
  }
  return false
}
