import { create } from 'zustand'

import type { PlanReviewDeliveryState, PlanReviewStatus, PlanReviewSummaryInfoResponse } from '@/types'

export interface PlanReviewEventInfo {
  review_id: string
  conversation_id: string
  document_id: string
  revision_id: string
  turn_id: string
  status: PlanReviewStatus
  delivery_state: PlanReviewDeliveryState | null
  lock_version: number
}

type ReviewProjection = Pick<PlanReviewEventInfo, 'status' | 'delivery_state' | 'lock_version'>

function sameProjection(left: ReviewProjection, right: ReviewProjection): boolean {
  return left.status === right.status && left.delivery_state === right.delivery_state
}

function acceptsProjection(previous: ReviewProjection | undefined, next: ReviewProjection): boolean {
  if (!previous) return true
  return (
    next.lock_version > previous.lock_version ||
    (next.lock_version === previous.lock_version && sameProjection(previous, next))
  )
}

interface PlanReviewNavigationState {
  activeReviewId: string | null
  summaries: Record<string, PlanReviewSummaryInfoResponse | PlanReviewEventInfo>
  openReview: (reviewId: string) => void
  closeReview: () => void
  receiveReviewEvent: (event: PlanReviewEventInfo) => boolean
  rememberSummaries: (summaries: PlanReviewSummaryInfoResponse[]) => void
}

export const usePlanReviewStore = create<PlanReviewNavigationState>((set, get) => ({
  activeReviewId: null,
  summaries: {},

  openReview: (activeReviewId) => set({ activeReviewId }),
  closeReview: () => set({ activeReviewId: null }),

  receiveReviewEvent: (event) => {
    const previous = get().summaries[event.review_id]
    if (!acceptsProjection(previous, event)) return false
    if (!previous || event.lock_version > previous.lock_version) {
      set((state) => ({
        summaries: {
          ...state.summaries,
          [event.review_id]: event,
        },
      }))
    }
    return true
  },

  rememberSummaries: (summaries) =>
    set((state) => {
      const next = { ...state.summaries }
      for (const summary of summaries) {
        if (acceptsProjection(next[summary.review_id], summary)) next[summary.review_id] = summary
      }
      return { summaries: next }
    }),
}))
