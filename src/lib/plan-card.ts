import { api } from '@/api'
import { PlanDecisionAttempt, planReviewActionRules } from './plan-review-draft'
import { planCommentRequests, planDraftPayload, projectPlanReviewDraft } from './plan-review-projection'
import type { PlanReviewDecisionResponse, PlanReviewInfoResponse } from '@/types'

/** What the transcript's plan card shows of the submitted plan. */
export interface PlanExcerpt {
  title: string | null
  lines: string[]
}

const EXCERPT_LINES = 3
const HEADING = /^#{1,6}\s+(.*)$/
const FENCE = /^(```|~~~)/

/**
 * The plan's first heading and the lines after it, enough to recognise which
 * plan this is without opening it — not a rendering of it. Markdown markers on
 * headings are dropped; list markers stay, since "1." is part of what a step
 * says. A code fence ends the excerpt: a fence's first lines are rarely what
 * the plan is about, and cutting inside one says nothing.
 */
export function planExcerpt(markdown: string): PlanExcerpt {
  let title: string | null = null
  const lines: string[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (FENCE.test(line)) break
    const heading = HEADING.exec(line)
    if (title === null && lines.length === 0 && heading) {
      title = heading[1].trim() || null
      continue
    }
    lines.push(heading ? heading[1].trim() : line)
    if (lines.length === EXCERPT_LINES) break
  }
  return { title, lines }
}

/**
 * Whether the server's copy of the review draft is untouched — no edit, no
 * comment, no note. The card decides only then: anything else is the
 * reviewer's work in progress on the review page, and approving past it is
 * refused by the backend anyway (`decide_review`), while sending a note back
 * from here would overwrite it.
 *
 * `allowNote` lets a send-back retry through: the note it saved on the first
 * attempt is the only thing in the draft, and it is that same note.
 */
function pristine(info: PlanReviewInfoResponse, allowNote: string | null): boolean {
  const projected = projectPlanReviewDraft(info)
  const note = projected.globalNote.trim()
  if (note && note !== allowNote?.trim()) return false
  return planReviewActionRules({
    status: info.review.state,
    baseMarkdown: projected.baseMarkdown,
    draftMarkdown: projected.markdown,
    comments: planCommentRequests(projected.comments),
    globalNote: null,
    saveState: 'saved',
    isHistorical: false,
  }).canApprove
}

export type PlanCardOutcome =
  | { kind: 'decided'; result: PlanReviewDecisionResponse }
  /** The review is no longer pending: decided elsewhere, or orphaned. */
  | { kind: 'settled' }
  /** The draft holds the reviewer's own work; finish it on the review page. */
  | { kind: 'draft_in_progress' }

/**
 * Approve from the transcript card: the same `decide_plan_review` the review
 * page calls, against a draft read at the moment of the press — never a copy
 * the card fetched earlier, since the review page may have been used since.
 * The generation and hash it sends are that read's, so a save landing in
 * between is a conflict, as it is for the page.
 */
export async function approveFromCard(reviewId: string, attempt: PlanDecisionAttempt): Promise<PlanCardOutcome> {
  const info = await api.getPlanReview({ reviewId })
  if (info.review.state !== 'pending') return { kind: 'settled' }
  if (!pristine(info, null)) return { kind: 'draft_in_progress' }
  const { id } = attempt.forAction('approve')
  const result = await api.decidePlanReview({
    reviewId,
    decisionId: id,
    expectedGeneration: info.draft.generation,
    expectedDraftHash: info.draft.draft_sha256,
    action: 'approve',
  })
  attempt.reset()
  return { kind: 'decided', result }
}

/**
 * Send the plan back with a note: exactly what the review page does when the
 * only feedback is its global note. The note is saved into the draft through
 * the page's own projection (`planDraftPayload`), so the baseline, the mode and
 * the editor schema go back as the server holds them; then `request_changes`
 * is decided against the generation that save returned.
 */
export async function sendBackFromCard(
  reviewId: string,
  note: string,
  attempt: PlanDecisionAttempt,
): Promise<PlanCardOutcome> {
  const info = await api.getPlanReview({ reviewId })
  if (info.review.state !== 'pending') return { kind: 'settled' }
  if (!pristine(info, note)) return { kind: 'draft_in_progress' }
  const { id } = attempt.forAction('request_changes')
  let generation = info.draft.generation
  let draftHash = info.draft.draft_sha256
  if ((info.draft.global_note ?? '').trim() !== note.trim()) {
    const payload = planDraftPayload({ ...projectPlanReviewDraft(info), globalNote: note })
    const saved = await api.savePlanReviewDraft({ reviewId, expectedGeneration: generation, ...payload })
    generation = saved.generation
    draftHash = saved.draft_sha256
  }
  const result = await api.decidePlanReview({
    reviewId,
    decisionId: id,
    expectedGeneration: generation,
    expectedDraftHash: draftHash,
    action: 'request_changes',
  })
  attempt.reset()
  return { kind: 'decided', result }
}

/** The card's preview of a review: which revision, and how it starts. */
export interface PlanCardPreview {
  revisionNo: number
  excerpt: PlanExcerpt
}

export function planCardPreview(info: PlanReviewInfoResponse): PlanCardPreview {
  return {
    revisionNo: info.submitted_revision.revision_no,
    excerpt: planExcerpt(info.submitted_revision.content_markdown),
  }
}
