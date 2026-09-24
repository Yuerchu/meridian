import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { useHistoryLevel } from '@/hooks/use-history-level'
import { usePlanReviewStore } from '@/stores/plan-review-store'

/**
 * Leaving the plan review page, asked rather than done.
 *
 * The page is a layer the shell mounts from `activeReviewId`, and every way out
 * of it — the close button, the back gesture, choosing a conversation, a new
 * one, settings — used to be a bare `closeReview()`. The page was simply
 * unmounted with whatever it was holding: a draft whose save had failed, a
 * conflict, an edit still inside the debounce. So the page registers a guard
 * here while it is mounted, and every door goes through {@link usePlanReviewNavigation}'s
 * `leave`, which asks it first.
 *
 * Module state rather than a store field because it is a function, and only
 * one review page exists at a time. Nothing registered means nothing to lose —
 * including the frame before the lazy page has loaded.
 */
type LeaveGuard = () => Promise<boolean>

let leaveGuard: LeaveGuard | null = null

export function registerPlanReviewLeaveGuard(guard: LeaveGuard): () => void {
  leaveGuard = guard
  return () => {
    if (leaveGuard === guard) leaveGuard = null
  }
}

export function requestLeavePlanReview(): Promise<boolean> {
  return leaveGuard ? leaveGuard() : Promise.resolve(true)
}

/**
 * The shell's half: one `leave()` for every door, the back gesture's history
 * level, and focus handed back to whatever opened the page.
 *
 * The opener is read in a layout effect of the commit that opens the review,
 * which is before the browser moves focus off the chat layer it has just made
 * `inert`. It is given focus back in the commit that closes the review — the
 * `inert` is gone by then — and only if it is still in the document: choosing
 * another conversation unmounts the transcript it was in.
 */
export function usePlanReviewNavigation(): () => Promise<boolean> {
  const activeReviewId = usePlanReviewStore((state) => state.activeReviewId)
  const [historyClaimed, setHistoryClaimed] = useState(true)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  const leave = useCallback(async () => {
    if (usePlanReviewStore.getState().activeReviewId === null) return true
    if (!(await requestLeavePlanReview())) return false
    usePlanReviewStore.getState().closeReview()
    return true
  }, [])

  useLayoutEffect(() => {
    const isOpen = activeReviewId !== null
    if (isOpen && !wasOpenRef.current) {
      const active = document.activeElement
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    } else if (!isOpen && wasOpenRef.current) {
      const opener = openerRef.current
      openerRef.current = null
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
    wasOpenRef.current = isOpen
  }, [activeReviewId])

  // A refused back gesture has already retired its history entry, so the level
  // is dropped and claimed again on the next frame — the same dance settings
  // does, or the next press would leave the page without asking.
  useHistoryLevel(activeReviewId !== null && historyClaimed, () => {
    void leave().then((left) => {
      if (left) return
      setHistoryClaimed(false)
      requestAnimationFrame(() => setHistoryClaimed(true))
    })
  })

  return leave
}
