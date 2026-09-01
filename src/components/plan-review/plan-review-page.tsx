import { useCallback, useEffect, useMemo, useRef, useState, type Key, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { ChevronDown, Clock, Comment, TriangleExclamation, Xmark } from '@gravity-ui/icons'
import { Button, Chip, Dropdown, Spinner, TextArea, Tooltip } from '@heroui/react'
import { Segment } from '@heroui-pro/react/segment'
import { Sheet } from '@heroui-pro/react/sheet'

import { api } from '@/api'
import { FileDiffCard } from '@/components/chat/file-diff-card'
import { remapSourceRange, sourceRangeAnchor } from '@/lib/plan-comment-decorations'
import { parsePatchText } from '@/lib/patch-parse'
import { parsePlanMarkdown, planSuggestionPatch, serializePlanDocument } from '@/lib/plan-markdown'
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

import { PlanCommentsPane } from './plan-comments-pane'
import { PlanReviewEditor } from './plan-review-editor'

type ReviewTab = 'plan' | 'changes' | 'suggestions'

function PlanDiff({ patch, emptyLabel }: { patch: string; emptyLabel: string }) {
  const files = useMemo(() => parsePatchText(patch), [patch])
  if (!patch || files.length === 0) {
    return <p className="px-5 py-12 text-center text-sm text-muted">{emptyLabel}</p>
  }
  return (
    <div className="space-y-3 p-4">
      {files.map((file, index) => (
        <FileDiffCard key={`${file.path}:${index}`} diff={file} />
      ))}
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
    <div className="flex h-full min-h-0 flex-col">
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
        <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
          <p className="text-xs text-muted">{t('planReview.source.exactOffsets')}</p>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!selection}
            onPress={() => selection && onAddComment(selection)}
          >
            <Comment />
            {t('planReview.comments.add')}
          </Button>
        </div>
      )}
    </div>
  )
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
  const [pageError, setPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState(false)
  const [editorMount, setEditorMount] = useState(0)
  const [focusAnchor, setFocusAnchor] = useState<PlanProseMirrorRange | null>(null)
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

  const applyReview = useCallback(
    (next: PlanReviewInfoResponse) => {
      const local = projectPlanReviewDraft(next)
      const payload = planDraftPayload(local)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      lastPayloadRef.current = JSON.stringify(payload)
      saveQueueRef.current = new PlanDraftSaveQueue(
        reviewId,
        api.savePlanReviewDraft,
        next.draft.generation,
        next.draft.draft_sha256,
        (state, error) => {
          setSaveState(state)
          setSaveError(error ? String(error) : null)
        },
      )
      setInfo(next)
      setDraft(local)
      setHistoricalRevisionId(null)
      setHistoricalReview(null)
      setSourceSelection(local.selection?.kind === 'source_range' ? local.selection : null)
      setFocusAnchor(null)
      setSaveState('saved')
      setSaveError(null)
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
      saveQueueRef.current?.clearPending()
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
        saveState,
        isHistorical: historicalRevision !== null,
      }),
    [draft, historicalRevision, info, saveState],
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
      setDraft((current) => {
        if (!current) return current
        const position = Math.max(-1, ...current.comments.map((comment) => comment.position)) + 1
        return {
          ...current,
          selection: anchor,
          comments: [
            ...current.comments,
            {
              id: crypto.randomUUID(),
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
      setCommentsOpen(true)
    },
    [reviewId],
  )

  const selectComment = useCallback((comment: PlanCommentInfoResponse) => {
    if (comment.anchor.kind === 'prosemirror_range') {
      setFocusAnchor(comment.anchor)
      return
    }
    setSourceSelection(comment.anchor)
    requestAnimationFrame(() => {
      sourceRef.current?.focus()
      sourceRef.current?.setSelectionRange(comment.anchor.from, comment.anchor.to)
    })
  }, [])

  const commentsPane = (headingId: string) =>
    commentDraft ? (
      <PlanCommentsPane
        headingId={headingId}
        comments={commentDraft.comments}
        globalNote={commentDraft.globalNote}
        isReadOnly={isReadOnly}
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
      <p className="p-6 text-center text-sm text-muted">{t('planReview.history.noFeedback')}</p>
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
      setPageError(String(error))
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
    if (!info) return
    setPageError(null)
    try {
      const document = await api.resolvePlanFileConflict({ documentId: info.document.id, action: 'restore_db' })
      setInfo((current) => (current ? { ...current, document } : current))
    } catch (error) {
      setPageError(String(error))
    }
  }

  const continueDelivery = async () => {
    if (!info?.delivery) return
    setPageError(null)
    try {
      const delivery = await api.continuePlanReviewDelivery({ deliveryId: info.delivery.id })
      setInfo((current) => (current ? { ...current, delivery } : current))
    } catch (error) {
      setPageError(String(error))
    }
  }

  if (loading && !info) {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Spinner size="sm" />
        {t('planReview.loading')}
      </div>
    )
  }

  if (!info || !draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" className="max-w-xl text-sm text-danger">
          {t('planReview.loadError', { error: pageError ?? t('planReview.unknownError') })}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onPress={() => void loadReview()}>
            {t('planReview.reload')}
          </Button>
          <Button variant="ghost" onPress={onClose}>
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

  return (
    <div data-slot="plan-review-page" className="@container flex h-full min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex min-h-14 w-full max-w-[96rem] items-center gap-2 px-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{t('planReview.title')}</h1>
              <Chip size="sm" variant="secondary">
                {t(`planReview.status.${info.review.state}`)}
              </Chip>
            </div>
            <p className="truncate text-xs text-muted">
              {t('planReview.revision', { number: currentRevisionNumber })} · {info.document.file_rel_path}
            </p>
          </div>

          <Dropdown>
            <Button variant="ghost" size="sm" aria-label={t('planReview.history.title')}>
              <Clock />
              <span className="hidden sm:inline">
                {historicalRevision
                  ? t('planReview.revision', { number: historicalRevision.revision_no })
                  : t('planReview.history.current')}
              </span>
              <ChevronDown />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu aria-label={t('planReview.history.title')}>
                <Dropdown.Item
                  id="current"
                  textValue={t('planReview.history.current')}
                  onAction={() => setHistoricalRevisionId(null)}
                >
                  {t('planReview.history.current')}
                </Dropdown.Item>
                {[...revisions]
                  .sort((left, right) => right.revision_no - left.revision_no)
                  .map((revision) => (
                    <Dropdown.Item
                      key={revision.id}
                      id={revision.id}
                      textValue={t('planReview.history.item', { number: revision.revision_no })}
                      onAction={() => {
                        setHistoricalRevisionId(revision.id === info.submitted_revision.id ? null : revision.id)
                        setTab('plan')
                      }}
                    >
                      {t('planReview.history.item', { number: revision.revision_no })}
                    </Dropdown.Item>
                  ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          <Tooltip>
            <Button isIconOnly variant="ghost" size="sm" aria-label={t('common.close')} onPress={onClose}>
              <Xmark />
            </Button>
            <Tooltip.Content>{t('common.close')}</Tooltip.Content>
          </Tooltip>
        </div>
      </header>

      {(info.document.file_sync_state === 'conflict' ||
        info.delivery?.state === 'queued' ||
        info.delivery?.state === 'dispatched' ||
        info.delivery?.state === 'held' ||
        info.delivery?.state === 'in_doubt' ||
        saveState === 'conflict' ||
        saveState === 'error' ||
        pageError) && (
        <div className="shrink-0 border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning-soft-foreground">
          <div className="mx-auto flex max-w-[96rem] items-center gap-3">
            <TriangleExclamation className="shrink-0" />
            <p role="alert" className="min-w-0 flex-1 break-words">
              {saveState === 'conflict'
                ? t('planReview.save.conflict')
                : saveState === 'error'
                  ? t('planReview.save.error', { error: saveError })
                  : pageError
                    ? pageError
                    : info.document.file_sync_state === 'conflict'
                      ? t('planReview.fileConflict')
                      : info.delivery?.state === 'queued'
                        ? t('planReview.deliveryQueued')
                        : info.delivery?.state === 'dispatched'
                          ? t('planReview.deliveryDispatched')
                          : t('planReview.deliveryHeld')}
            </p>
            {(saveState === 'conflict' || saveState === 'error') && (
              <Button size="sm" variant="secondary" onPress={() => void loadReview()}>
                {t('planReview.reload')}
              </Button>
            )}
            {info.document.file_sync_state === 'conflict' && (
              <Button size="sm" variant="secondary" onPress={() => void restorePlanFile()}>
                {t('planReview.restoreFile')}
              </Button>
            )}
            {(info.delivery?.state === 'queued' ||
              info.delivery?.state === 'held' ||
              info.delivery?.state === 'in_doubt') && (
              <Button size="sm" variant="secondary" onPress={() => void continueDelivery()}>
                {t('planReview.continueDelivery')}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col px-0 sm:px-5">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:px-0">
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
          <span className="ms-auto text-xs text-muted" role="status">
            {t(`planReview.save.${saveState}`)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="plan-review-comments-trigger"
            onPress={() => setCommentsOpen(true)}
          >
            <Comment />
            {t('planReview.comments.title')}
          </Button>
        </div>

        <div className="plan-review-workspace min-h-0 flex-1">
          <section className="plan-review-document min-h-0 overflow-hidden" aria-label={t(`planReview.tabs.${tab}`)}>
            {tab === 'changes' ? (
              <div className="h-full overflow-y-auto">
                <PlanDiff patch={submittedPatch} emptyLabel={t('planReview.diff.emptyChanges')} />
              </div>
            ) : tab === 'suggestions' ? (
              <div className="h-full overflow-y-auto">
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
                onChange={(document, anchors) => {
                  if (isReadOnly) return
                  try {
                    const markdown = serializePlanDocument(document)
                    setSaveError(null)
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
                    setSaveState('error')
                    setSaveError(String(error))
                  }
                }}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                {visibleFallback && (
                  <p className="shrink-0 border-b border-border bg-surface-secondary px-4 py-2 text-xs text-muted">
                    {t(`planReview.source.reason.${visibleFallback}`)}
                  </p>
                )}
                <SourceEditor
                  value={visibleSource}
                  isReadOnly={isReadOnly}
                  selection={sourceSelection}
                  textareaRef={sourceRef}
                  onSelectionChange={(selection) => {
                    setSourceSelection(selection)
                    setDraft((current) => (current ? { ...current, selection } : current))
                  }}
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

          <aside className="plan-review-comments-aside min-h-0 border-s border-border">
            {commentsPane('plan-comments-aside-heading')}
          </aside>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-surface px-3 py-3 sm:px-5">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {info.review.state === 'pending'
                ? t('planReview.queueHeld')
                : t(`planReview.decision.${info.review.state}`)}
            </p>
            {!rules.canApprove && info.review.state === 'pending' && rules.isPristine && saveState !== 'saved' && (
              <p className="text-xs text-muted">{t('planReview.waitForSave')}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button
              variant="ghost"
              isDisabled={deciding || saveState !== 'saved' || rules.isPristine || isReadOnly}
              onPress={() => void discard()}
            >
              {t('planReview.discard')}
            </Button>
            <Button
              variant="secondary"
              isDisabled={deciding || !rules.canRequestChanges}
              onPress={() => void decide('request_changes')}
            >
              {t('planReview.requestChanges')}
            </Button>
            <Button
              variant="primary"
              isPending={deciding}
              isDisabled={deciding || !rules.canApprove}
              onPress={() => void decide('approve')}
            >
              {t('planReview.approve')}
            </Button>
          </div>
        </div>
      </footer>

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
