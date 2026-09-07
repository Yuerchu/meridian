import type { PlanReviewStatus, ToolCallDisplay } from '@/types'

/**
 * The two readings of one fact: how a plan review stands, and how the
 * `exit_plan` tool row that opened it is drawn. The store projects the review
 * onto the row and the transcript reads the row back into a review status when
 * no summary has arrived yet, so both directions live here — two hand-written
 * tables in two files is how they come to disagree.
 */
export function planReviewToolStatus(status: PlanReviewStatus): ToolCallDisplay['status'] {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'approved':
      return 'completed'
    case 'changes_requested':
      return 'denied'
    case 'orphaned':
      return 'orphaned'
  }
}

/** The inverse, for a row whose review summary is not loaded. Statuses the
 *  projection never produces read as `orphaned`, which is what the row means
 *  once nothing can answer for it. */
export function planReviewStatusOfTool(status: ToolCallDisplay['status']): PlanReviewStatus {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'completed':
      return 'approved'
    case 'denied':
      return 'changes_requested'
    default:
      return 'orphaned'
  }
}
