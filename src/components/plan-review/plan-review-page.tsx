import { useCallback, useEffect, useMemo, useRef, useState, type Key, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { ChevronDown, Clock, Comment, TriangleExclamation, Xmark } from '@gravity-ui/icons'
import {
  Button,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownPopover,
  Skeleton,
  TextArea,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { Segment } from '@/components/base'
import { Sheet } from '@/components/base'

import { api } from '@/api'
import { FileDiffCard } from '@/components/chat/file-diff-card'
import { Hint } from '@/components/ui/hint'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useIsMobile } from '@/hooks/use-mobile'
import { useIsNarrow } from '@/hooks/use-narrow'
import { remapSourceRange, sourceRangeAnchor } from '@/lib/plan-comment-decorations'
import { parsePatchText } from '@/lib/patch-parse'
import {
  normalizePlanEditorDocument,
  parsePlanMarkdown,
  planSuggestionPatch,
  serializePlanDocument,
} from '@/lib/plan-markdown'
import {
  planCommentRequests,
  planDraftPayload,
  planSubmittedReviewPatch,
  projectPlanReviewDraft,
  type ProjectedPlanDraft,
} from '@/lib/plan-review-projection'
import {
  PlanDraftSaveQueue,
  PlanDecisionAttempt,
  PlanDecisionInDoubtError,
  planReviewActionRules,
  type PlanDraftSaveState,
} from '@/lib/plan-review-draft'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type {
  PlanCommentAnchor,
  PlanCommentInfoResponse,
  PlanProseMirrorRange,
  PlanReviewInfoResponse,
  PlanRevisionInfoResponse,
  PlanSourceRange,
} from '@/types'

import { PlanCommentsPane, type PlanCommentFocusRequest } from './plan-comments-pane'
import { PlanReviewEditor } from './plan-review-editor'

type ReviewTab = 'plan' | 'changes' | 'suggestions'

/** The width below which the comment rail folds into a sheet. The same number
 *  as the `@container (min-width: 60rem)` rule in `index.css` that hides the
 *  rail: the two have to agree, or the page opens a sheet over a rail that is
 *  already showing the comment, or hides the only pane the comment is in. */
const COMMENT_RAIL_MIN = 960

/** How long the sheet takes to leave before the editor may take focus. A
 *  React Aria modal hands focus back to its trigger as it closes, so a
 *  selection made while it is still on screen is taken away again. */
const SHEET_EXIT_MS = 250

function PlanDiff({ patch, emptyLabel }: { patch: string; emptyLabel: string }) {
  const files = useMemo(() => parsePatchText(patch), [patch])
  if (!patch || files.length === 0) {
    return (
      <p data-slot="plan-diff-empty" className="px-5 py-12 text-center text-sm text-muted">
        {emptyLabel}
      </p>
    )
  }
  return (
    <div data-slot="plan-diff" className="space-y-3 p-4">
      {files.map((file, index) => (
        <FileDiffCard key={`${file.path}:${index}`} diff={file} />
      ))}
    </div>
  )
}

/** The page's shape while the review loads: header, view switch, a document's
 *  worth of lines and the decision row. Sized to what replaces it, so nothing
 *  moves when the review lands. */
function PlanReviewSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      data-slot="plan-review-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div
        data-slot="plan-review-skeleton-header"
        className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-3 @sm:px-5"
      >
        <div data-slot="plan-review-skeleton-heading" className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-28 rounded-md" />
          <Skeleton className="h-3 w-56 rounded-md" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
      <div
        data-slot="plan-review-skeleton-views"
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 @sm:px-5"
      >
        <Skeleton className="h-8 w-60 rounded-lg" />
      </div>
      <div
        data-slot="plan-review-skeleton-document"
        className="mx-auto w-full max-w-[54rem] flex-1 space-y-3 px-6 py-8"
      >
        <Skeleton className="h-6 w-2/3 rounded-md" />
        <Skeleton className="h-3.5 w-full rounded-md" />
        <Skeleton className="h-3.5 w-11/12 rounded-md" />
        <Skeleton className="h-3.5 w-4/5 rounded-md" />
        <Skeleton className="mt-6 h-5 w-1/3 rounded-md" />
        <Skeleton className="h-3.5 w-full rounded-md" />
        <Skeleton className="h-3.5 w-10/12 rounded-md" />
      </div>
      <div
        data-slot="plan-review-skeleton-decision"
        className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-3 @sm:px-5"
      >
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
    </div>
  )
}

