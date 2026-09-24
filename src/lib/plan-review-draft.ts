import type {
  PlanCommentDraftRequest,
  PlanReviewDraftMode,
  PlanReviewDraftSaveRequest,
  PlanReviewDraftSaveResponse,
  PlanReviewDecisionAction,
  PlanReviewStatus,
  PlanCommentAnchor,
  JsonValue,
} from '@/types'

/** Thrown when the other decision button is pressed while a lost reply to the
 *  first is still in doubt. A class rather than a message so the page can put
 *  its own words on it: the string is what would otherwise reach the banner. */
export class PlanDecisionInDoubtError extends Error {
  constructor(public readonly pending: PlanReviewDecisionAction) {
    super('a different plan decision is still in doubt')
    this.name = 'PlanDecisionInDoubtError'
  }
}

export class PlanDecisionAttempt {
  private attempt: { action: PlanReviewDecisionAction; id: string } | null = null

  forAction(action: PlanReviewDecisionAction): { action: PlanReviewDecisionAction; id: string } {
    if (this.attempt && this.attempt.action !== action) {
      throw new PlanDecisionInDoubtError(this.attempt.action)
    }
    this.attempt ??= { action, id: crypto.randomUUID() }
    return this.attempt
  }

  reset(): void {
    this.attempt = null
  }

  current(): { action: PlanReviewDecisionAction; id: string } | null {
    return this.attempt
  }
}

export type PlanDraftSaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

export interface PlanDraftPayload {
  mode: PlanReviewDraftMode
  baseEditorJson: JsonValue | null
  baseNormalizedMarkdown: string
  editorJson: JsonValue | null
  sourceText: string | null
  normalizedMarkdown: string
  comments: PlanCommentDraftRequest[]
  globalNote: string | null
  selection: PlanCommentAnchor | null
  editorSchemaVersion: number | null
  editorSchemaHash: string | null
  editorSchemaFallback: {
    fromVersion: number
    fromHash: string | null
  } | null
}

export interface PlanReviewActionRules {
  isPristine: boolean
  hasFeedback: boolean
  canApprove: boolean
  canRequestChanges: boolean
}

export function planReviewActionRules(input: {
  status: PlanReviewStatus
  baseMarkdown: string
  draftMarkdown: string
  comments: PlanCommentDraftRequest[]
  globalNote: string | null
  saveState: PlanDraftSaveState
  isHistorical: boolean
}): PlanReviewActionRules {
  const liveComments = input.comments.filter((comment) => comment.state !== 'deleted')
  const bodyChanged = input.baseMarkdown !== input.draftMarkdown
  const commentFeedback = liveComments.some((comment) => comment.body.trim().length > 0)
  const noteFeedback = Boolean(input.globalNote?.trim())
  const hasFeedback = bodyChanged || commentFeedback || noteFeedback
  const isPristine = !bodyChanged && liveComments.length === 0 && !noteFeedback
  const canDecide = input.status === 'pending' && input.saveState === 'saved' && !input.isHistorical

  return {
    isPristine,
    hasFeedback,
    canApprove: canDecide && isPristine,
    canRequestChanges: canDecide && hasFeedback,
  }
}

type Save = (request: PlanReviewDraftSaveRequest) => Promise<PlanReviewDraftSaveResponse>

/** The backend's `PlanReviewStoreError::Conflict` is the one variant that means
 *  "reload and look again" rather than "this request was wrong", and it arrives
 *  flattened to a string with this prefix (`db/ops/plan_review.rs`). Matching
 *  the prefix and nothing looser: a validation message that happens to contain
 *  the word "hash" is not a conflict, and reading it as one hides the defect
 *  behind a reload button. */
export function isPlanStateConflict(error: unknown): boolean {
  return /(^|\W)plan state conflict:/.test(String(error))
}

/** The parts of a draft a reviewer would recognise as their own work. */
export type PlanDraftPart = 'body' | 'comments' | 'note'

