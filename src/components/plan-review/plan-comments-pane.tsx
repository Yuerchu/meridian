import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Comment, TrashBin } from '@gravity-ui/icons'
import { Button, Chip, Label, Link, TextArea, TextField, Tooltip, TooltipTrigger } from '@/components/base'

import type { PlanCommentInfoResponse } from '@/types'

/** A request to put the cursor in one comment's box. A fresh object per
 *  request, so asking for the same comment twice is two requests. */
export interface PlanCommentFocusRequest {
  commentId: string
}

interface PlanCommentsPaneProps {
  headingId: string
  comments: PlanCommentInfoResponse[]
  globalNote: string
  isReadOnly?: boolean
  focusRequest?: PlanCommentFocusRequest | null
  onChangeComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  onSelectComment: (comment: PlanCommentInfoResponse) => void
  onGlobalNoteChange: (value: string) => void
}

export function PlanCommentsPane({
  headingId,
  comments,
  globalNote,
  isReadOnly = false,
  focusRequest = null,
  onChangeComment,
  onDeleteComment,
  onSelectComment,
  onGlobalNoteChange,
}: PlanCommentsPaneProps) {
  const { t } = useTranslation()
  const visible = comments.filter((comment) => comment.state !== 'deleted')
  const boxes = useRef(new Map<string, HTMLTextAreaElement>())

  useEffect(() => {
    if (!focusRequest) return
    const box = boxes.current.get(focusRequest.commentId)
    if (!box) return
    box.scrollIntoView?.({ block: 'nearest' })
    box.focus()
  }, [focusRequest])

  return (
    <section data-slot="plan-comments" aria-labelledby={headingId} className="flex h-full min-h-0 flex-col">
      <header
        data-slot="plan-comments-header"
        className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-4"
      >
        <Comment className="size-4 text-muted" />
        <h2 data-slot="plan-comments-title" id={headingId} className="text-sm font-medium">
          {t('planReview.comments.title')}
        </h2>
        <Chip size="sm" variant="secondary" className="ms-auto tabular-nums">
          {visible.length}
        </Chip>
      </header>

      <div data-slot="plan-comments-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {visible.length === 0 && (
          <p data-slot="plan-comments-empty" className="px-2 py-8 text-center text-sm text-muted">
            {t('planReview.comments.empty')}
          </p>
        )}

        {visible.map((comment) => (
          <article
            data-slot="plan-comment"
            key={comment.id}
            className="rounded-lg bg-surface-secondary p-3"
            data-state={comment.state}
            data-comment-id={comment.id}
          >
            <div data-slot="plan-comment-header" className="mb-2 flex items-start gap-2">
              <Link
                className="min-w-0 flex-1 text-start text-xs font-normal text-muted"
                onClick={() => onSelectComment(comment)}
              >
                <q data-slot="plan-comment-quote" className="line-clamp-3 break-words">
                  {comment.anchor.quote || t('planReview.comments.emptyQuote')}
                </q>
              </Link>
              {!isReadOnly && (
                <TooltipTrigger>
                  <Button
                    iconOnly
                    size="small"
                    variant="ghost"
                    aria-label={t('planReview.comments.delete')}
                    className="-me-1 -mt-1 shrink-0"
                    onClick={() => onDeleteComment(comment.id)}
                  >
                    <TrashBin />
                  </Button>
                  <Tooltip>{t('planReview.comments.delete')}</Tooltip>
                </TooltipTrigger>
              )}
            </div>
            {isReadOnly ? (
              <p data-slot="plan-comment-body" className="whitespace-pre-wrap text-sm text-foreground">
                {comment.body}
              </p>
            ) : (
              <TextArea
                ref={(node) => {
                  if (node) boxes.current.set(comment.id, node)
                  else boxes.current.delete(comment.id)
                }}
                aria-label={t('planReview.comments.commentLabel')}
                placeholder={t('planReview.comments.placeholder')}
                value={comment.body}
                rows={2}
                fullWidth
                variant="secondary"
                className="resize-none"
                onChange={(event) => onChangeComment(comment.id, event.target.value)}
              />
            )}
            {comment.state === 'orphaned' && (
              <p data-slot="plan-comment-orphaned" className="mt-2 text-xs text-warning">
                {t('planReview.comments.orphaned')}
              </p>
            )}
          </article>
        ))}
      </div>

      <div data-slot="plan-comments-footer" className="shrink-0 border-t border-border p-3">
        {isReadOnly ? (
          globalNote && (
            <div data-slot="plan-global-note-readonly">
              <p data-slot="plan-global-note-label" className="mb-1 text-xs font-medium text-muted">
                {t('planReview.comments.globalNote')}
              </p>
              <p data-slot="plan-global-note-body" className="whitespace-pre-wrap text-sm">
                {globalNote}
              </p>
            </div>
          )
        ) : (
          <TextField data-slot="plan-global-note-field" fullWidth className="space-y-1.5">
            <Label className="text-sm font-medium">{t('planReview.comments.globalNote')}</Label>
            <TextArea
              placeholder={t('planReview.comments.globalPlaceholder')}
              value={globalNote}
              rows={2}
              fullWidth
              variant="secondary"
              className="resize-none"
              onChange={(event) => onGlobalNoteChange(event.target.value)}
            />
          </TextField>
        )}
      </div>
    </section>
  )
}