function SourceEditor({
  value,
  isReadOnly,
  selection,
  onChange,
  onSelectionChange,
  onAddComment,
  textareaRef,
}: {
  value: string
  isReadOnly: boolean
  selection: PlanSourceRange | null
  onChange: (value: string) => void
  onSelectionChange: (anchor: PlanSourceRange | null) => void
  onAddComment: (anchor: PlanSourceRange) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const { t } = useTranslation()
  return (
    <div data-slot="plan-source-editor" className="flex h-full min-h-0 flex-col">
      <TextArea
        ref={textareaRef}
        aria-label={t('planReview.source.label')}
        value={value}
        readOnly={isReadOnly}
        variant="secondary"
        className="plan-review-source min-h-0 flex-1 font-mono"
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => {
          const target = event.currentTarget
          onSelectionChange(sourceRangeAnchor(value, target.selectionStart, target.selectionEnd))
        }}
      />
      {!isReadOnly && (
        <div
          data-slot="plan-source-editor-footer"
          className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2"
        >
          <p data-slot="plan-source-editor-hint" className="text-xs text-muted">
            {t('planReview.source.hint')}
          </p>
          <Button
            size="small"
            variant="ghost"
            disabled={!selection}
            onClick={() => selection && onAddComment(selection)}
          >
            <Comment />
            {t('planReview.comments.add')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** One row of the problem banner: something wrong, and the one thing to do
 *  about it. Each problem gets its own row rather than sharing a sentence
 *  chosen by priority, so a button is never shown beside a message that does
 *  not explain it. */
interface Problem {
  key: string
  message: string
  action?: { label: string; run: () => void; pending?: boolean }
}

export function PlanReviewPage({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [info, setInfo] = useState<PlanReviewInfoResponse | null>(null)
  const [revisions, setRevisions] = useState<PlanRevisionInfoResponse[]>([])
  const [draft, setDraft] = useState<ProjectedPlanDraft | null>(null)
  const [tab, setTab] = useState<ReviewTab>('plan')
  const [historicalRevisionId, setHistoricalRevisionId] = useState<string | null>(null)
  const [historicalReview, setHistoricalReview] = useState<PlanReviewInfoResponse | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [saveState, setSaveState] = useState<PlanDraftSaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  // A live editor value the Markdown codec refuses. Kept apart from the save
  // queue's state because it clears itself on the next acceptable edit, while
  // a failed request is sticky until the server copy is reloaded.
  const [codecError, setCodecError] = useState<string | null>(null)
  const effectiveSaveState: PlanDraftSaveState = codecError ? 'error' : saveState
  const [pageError, setPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [editorMount, setEditorMount] = useState(0)
  const [focusAnchor, setFocusAnchor] = useState<PlanProseMirrorRange | null>(null)
  const [commentFocus, setCommentFocus] = useState<PlanCommentFocusRequest | null>(null)
  const [sourceSelection, setSourceSelection] = useState<PlanSourceRange | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const saveQueueRef = useRef<PlanDraftSaveQueue | null>(null)
  const decisionAttemptRef = useRef(new PlanDecisionAttempt())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPayloadRef = useRef<string | null>(null)
  const loadSequenceRef = useRef(0)
  const historySequenceRef = useRef(0)
  const observedSummaryRef = useRef<string | null>(null)
  const summaries = usePlanReviewStore((state) => state.summaries)
  const summary = summaries[reviewId]
  // Whether the comment rail is folded into the sheet. Measured on the page
  // root, whose width is decided from above; the viewport is the fallback for
  // as long as nothing can be measured.
  const { ref: pageRef, isNarrow: railFolded } = useIsNarrow(COMMENT_RAIL_MIN, useIsMobile())

  useHistoryLevel(commentsOpen, () => setCommentsOpen(false))

  const applyReview = useCallback(
    (next: PlanReviewInfoResponse) => {
      const local = projectPlanReviewDraft(next)
      const payload = planDraftPayload(local)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      lastPayloadRef.current = JSON.stringify(payload)
      const queue = new PlanDraftSaveQueue(
        reviewId,
        api.savePlanReviewDraft,
        next.draft.generation,
        next.draft.draft_sha256,
        (state, error) => {
          // A queue replaced while its request was in flight still hears the
          // answer. That answer is about a generation this page no longer
          // holds, so it may not write the page's state.
          if (saveQueueRef.current !== queue) return
          setSaveState(state)
          setSaveError(error ? String(error) : null)
        },
      )
      saveQueueRef.current = queue
      setInfo(next)
      setDraft(local)
      setHistoricalRevisionId(null)
      setHistoricalReview(null)
      setSourceSelection(local.selection?.kind === 'source_range' ? local.selection : null)
      setFocusAnchor(null)
      setSaveState('saved')
      setSaveError(null)
      setCodecError(null)
      setEditorMount((value) => value + 1)
      decisionAttemptRef.current.reset()
    },
    [reviewId],
  )

  const loadReview = useCallback(async () => {
    const sequence = ++loadSequenceRef.current
    setLoading(true)
    setPageError(null)
    try {
      const next = await api.getPlanReview({ reviewId })
      const history = await api.listPlanRevisions({ documentId: next.document.id })
      if (sequence !== loadSequenceRef.current) return
      applyReview(next)
      setRevisions(history)
    } catch (error) {
      if (sequence === loadSequenceRef.current) setPageError(String(error))
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false)
    }
  }, [applyReview, reviewId])

  useEffect(() => {
    void loadReview()
    return () => {
      loadSequenceRef.current += 1
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      // Leaving is not discarding. Whatever the debounce was still holding is
      // the last thing typed, and the queue outlives this component, so it can
      // finish the save with nobody watching.
      void saveQueueRef.current?.flush().catch(() => undefined)
    }
  }, [loadReview])

  useEffect(() => {
    if (!info || !summary) return
    const projection = `${summary.status}\0${summary.delivery_state ?? ''}`
    if (projection === observedSummaryRef.current) return
    observedSummaryRef.current = projection
    if (summary.status !== info.review.state || summary.delivery_state !== (info.delivery?.state ?? null)) {
      void loadReview()
    }
  }, [info, loadReview, summary])

  const payload = useMemo(() => (draft ? planDraftPayload(draft) : null), [draft])
  useEffect(() => {
    if (!payload || !saveQueueRef.current || info?.review.state !== 'pending' || historicalRevisionId) return
    const fingerprint = JSON.stringify(payload)
    if (fingerprint === lastPayloadRef.current) return
    lastPayloadRef.current = fingerprint
    try {
      saveQueueRef.current.enqueue(payload)
    } catch (error) {
      setSaveState('error')
      setSaveError(String(error))
      return
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void saveQueueRef.current?.flush().catch(() => undefined)
    }, 450)
  }, [historicalRevisionId, info?.review.state, payload])

  const historicalRevision = historicalRevisionId
    ? (revisions.find((revision) => revision.id === historicalRevisionId) ?? null)
    : null
  useEffect(() => {
    const sequence = ++historySequenceRef.current
    setHistoricalReview(null)
    if (!historicalRevision) return
    const linked = Object.values(summaries).find(
      (candidate) => candidate.document_id === info?.document.id && candidate.revision_id === historicalRevision.id,
    )
    if (!linked || linked.review_id === reviewId) return
    void api
      .getPlanReview({ reviewId: linked.review_id })
      .then((review) => {
        if (sequence === historySequenceRef.current) setHistoricalReview(review)
      })
      .catch(() => undefined)
  }, [historicalRevision, info?.document.id, reviewId, summaries])
  const historicalContent = useMemo(
    () => (historicalRevision ? parsePlanMarkdown(historicalRevision.content_markdown) : null),
    [historicalRevision],
  )
  const isReadOnly = info?.review.state !== 'pending' || historicalRevision !== null
  const historicalDraft = useMemo(
    () => (historicalReview ? projectPlanReviewDraft(historicalReview) : null),
    [historicalReview],
  )
  const commentDraft = historicalRevision ? historicalDraft : draft

  const rules = useMemo(
    () =>
      planReviewActionRules({
        status: info?.review.state ?? 'orphaned',
        baseMarkdown: draft?.baseMarkdown ?? '',
        draftMarkdown: draft?.markdown ?? '',
        comments: planCommentRequests(draft?.comments ?? []),
        globalNote: draft?.globalNote ?? null,
        saveState: effectiveSaveState,
        isHistorical: historicalRevision !== null,
      }),
    [draft, effectiveSaveState, historicalRevision, info],
  )

  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await saveQueueRef.current?.flush()
  }, [])

  const addComment = useCallback(
    (anchor: PlanCommentAnchor) => {
      const id = crypto.randomUUID()
      setDraft((current) => {
        if (!current) return current
        const position = Math.max(-1, ...current.comments.map((comment) => comment.position)) + 1
        return {
          ...current,
          selection: anchor,
          comments: [
            ...current.comments,
            {
              id,
              review_id: reviewId,
              position,
              state: 'active',
              anchor,
              body: '',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          ],
        }
      })
      // The rail already shows the new box where it is on screen; the sheet is
      // for where it is not.
      if (railFolded) setCommentsOpen(true)
      setCommentFocus({ commentId: id })
    },
    [railFolded, reviewId],
  )

  const selectComment = useCallback(
    (comment: PlanCommentInfoResponse) => {
      // From inside the sheet the text is behind a backdrop, so the jump would
      // be invisible; close first and let the sheet leave before taking focus.
      const wasOpen = commentsOpen
      setCommentsOpen(false)
      const apply = () => {
        if (comment.anchor.kind === 'prosemirror_range') {
          // A copy, not the stored object: the editor keys its scroll on identity.
          setFocusAnchor({ ...comment.anchor })
          return
        }
        setSourceSelection(comment.anchor)
        requestAnimationFrame(() => {
          sourceRef.current?.focus()
          sourceRef.current?.setSelectionRange(comment.anchor.from, comment.anchor.to)
        })
      }
      if (wasOpen) setTimeout(apply, SHEET_EXIT_MS)
      else apply()
    },
    [commentsOpen],
  )

  const focusComment = useCallback(
    (commentId: string) => {
      if (railFolded) setCommentsOpen(true)
      setCommentFocus({ commentId })
    },
    [railFolded],
  )

  const commentsPane = (headingId: string) =>
    commentDraft ? (
      <PlanCommentsPane
        headingId={headingId}
        comments={commentDraft.comments}
        globalNote={commentDraft.globalNote}
        isReadOnly={isReadOnly}
        focusRequest={commentFocus}
        onChangeComment={(id, body) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  comments: current.comments.map((comment) =>
                    comment.id === id ? { ...comment, body, updated_at: Date.now() } : comment,
                  ),
                }
              : current,
          )
        }
        onDeleteComment={(id) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  comments: current.comments.map((comment) =>
                    comment.id === id ? { ...comment, state: 'deleted', updated_at: Date.now() } : comment,
                  ),
                }
              : current,
          )
        }
        onSelectComment={selectComment}
        onGlobalNoteChange={(globalNote) => setDraft((current) => (current ? { ...current, globalNote } : current))}
      />
    ) : (
      <p data-slot="plan-review-no-feedback" className="p-6 text-center text-sm text-muted">
        {t('planReview.history.noFeedback')}
      </p>
    )

  const decide = async (action: 'approve' | 'request_changes') => {
    setDeciding(true)
    setPageError(null)
    try {
      await flush()
      const committed = saveQueueRef.current?.committed()
      if (!committed) throw new Error('plan draft save queue is unavailable')
      const attempt = decisionAttemptRef.current.forAction(action)
      const result = await api.decidePlanReview({
        reviewId,
        decisionId: attempt.id,
        expectedGeneration: committed.generation,
        expectedDraftHash: committed.draftHash,
        action,
      })
      setInfo((current) => (current ? { ...current, review: { ...current.review, state: result.state } } : current))
      decisionAttemptRef.current.reset()
      if (result.delivery_state !== null) {
        const delivery = await api.getPlanReviewDelivery({ reviewId })
        setInfo((current) => (current ? { ...current, delivery } : current))
      }
    } catch (error) {
      setPageError(
        error instanceof PlanDecisionInDoubtError
          ? t('planReview.decision.inDoubt', { action: t(`planReview.decision.action.${error.pending}`) })
          : String(error),
      )
    } finally {
      setDeciding(false)
    }
  }

  const discard = async () => {
    const committed = saveQueueRef.current?.committed()
    if (!committed) return
    setDeciding(true)
    setPageError(null)
    try {
      const next = await api.discardPlanReviewDraft({ reviewId, expectedGeneration: committed.generation })
      applyReview(next)
    } catch (error) {
      setPageError(String(error))
    } finally {
      setDeciding(false)
    }
  }

  const restorePlanFile = async () => {
    if (!info || restoring) return
    setRestoring(true)
    setPageError(null)
    try {
      const document = await api.resolvePlanFileConflict({ documentId: info.document.id, action: 'restore_db' })
      setInfo((current) => (current ? { ...current, document } : current))
    } catch (error) {
      setPageError(String(error))
    } finally {
      setRestoring(false)
    }
  }

  const continueDelivery = async () => {
    if (!info?.delivery || continuing) return
    setContinuing(true)
    setPageError(null)
    try {
      const delivery = await api.continuePlanReviewDelivery({ deliveryId: info.delivery.id })
      setInfo((current) => (current ? { ...current, delivery } : current))
    } catch (error) {
      setPageError(String(error))
    } finally {
      setContinuing(false)
    }
  }

  if (loading && !info) {
    return <PlanReviewSkeleton />
  }

  if (!info || !draft) {
    return (
      <div
        data-slot="plan-review-load-error"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p data-slot="plan-review-load-error-message" role="alert" className="max-w-xl text-sm text-danger">
          {t('planReview.loadError', { error: pageError ?? t('planReview.unknownError') })}
        </p>
        <div data-slot="plan-review-load-error-actions" className="flex gap-2">
          <Button variant="secondary" onClick={() => void loadReview()}>
            {t('planReview.reload')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    )
  }

  const submittedPatch = planSubmittedReviewPatch(info)
  const suggestionPatch = planSuggestionPatch(draft.baseMarkdown, draft.markdown)
  const currentRevisionNumber = info.submitted_revision.revision_no
  const visibleSource = historicalContent?.mode === 'source' ? historicalContent.sourceText : draft.sourceText
  const visibleDocument = historicalContent?.mode === 'rich' ? historicalContent.document : draft.document
  const visibleMode = historicalContent?.mode ?? draft.mode
  const visibleFallback = historicalContent?.mode === 'source' ? historicalContent.reason : draft.fallbackReason

  const reload = { label: t('planReview.reload'), run: () => void loadReview() }
  const problems: Problem[] = []
  if (effectiveSaveState === 'conflict') {
    problems.push({ key: 'save-conflict', message: t('planReview.save.conflict'), action: reload })
  } else if (effectiveSaveState === 'error') {
    problems.push({
      key: 'save-error',
      message: t('planReview.save.error', { error: saveError ?? codecError ?? t('planReview.unknownError') }),
      action: reload,
    })
  }
  if (pageError) problems.push({ key: 'page', message: pageError, action: reload })
  if (info.document.file_sync_state === 'conflict') {
    problems.push({
      key: 'file',
      message: t('planReview.fileConflict'),
      action: { label: t('planReview.restoreFile'), run: () => void restorePlanFile(), pending: restoring },
    })
  }
  if (info.delivery?.state === 'held' || info.delivery?.state === 'in_doubt') {
    // The error is the whole answer to "why does the button do nothing": a
    // retry that fails the same way lands back here with the same message.
    problems.push({
      key: 'delivery',
      message: info.delivery.error
        ? t('planReview.deliveryHeldError', { error: info.delivery.error })
        : t('planReview.deliveryHeld'),
      action: { label: t('planReview.continueDelivery'), run: () => void continueDelivery(), pending: continuing },
    })
  }
  // Progress, not a problem: the decision is made and on its way. Announced as
  // status so a screen reader is told once rather than interrupted.
  const progress =
    info.delivery?.state === 'queued'
      ? { message: t('planReview.deliveryQueued'), resumable: true }
      : info.delivery?.state === 'dispatched'
        ? { message: t('planReview.deliveryDispatched'), resumable: false }
        : null

  const historyItems = [...revisions]
    // The submitted revision is what "current review" shows; listing it again
    // is two rows for one state.
    .filter((revision) => revision.id !== info.submitted_revision.id)
    .sort((left, right) => right.revision_no - left.revision_no)

  return (
    <div ref={pageRef} data-slot="plan-review-page" className="@container flex h-full min-h-0 flex-col bg-surface">
      <header data-slot="plan-review-header" className="shrink-0 border-b border-border">
        <div
          data-slot="plan-review-header-row"
          className="mx-auto flex min-h-14 w-full max-w-[96rem] items-center gap-2 px-3 @sm:px-5"
        >
          <div data-slot="plan-review-heading" className="min-w-0 flex-1">
            <div data-slot="plan-review-title-row" className="flex items-center gap-2">
              <h1 data-slot="plan-review-title" className="truncate text-sm font-semibold">
                {t('planReview.title')}
              </h1>
              <Chip size="sm" variant="secondary">
                {t(`planReview.status.${info.review.state}`)}
              </Chip>
            </div>
            <p data-slot="plan-review-subtitle" className="flex min-w-0 items-baseline gap-1 text-xs text-muted">
              <span data-slot="plan-review-revision" className="shrink-0">
                {t('planReview.revision', { number: currentRevisionNumber })} ·
              </span>
              <Hint label={info.document.file_rel_path} className="truncate">
                {info.document.file_rel_path}
              </Hint>
            </p>
          </div>

          <Dropdown>
            <Button variant="ghost" size="small">
              <Clock />
              {historicalRevision
                ? t('planReview.revision', { number: historicalRevision.revision_no })
                : t('planReview.history.current')}
              <ChevronDown />
            </Button>
            <DropdownPopover
              placement="bottom end"
              aria-label={t('planReview.history.title')}
              selectionMode="single"
              selectedKeys={[historicalRevisionId ?? 'current']}
            >
              <DropdownItem
                id="current"
                textValue={t('planReview.history.current')}
                onAction={() => setHistoricalRevisionId(null)}
              >
                {t('planReview.history.current')}
              </DropdownItem>
              {historyItems.map((revision) => (
                <DropdownItem
                  key={revision.id}
                  id={revision.id}
                  textValue={t('planReview.revision', { number: revision.revision_no })}
                  onAction={() => {
                    setHistoricalRevisionId(revision.id)
                    setTab('plan')
                  }}
                >
                  {t('planReview.revision', { number: revision.revision_no })}
                </DropdownItem>
              ))}
            </DropdownPopover>
          </Dropdown>

          <TooltipTrigger>
            <Button iconOnly variant="ghost" size="small" aria-label={t('common.close')} onClick={onClose}>
              <Xmark />
            </Button>
            <Tooltip>{t('common.close')}</Tooltip>
          </TooltipTrigger>
        </div>
      </header>

      {problems.length > 0 && (
        <div
          data-slot="plan-review-problems"
          className="shrink-0 divide-y divide-warning/20 border-b border-border bg-warning-soft text-sm text-warning-soft-foreground"
        >
          {problems.map((problem) => (
            <div
              data-slot="plan-review-problem"
              key={problem.key}
              className="mx-auto flex max-w-[96rem] items-center gap-3 px-4 py-2"
            >
              <TriangleExclamation className="shrink-0" />
              <p data-slot="plan-review-problem-message" role="alert" className="min-w-0 flex-1 break-words">
                {problem.message}
              </p>
              {problem.action && (
                <Button size="small" variant="secondary" disabled={problem.action.pending} onClick={problem.action.run}>
                  {problem.action.label}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {progress && (
        <div
          data-slot="plan-review-progress"
          className="shrink-0 border-b border-border bg-accent-soft px-4 py-2 text-sm text-accent"
        >
          <div data-slot="plan-review-progress-row" className="mx-auto flex max-w-[96rem] items-center gap-3">
            <p data-slot="plan-review-progress-message" role="status" className="min-w-0 flex-1 break-words">
              {progress.message}
            </p>
            {progress.resumable && (
              <Button size="small" variant="secondary" disabled={continuing} onClick={() => void continueDelivery()}>
                {t('planReview.continueDelivery')}
              </Button>
            )}
          </div>
        </div>
      )}

      <div
        data-slot="plan-review-body"
        className="mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col px-0 @sm:px-5"
      >
        <div
          data-slot="plan-review-toolbar"
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 @sm:px-0"
        >
          <Segment
            aria-label={t('planReview.views')}
            size="sm"
            selectedKey={tab}
            onSelectionChange={(key: Key) => setTab(key as ReviewTab)}
          >
            <Segment.Item id="plan">{t('planReview.tabs.plan')}</Segment.Item>
            <Segment.Item id="changes" isDisabled={historicalRevision !== null}>
              {t('planReview.tabs.changes')}
            </Segment.Item>
            <Segment.Item id="suggestions" isDisabled={historicalRevision !== null}>
              {t('planReview.tabs.suggestions')}
            </Segment.Item>
          </Segment>
          <span data-slot="plan-review-save-state" className="ms-auto text-xs text-muted" role="status">
            {effectiveSaveState === 'error'
              ? t('planReview.save.failed')
              : effectiveSaveState === 'conflict'
                ? t('planReview.save.conflictShort')
                : t(`planReview.save.${saveState}`)}
          </span>
          <Button
            size="small"
            variant="ghost"
            className="plan-review-comments-trigger"
            onClick={() => setCommentsOpen(true)}
          >
            <Comment />
            {t('planReview.comments.title')}
          </Button>
        </div>

        <div data-slot="plan-review-workspace" className="plan-review-workspace min-h-0 flex-1">
          <section
            data-slot="plan-review-document"
            className="plan-review-document min-h-0 overflow-hidden"
            aria-label={t(`planReview.tabs.${tab}`)}
          >
            {tab === 'changes' ? (
              <div data-slot="plan-review-changes" className="h-full overflow-y-auto">
                <PlanDiff patch={submittedPatch} emptyLabel={t('planReview.diff.emptyChanges')} />
              </div>
            ) : tab === 'suggestions' ? (
              <div data-slot="plan-review-suggestions" className="h-full overflow-y-auto">
                <PlanDiff patch={suggestionPatch} emptyLabel={t('planReview.diff.emptySuggestions')} />
              </div>
            ) : visibleMode === 'rich' && visibleDocument ? (
              <PlanReviewEditor
                key={historicalRevision ? `history:${historicalRevision.id}` : `draft:${editorMount}`}
                defaultValue={visibleDocument}
                comments={historicalRevision ? (historicalDraft?.comments ?? []) : draft.comments}
                isReadOnly={isReadOnly}
                focusAnchor={focusAnchor}
                onAddComment={addComment}
                onCommentClick={focusComment}
                onChange={(liveDocument, anchors) => {
                  if (isReadOnly) return
                  try {
                    const document = normalizePlanEditorDocument(liveDocument)
                    const markdown = serializePlanDocument(document)
                    setCodecError(null)
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            document,
                            markdown,
                            comments: current.comments.map((comment) => {
                              if (comment.anchor.kind !== 'prosemirror_range' || comment.state === 'deleted') {
                                return comment
                              }
                              const anchor = anchors.get(comment.id)
                              return anchor
                                ? { ...comment, anchor, updated_at: Date.now() }
                                : { ...comment, state: 'orphaned', updated_at: Date.now() }
                            }),
                          }
                        : current,
                    )
                  } catch (error) {
                    setCodecError(String(error))
                  }
                }}
              />
            ) : (
              <div data-slot="plan-review-source" className="flex h-full min-h-0 flex-col">
                {visibleFallback && (
                  <p
                    data-slot="plan-review-source-fallback"
                    className="shrink-0 border-b border-border bg-surface-secondary px-4 py-2 text-xs text-muted"
                  >
                    {t(`planReview.source.reason.${visibleFallback}`)}
                  </p>
                )}
                <SourceEditor
                  value={visibleSource}
                  isReadOnly={isReadOnly}
                  selection={sourceSelection}
                  textareaRef={sourceRef}
                  // Local only. The rich editor persists a selection when a
                  // comment is added and not before; writing every drag into
                  // the draft here made each one a save — the status flickered
                  // and Approve went dark for the round trip.
                  onSelectionChange={setSourceSelection}
                  onAddComment={addComment}
                  onChange={(sourceText) => {
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            sourceText,
                            markdown: sourceText,
                            selection: null,
                            comments: current.comments.map((comment) => {
                              if (comment.anchor.kind !== 'source_range' || comment.state === 'deleted') return comment
                              const anchor = remapSourceRange(sourceText, comment.anchor)
                              return anchor
                                ? { ...comment, anchor, updated_at: Date.now() }
                                : { ...comment, state: 'orphaned', updated_at: Date.now() }
                            }),
                          }
                        : current,
                    )
                    setSourceSelection(null)
                  }}
                />
              </div>
            )}
          </section>

          <aside
            data-slot="plan-review-comments-aside"
            className="plan-review-comments-aside min-h-0 border-s border-border"
          >
            {commentsPane('plan-comments-aside-heading')}
          </aside>
        </div>
      </div>

      <footer data-slot="plan-review-footer" className="shrink-0 border-t border-border bg-surface px-3 py-3 @sm:px-5">
        <div
          data-slot="plan-review-footer-row"
          className="mx-auto flex max-w-[96rem] flex-col gap-3 @sm:flex-row @sm:items-center"
        >
          <div data-slot="plan-review-footer-status" className="min-w-0 flex-1">
            <p data-slot="plan-review-decision-state" className="text-xs text-muted">
              {info.review.state === 'pending'
                ? t('planReview.queueHeld')
                : t(`planReview.decision.${info.review.state}`)}
            </p>
            {!rules.canApprove &&
              info.review.state === 'pending' &&
              rules.isPristine &&
              effectiveSaveState !== 'saved' && (
                <p data-slot="plan-review-wait-for-save" className="text-xs text-muted">
                  {t('planReview.waitForSave')}
                </p>
              )}
          </div>
          <div data-slot="plan-review-decision-actions" className="flex shrink-0 items-center justify-end gap-2">
            <Button
              variant="ghost"
              disabled={deciding || effectiveSaveState !== 'saved' || rules.isPristine || isReadOnly}
              onClick={() => void discard()}
            >
              {t('planReview.discard')}
            </Button>
            <Button
              variant="secondary"
              disabled={deciding || !rules.canRequestChanges}
              onClick={() => void decide('request_changes')}
            >
              {t('planReview.requestChanges')}
            </Button>
            <Button variant="primary" disabled={deciding} onClick={() => void decide('approve')}>
              {t('planReview.approve')}
            </Button>
          </div>
        </div>
      </footer>

      {/* Portalled to `body`, so this is the one width here that really is
          about the viewport rather than the page. */}
      <Sheet isOpen={commentsOpen} placement="right" onOpenChange={setCommentsOpen} isDismissable>
        <Sheet.Backdrop variant="blur">
          <Sheet.Content className="w-full sm:max-w-md">
            <Sheet.Dialog className="flex h-full min-h-0 flex-col">
              <Sheet.Header>
                <Sheet.Heading>{t('planReview.comments.title')}</Sheet.Heading>
                <Sheet.CloseTrigger aria-label={t('common.close')} />
              </Sheet.Header>
              <Sheet.Body data-sheet-no-drag className="min-h-0 flex-1 p-0">
                {commentsPane('plan-comments-sheet-heading')}
              </Sheet.Body>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    </div>
  )
}
