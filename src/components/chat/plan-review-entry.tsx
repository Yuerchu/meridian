import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton } from 'react-aria-components'
import { ArrowUTurnLeft, Check, List } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { Button, Chip, Input, Spinner } from '@/components/base'
import { BUBBLE_BLOCK } from '@/components/ui/bubble'
import { BubbleBlockButton } from '@/components/ui/bubble-block'
import { ChatToolPresentationContext } from '@/components/ui/chat-tool'
import { errorMessage } from '@/lib/error-message'
import {
  approveFromCard,
  draftIsPristine,
  planCardPreview,
  sendBackFromCard,
  type PlanCardPreview,
} from '@/lib/plan-card'
import { PlanDecisionAttempt, PlanDecisionInDoubtError } from '@/lib/plan-review-draft'
import { planReviewStatusOfTool } from '@/lib/plan-review-status'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { PlanReviewStatus, ToolCallDisplay } from '@/types'
import { cx } from '@/utils/cx'

/** See `FIELD_ON_CARD` in `tool-call-block.tsx`. */
const FIELD_ON_CARD = 'bg-background-secondary-default'

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
    api
      .getPlanReview({ reviewId })
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
  const approve = () => decide(() => approveFromCard(reviewId, attempt))
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
  onApprove: () => void
  onSendBack: () => void
}) {
  const { t } = useTranslation()
  const presentation = useContext(ChatToolPresentationContext)
  const pending = status === 'pending'

  const revision = preview ? (
    <span data-slot="plan-review-entry-revision" className="shrink-0 text-text-secondary tabular-nums">
      {t('chat.plan.revision', { n: preview.revisionNo })}
    </span>
  ) : null

  const statusChip = (
    <Chip size="sm" variant="secondary" className="ml-auto shrink-0">
      {t(`planReview.status.${status}`)}
    </Chip>
  )

  const excerpt =
    preview && (preview.excerpt.title || preview.excerpt.lines.length > 0) ? (
      // The plan's opening, and the way into the page: the part that says
      // which plan is the part that opens it.
      <AriaButton
        data-slot="plan-review-entry-excerpt"
        onPress={onOpen}
        className="block w-full min-w-0 cursor-pointer rounded-xl bg-background-primary-default px-3 py-2.5 text-left outline-none transition-colors duration-150 data-[hovered]:bg-background-primary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring"
      >
        {preview.excerpt.title && (
          <span
            data-slot="plan-review-entry-excerpt-title"
            className="block truncate text-body-semibold text-text-primary"
          >
            {preview.excerpt.title}
          </span>
        )}
        {keyedLines(preview.excerpt.lines).map(({ line, key }) => (
          <span
            key={key}
            data-slot="plan-review-entry-excerpt-line"
            className="block truncate text-body-2-regular text-text-secondary"
          >
            {line}
          </span>
        ))}
      </AriaButton>
    ) : null

  const actions = pending ? (
    <div data-slot="plan-review-entry-actions" className="flex flex-col gap-2">
      {ui.step === 'feedback' ? (
        <div data-slot="plan-review-entry-feedback" className="flex flex-col gap-2">
          <Input
            type="text"
            name="plan-feedback"
            autoComplete="off"
            aria-label={t('chat.plan.feedbackLabel')}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') onSendBack()
            }}
            placeholder={t('chat.plan.feedbackPlaceholder')}
            className="text-caption-1-regular"
            fieldClassName={FIELD_ON_CARD}
            autoFocus
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="small" variant="secondary" onPress={() => onUiChange({ step: 'idle' })}>
              {t('chat.tool.cancel')}
            </Button>
            <Button size="small" leadingIcon={ArrowUTurnLeft} isDisabled={!note.trim()} onPress={onSendBack}>
              {t('chat.plan.sendBack')}
            </Button>
          </div>
        </div>
      ) : ui.step === 'deciding' ? (
        <div data-slot="plan-review-entry-deciding" className="flex items-center gap-2 text-text-secondary">
          <Spinner size="sm" color="current" />
          <span className="text-body-2-regular">{t('chat.tool.running')}</span>
        </div>
      ) : (
        <>
          <p data-slot="plan-review-entry-description" className="text-body-2-regular">
            {ui.step === 'draft' ? t('chat.plan.draftInProgress') : t('chat.plan.reviewReady')}
          </p>
          {ui.step === 'error' && (
            <p data-slot="plan-review-entry-error" role="alert" className="text-body-2-regular text-text-destructive">
              {ui.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="small" onPress={onOpen}>
              {t('chat.plan.review')}
            </Button>
            {ui.step !== 'draft' && (
              <>
                <Button size="small" variant="secondary" leadingIcon={Check} onPress={onApprove}>
                  {t('chat.plan.approve')}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  leadingIcon={ArrowUTurnLeft}
                  onPress={() => onUiChange({ step: 'feedback' })}
                >
                  {t('chat.plan.revise')}
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
      <BubbleBlockButton data-slot="plan-review-entry" data-status={status} state="output-available" onClick={onOpen}>
        <List aria-hidden className="size-3.5 shrink-0" />
        <span data-slot="plan-review-entry-title" className="text-caption-1-medium shrink-0">
          {t('chat.plan.title')}
        </span>
        {revision && <span className="text-caption-1-regular">{revision}</span>}
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
        className={cx(BUBBLE_BLOCK, 'flex w-full flex-col gap-2 px-3 py-2.5 ring-1 ring-status-info/40 ring-inset')}
      >
        <div data-slot="plan-review-entry-heading" className="flex min-w-0 items-center gap-2 text-caption-1-medium">
          <List aria-hidden className="size-3.5 shrink-0 text-text-secondary" />
          <span data-slot="plan-review-entry-title" className="shrink-0">
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
    <div
      data-slot="plan-review-entry"
      data-status={status}
      className={cx(
        // Same edge rule as CHAT_TOOL_CARD: a card in the transcript sits on
        // `--surface` and is invisible in the dark theme without a ring.
        'my-3 flex flex-col gap-3 rounded-xl bg-background-primary-default p-4 text-body-regular shadow-card ring-1 ring-inset',
        pending ? 'ring-status-info/40' : 'ring-border-button-default',
      )}
    >
      <div data-slot="plan-review-entry-heading" className="flex min-w-0 items-center gap-2">
        <List aria-hidden className="size-4 shrink-0 text-text-secondary" />
        <span data-slot="plan-review-entry-title" className="shrink-0 text-body-medium text-text-primary">
          {t('chat.plan.title')}
        </span>
        {revision && <span className="text-body-2-regular">{revision}</span>}
        {statusChip}
      </div>
      {excerpt}
      {pending ? (
        actions
      ) : (
        <div className="flex items-center gap-3">
          <p
            data-slot="plan-review-entry-description"
            className="min-w-0 flex-1 text-caption-1-regular text-text-secondary"
          >
            {t('chat.plan.reviewHistory')}
          </p>
          <Button size="small" variant="secondary" onPress={onOpen}>
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
