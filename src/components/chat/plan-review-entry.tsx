import './plan-review-entry.css'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton } from 'react-aria-components'
import { ArrowUTurnLeft, Check, ChevronsRight, List, RefreshCw, Zap } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { MenuItem, MenuSeparator } from '@/components/yuerchu-ui/components/menu/menu'
import { SplitButton } from '@/components/yuerchu-ui/components/split-button/split-button'
import { BUBBLE_BLOCK, BubbleBlockButton } from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
import { ChatToolPresentationContext } from '@/components/yuerchu-ui/components/chat-tool/chat-tool'
import { errorMessage } from '@/lib/error-message'
import {
  approveFromCard,
  draftIsPristine,
  planCardPreview,
  sendBackFromCard,
  type PlanCardPreview,
} from '@/lib/plan-card'
import {
  PLAN_APPROVAL_OPTIONS,
  PlanDecisionAttempt,
  PlanDecisionInDoubtError,
  type PlanApprovalOptionKey,
  type PlanApprovalOptions,
} from '@/lib/plan-review-draft'
import { planReviewStatusOfTool } from '@/lib/plan-review-status'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { PlanReviewStatus, ToolCallDisplay } from '@/types'

/**
 * Which revision this is and how it starts, read from the review itself.
 *
 * Read again whenever the review's projection moves (its lock version) and
 * when the review page closes, so a card under a page that was just used is
 * not describing the plan as it was before. A failed read leaves the card
 * without a preview: it still opens the page, which reports the failure.
 *
 * Each read also says whether the draft is untouched, numbered so the card can
 * tell a read taken after it found a draft in progress from one taken before.
 */
interface CardRead {
  preview: PlanCardPreview
  pristine: boolean
  seq: number
}

type CardReadState = { status: 'loading' } | { status: 'ready'; read: CardRead } | { status: 'unavailable' }

