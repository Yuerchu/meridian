import { useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore, type PlanReviewEventInfo } from '@/stores/plan-review-store'
import type { PlanReviewInfoResponse, PlanReviewSummaryInfoResponse } from '@/types'

/**
 * Take in a review's projection: the summary the cards read, the attention
 * queue and barrier the conversation store derives from it, and the
 * transcript's tool rows, reloaded so the plan tool's status follows.
 *
 * The `plan-review-requested` / `plan-review-updated` listeners call this with
 * the event; a client that decided itself calls it with what it read back.
 * The event is best-effort, so a decision made here must not depend on it to
 * reach this client's own screen — and both routes go through the store's
 * lock-version gate, so whichever lands second is a no-op rather than a
 * rollback.
 */
export function receivePlanReview(payload: PlanReviewEventInfo): {
  accepted: boolean
  previous: PlanReviewSummaryInfoResponse | PlanReviewEventInfo | undefined
} {
  const planReviews = usePlanReviewStore.getState()
  const previous = planReviews.summaries[payload.review_id]
  if (!planReviews.receiveReviewEvent(payload)) return { accepted: false, previous }
  const conversation = useConversationStore.getState()
  conversation.handlePlanReviewEvent(payload)
  if (conversation.sessions[payload.conversation_id]) void conversation.loadMessages(payload.conversation_id)
  return { accepted: true, previous }
}

/** The projection an event would carry, from a full read of the review. The
 *  event's `lock_version` is the review row's (`bundle.review.lock_version`
 *  in the backend), so the gate compares like with like. */
export function planReviewProjection(info: PlanReviewInfoResponse): PlanReviewEventInfo {
  return {
    review_id: info.review.id,
    conversation_id: info.document.conversation_id,
    document_id: info.document.id,
    revision_id: info.submitted_revision.id,
    turn_id: info.review.turn_id,
    status: info.review.state,
    delivery_state: info.delivery?.state ?? null,
    lock_version: info.review.lock_version,
  }
}