/**
 * What the local draft holds that the server's copy does not, in the reviewer's
 * terms. Asked before anything replaces the local draft, so the question can say
 * *what* it is about to throw away rather than only that something will go.
 */
export function planDraftUnsavedParts(saved: PlanDraftPayload, local: PlanDraftPayload): PlanDraftPart[] {
  const parts: PlanDraftPart[] = []
  if (saved.normalizedMarkdown !== local.normalizedMarkdown || saved.sourceText !== local.sourceText) {
    parts.push('body')
  }
  if (JSON.stringify(saved.comments) !== JSON.stringify(local.comments)) parts.push('comments')
  if ((saved.globalNote ?? '') !== (local.globalNote ?? '')) parts.push('note')
  return parts
}

/**
 * One CAS writer for one open review. Calls are strictly ordered; edits made
 * while a save is in flight replace the pending snapshot, never the request
 * whose generation has already been claimed.
 *
 * A failed save keeps what it failed to write. The failure is sticky — nothing
 * is sent again until someone asks with {@link retry} — but the payload stays
 * pending, and later edits replace it, so a failure is never the moment an edit
 * quietly stops existing. A conflict cannot be retried: its generation is stale
 * and only reloading the server copy resolves it.
 */
export class PlanDraftSaveQueue {
  private pending: PlanDraftPayload | null = null
  private running: Promise<void> | null = null
  private failure: unknown = null

  constructor(
    private readonly reviewId: string,
    private readonly save: Save,
    private generation: number,
    private draftHash: string,
    private readonly onStateChange: (state: PlanDraftSaveState, error?: unknown) => void,
    private saved: PlanDraftPayload | null = null,
  ) {}

  enqueue(payload: PlanDraftPayload): void {
    this.pending = payload
    if (this.failure) {
      this.onStateChange(this.failureState(), this.failure)
      return
    }
    this.onStateChange('dirty')
  }

  clearPending(): void {
    this.pending = null
  }

  reset(generation: number, draftHash: string): void {
    this.pending = null
    this.failure = null
    this.generation = generation
    this.draftHash = draftHash
    this.onStateChange('saved')
  }

  committed(): { generation: number; draftHash: string } {
    return { generation: this.generation, draftHash: this.draftHash }
  }

  /** The last payload the server confirmed, or the one this queue was opened on. */
  lastSaved(): PlanDraftPayload | null {
    return this.saved
  }

  /** Whether anything local has not reached the server: queued, in flight, or failed. */
  hasUnsaved(): boolean {
    return this.pending !== null || this.running !== null || this.failure !== null
  }

  failed(): boolean {
    return this.failure !== null
  }

  /** Clears an ordinary failure and sends the retained draft again. */
  async retry(): Promise<void> {
    if (this.failure && isPlanStateConflict(this.failure)) throw this.failure
    this.failure = null
    if (!this.pending && !this.running) {
      this.onStateChange('saved')
      return
    }
    await this.flush()
  }

  async flush(): Promise<void> {
    if (this.failure) throw this.failure
    if (this.running) {
      await this.running
      if (this.pending) await this.flush()
      return
    }
    if (!this.pending) return

    const run = this.drain()
    this.running = run
    try {
      await run
    } finally {
      if (this.running === run) this.running = null
    }
    if (this.pending) await this.flush()
  }

  private failureState(): PlanDraftSaveState {
    return isPlanStateConflict(this.failure) ? 'conflict' : 'error'
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const payload = this.pending
      this.pending = null
      this.onStateChange('saving')
      try {
        const result = await this.save({
          reviewId: this.reviewId,
          expectedGeneration: this.generation,
          ...payload,
        })
        this.generation = result.generation
        this.draftHash = result.draft_sha256
        this.saved = payload
      } catch (error) {
        this.failure = error
        // An edit made while this request was in flight is newer than the one
        // that failed; either way the newest unsaved snapshot is what stays.
        this.pending ??= payload
        this.onStateChange(this.failureState(), error)
        throw error
      }
    }
    this.onStateChange('saved')
  }
}