function usePlanCardRead(reviewId: string, lockVersion: number | undefined): CardRead | null {
  const [state, setState] = useState<CardReadState>({ status: 'loading' })
  const seq = useRef(0)
  const pageOpen = usePlanReviewStore((state) => state.activeReviewId === reviewId)
  useEffect(() => {
    if (pageOpen) return
    let cancelled = false
    api.planReview
      .get({ review_id: reviewId })
      .then((info) => {
        if (cancelled) return
        seq.current += 1
        setState({
          status: 'ready',
          read: { preview: planCardPreview(info), pristine: draftIsPristine(info), seq: seq.current },
        })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [reviewId, lockVersion, pageOpen])
  return state.status === 'ready' ? state.read : null
}

export type CardUi =
  | { step: 'idle' }
  | { step: 'feedback' }
  | { step: 'deciding' }
  /** The draft holds the reviewer's own work: only the page may decide now. */
  | { step: 'draft' }
  | { step: 'error'; message: string }

/**
 * A plan waiting on review, in the transcript: the revision, the first lines,
 * and the decision itself when there is nothing more to say than yes or a
 * sentence of why not.
 *
 * The review page is still where a plan is read and annotated; the card does
 * not render the plan, it identifies it. Approve and send-back here are the
 * page's own two decisions — the same command, the same generation and hash,
 * read at the moment of the press (`lib/plan-card.ts`) — offered only while
 * the draft is untouched. A draft with edits, comments or a note is the
 * reviewer's work in progress, and the card says to finish it on the page
 * rather than deciding past it.
 *
 * Once settled the card goes back to being a key to the page: a past plan is
 * history, and a column of excerpts for every one of them is noise.
 */
export function PlanReviewEntryBlock({ data, reviewId }: { data: ToolCallDisplay; reviewId: string }) {
  const { t } = useTranslation()
  const openReview = usePlanReviewStore((state) => state.openReview)
  const summary = usePlanReviewStore((state) => state.summaries[reviewId])
  const status = summary?.status ?? planReviewStatusOfTool(data.status)
  const read = usePlanCardRead(reviewId, summary?.lock_version)
  const readSeq = read?.seq ?? 0

  const [ui, setUi] = useState<CardUi>({ step: 'idle' })
  // Which read was current when a press found the draft in progress. A later
  // read that finds the draft untouched again — the one taken when the review
  // page closes, after the reviewer discarded or undid their work — lifts it;
  // a held `draft` step would otherwise keep both decisions off this card for
  // as long as the transcript stayed mounted.
  const [draftSeenAt, setDraftSeenAt] = useState(0)
  const shownUi: CardUi =
    ui.step === 'draft' && read !== null && read.seq > draftSeenAt && read.pristine ? { step: 'idle' } : ui
  const [note, setNote] = useState('')
  // One per card, kept across presses: a reply lost on the way back is retried
  // under the same decision id, which the backend answers idempotently.
  const attemptRef = useRef<PlanDecisionAttempt | null>(null)
  attemptRef.current ??= new PlanDecisionAttempt()
  const attempt = attemptRef.current

  const decide = useCallback(
    (run: () => ReturnType<typeof approveFromCard>) => {
      setUi({ step: 'deciding' })
      run()
        .then((outcome) => {
          // `decided` and `settled` were already taken into the stores by
          // `lib/plan-card.ts`, so `status` moves without waiting on the event.
          if (outcome.kind === 'draft_in_progress') {
            setDraftSeenAt(readSeq)
            setUi({ step: 'draft' })
          } else setUi({ step: 'idle' })
        })
        .catch((error: unknown) => {
          setUi({
            step: 'error',
            message:
              error instanceof PlanDecisionInDoubtError
                ? t('planReview.decision.inDoubt', { action: t(`planReview.decision.action.${error.pending}`) })
                : errorMessage(error),
          })
        })
    },
    [t, readSeq],
  )
  const approve = (options: PlanApprovalOptions = PLAN_APPROVAL_OPTIONS.default, inlineNote?: string) =>
    decide(() => approveFromCard(reviewId, attempt, options, inlineNote))
  const sendBack = () => {
    if (note.trim()) decide(() => sendBackFromCard(reviewId, note.trim(), attempt))
  }

  return (
    <PlanReviewEntryView
      status={status}
      preview={read?.preview ?? null}
      ui={shownUi}
      note={note}
      onNoteChange={setNote}
      onUiChange={setUi}
      onOpen={() => openReview(reviewId)}
      onApprove={approve}
      onSendBack={sendBack}
    />
  )
}

/**
 * The card as drawn, from its state alone: no store, no backend. The
 * container above owns the reads and the decisions; this is what the
 * playground renders for every step a press can lead to.
 */
export function PlanReviewEntryView({
  status,
  preview,
  ui,
  note,
  onNoteChange,
  onUiChange,
  onOpen,
  onApprove,
  onSendBack,
}: {
  status: PlanReviewStatus
  preview: PlanCardPreview | null
  ui: CardUi
  note: string
  onNoteChange: (note: string) => void
  onUiChange: (ui: CardUi) => void
  onOpen: () => void
  onApprove: (options?: PlanApprovalOptions, inlineNote?: string) => void
  onSendBack: () => void
}) {
  const { t } = useTranslation()
  const presentation = useContext(ChatToolPresentationContext)
  const pending = status === 'pending'

  const revision = preview ? (
    <span data-slot="plan-review-entry-revision" className="m-plan-review-entry__revision">
      {t('chat.plan.revision', { n: preview.revisionNo })}
    </span>
  ) : null

  const statusChip = (
    <span className="m-plan-review-entry__status">
      <Badge size="sm">{t(`planReview.status.${status}`)}</Badge>
    </span>
  )

  const excerpt =
    preview && (preview.excerpt.title || preview.excerpt.lines.length > 0) ? (
      // The plan's opening, and the way into the page: the part that says
      // which plan is the part that opens it.
      <AriaButton data-slot="plan-review-entry-excerpt" onPress={onOpen} className="m-plan-review-entry__excerpt">
        {preview.excerpt.title && (
          <span data-slot="plan-review-entry-excerpt-title" className="m-plan-review-entry__excerpt-title">
            {preview.excerpt.title}
          </span>
        )}
        {keyedLines(preview.excerpt.lines).map(({ line, key }) => (
          <span key={key} data-slot="plan-review-entry-excerpt-line" className="m-plan-review-entry__excerpt-line">
            {line}
          </span>
        ))}
      </AriaButton>
    ) : null

  const actions = pending ? (
    <div data-slot="plan-review-entry-actions" className="m-plan-review-entry__actions">
      {ui.step === 'feedback' ? (
        <div data-slot="plan-review-entry-feedback" className="m-plan-review-entry__feedback">
          <TextField
            name="plan-feedback"
            autoComplete="off"
            aria-label={t('chat.plan.feedbackLabel')}
            value={note}
            onChange={(e) => onNoteChange(e)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') onSendBack()
            }}
            placeholder={t('chat.plan.feedbackPlaceholder')}
            autoFocus
          />
          <div className="m-plan-review-entry__feedback-actions">
            <Button size="sm" variant="ghost" onPress={() => onUiChange({ step: 'idle' })}>
              {t('chat.tool.cancel')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Check />}
              isDisabled={!note.trim()}
              onPress={() => onApprove(PLAN_APPROVAL_OPTIONS.default, note.trim())}
            >
              {t('chat.plan.approveWithNote')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<ArrowUTurnLeft />}
              isDisabled={!note.trim()}
              onPress={onSendBack}
            >
              {t('chat.plan.sendBack')}
            </Button>
          </div>
        </div>
      ) : ui.step === 'deciding' ? (
        <div data-slot="plan-review-entry-deciding" className="m-plan-review-entry__deciding">
          <span aria-hidden>
            <Spinner size="sm" />
          </span>
          <span>{t('chat.tool.running')}</span>
        </div>
      ) : (
        <>
          <p data-slot="plan-review-entry-description" className="m-plan-review-entry__description">
            {ui.step === 'draft' ? t('chat.plan.draftInProgress') : t('chat.plan.reviewReady')}
          </p>
          {ui.step === 'error' && (
            <p data-slot="plan-review-entry-error" role="alert" className="m-plan-review-entry__error">
              {ui.message}
            </p>
          )}
          <div className="m-plan-review-entry__action-row">
            {ui.step === 'draft' ? (
              <Button size="sm" variant="primary" onPress={onOpen}>
                {t('chat.plan.review')}
              </Button>
            ) : (
              <>
                <SplitButton
                  size="sm"
                  icon={<Check />}
                  onPress={() => onApprove(PLAN_APPROVAL_OPTIONS.default)}
                  menuLabel={t('chat.plan.moreModes')}
                  placement="bottom start"
                  onAction={(key) => {
                    if (key in PLAN_APPROVAL_OPTIONS) {
                      onApprove(PLAN_APPROVAL_OPTIONS[key as PlanApprovalOptionKey])
                    }
                  }}
                  menu={
                    <>
                      <MenuItem id="default" icon={<Check />}>
                        {t('planReview.mode.default')}
                      </MenuItem>
                      <MenuItem id="accept_edits" icon={<ChevronsRight />}>
                        {t('planReview.mode.acceptEdits')}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem id="clear_context_default" icon={<RefreshCw />}>
                        {t('planReview.mode.clearContextDefault')}
                      </MenuItem>
                      <MenuItem id="clear_context_accept_edits" icon={<Zap />}>
                        {t('planReview.mode.clearContextAcceptEdits')}
                      </MenuItem>
                    </>
                  }
                >
                  {t('chat.plan.approve')}
                </SplitButton>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ArrowUTurnLeft />}
                  onPress={() => onUiChange({ step: 'feedback' })}
                >
                  {t('chat.plan.revise')}
                </Button>
                <Button size="sm" variant="ghost" onPress={onOpen}>
                  {t('chat.plan.review')}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  ) : null

  // A key that goes somewhere rather than opening something, once there is
  // nothing left to decide: the review has a page of its own.
  if (presentation === 'bubble' && !pending) {
    return (
      <BubbleBlockButton data-slot="plan-review-entry" data-status={status} state="output-available" onPress={onOpen}>
        <List aria-hidden className="m-plan-review-entry__key-icon" />
        <span data-slot="plan-review-entry-title" className="m-plan-review-entry__key-title">
          {t('chat.plan.title')}
        </span>
        {revision && <span className="m-plan-review-entry__key-revision">{revision}</span>}
        {statusChip}
      </BubbleBlockButton>
    )
  }

  if (presentation === 'bubble') {
    return (
      <div
        data-slot="plan-review-entry"
        data-status={status}
        data-bubble-block=""
        // The column and the info ring of a block still waiting on the reader
        // (`BubbleBlockButton`'s `navigate`), as a block rather than a button:
        // it holds buttons of its own now.
        className={BUBBLE_BLOCK + ' m-plan-review-entry__bubble'}
      >
        <div data-slot="plan-review-entry-heading" className="m-plan-review-entry__bubble-heading">
          <List aria-hidden className="m-plan-review-entry__bubble-icon" />
          <span data-slot="plan-review-entry-title" className="m-plan-review-entry__bubble-title">
            {t('chat.plan.title')}
          </span>
          {revision}
          {statusChip}
        </div>
        {excerpt}
        {actions}
      </div>
    )
  }

  return (
    <div data-slot="plan-review-entry" data-status={status} className="m-plan-review-entry__card">
      <div data-slot="plan-review-entry-heading" className="m-plan-review-entry__card-heading">
        <List aria-hidden className="m-plan-review-entry__card-icon" />
        <span data-slot="plan-review-entry-title" className="m-plan-review-entry__card-title">
          {t('chat.plan.title')}
        </span>
        {revision && <span className="m-plan-review-entry__card-revision">{revision}</span>}
        {statusChip}
      </div>
      {excerpt}
      {pending ? (
        actions
      ) : (
        <div className="m-plan-review-entry__history">
          <p data-slot="plan-review-entry-description" className="m-plan-review-entry__history-description">
            {t('chat.plan.reviewHistory')}
          </p>
          <Button size="sm" variant="secondary" onPress={onOpen}>
            {t('chat.plan.review')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Keys for the excerpt's lines: the text, and which occurrence of it this is,
 *  since a plan can repeat a line ("- [ ] test") inside three of them. */
function keyedLines(lines: string[]): { line: string; key: string }[] {
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const n = seen.get(line) ?? 0
    seen.set(line, n + 1)
    return { line, key: `${n}:${line}` }
  })
}
