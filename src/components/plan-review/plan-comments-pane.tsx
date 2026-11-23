import './plan-comments-pane.css'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Bin, Message } from '@keyline-icons/react/two-tone'
import { Link } from '@/components/yuerchu-ui/components/link/link'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'

import type { PlanCommentInfoResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

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
    <section data-slot="plan-comments" aria-labelledby={headingId} className="m-plan-comments-pane">
      <header data-slot="plan-comments-header" className="m-plan-comments-pane__header">
        <Message className="m-plan-comments-pane__icon" />
        <h2 data-slot="plan-comments-title" id={headingId} className="m-plan-comments-pane__title">
          {t('planReview.comments.title')}
        </h2>
        <span className="m-plan-comments-pane__count">
          <Badge size="sm">{visible.length}</Badge>
        </span>
      </header>

      <div data-slot="plan-comments-list" className="m-plan-comments-pane__list">
        {visible.length === 0 && (
          <p data-slot="plan-comments-empty" className="m-plan-comments-pane__empty">
            {t('planReview.comments.empty')}
          </p>
        )}

        {visible.map((comment) => (
          <article
            data-slot="plan-comment"
            key={comment.id}
            className="m-plan-comments-pane__card"
            data-state={comment.state}
            data-comment-id={comment.id}
          >
            <div data-slot="plan-comment-header" className="m-plan-comments-pane__card-header">
              {/* An orphaned comment's quote is what the words *were*; there is
                  nothing left in the plan to take the reader to, and its stored
                  range now covers other text. So it is not offered as a link. */}
              {comment.state === 'orphaned' ? (
                <q
                  data-slot="plan-comment-quote"
                  data-orphaned=""
                  onPointerEnter={titleIfTruncated}
                  className="m-plan-comments-pane__quote m-plan-comments-pane__quote-text"
                >
                  {comment.anchor.quote || t('planReview.comments.emptyQuote')}
                </q>
              ) : (
                <span className="m-plan-comments-pane__quote">
                  <Link variant="standalone" onPress={() => onSelectComment(comment)}>
                    <q data-slot="plan-comment-quote" className="m-plan-comments-pane__quote-text">
                      {comment.anchor.quote || t('planReview.comments.emptyQuote')}
                    </q>
                  </Link>
                </span>
              )}
              {!isReadOnly && (
                <span className="m-plan-comments-pane__delete">
                  <TooltipTrigger>
                    <Button
                      icon={<Bin />}
                      size="sm"
                      variant="ghost"
                      aria-label={t('planReview.comments.delete')}
                      onPress={() => onDeleteComment(comment.id)}
                    />
                    <Tooltip>{t('planReview.comments.delete')}</Tooltip>
                  </TooltipTrigger>
                </span>
              )}
            </div>
            {isReadOnly ? (
              <p data-slot="plan-comment-body" className="m-plan-comments-pane__body">
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
                onChange={(value) => onChangeComment(comment.id, value)}
              />
            )}
            {comment.state === 'orphaned' && (
              <p data-slot="plan-comment-orphaned" className="m-plan-comments-pane__orphaned-note">
                {t('planReview.comments.orphaned')}
              </p>
            )}
          </article>
        ))}
      </div>

      <div data-slot="plan-comments-footer" className="m-plan-comments-pane__footer">
        {isReadOnly ? (
          globalNote && (
            <div data-slot="plan-global-note-readonly">
              <p data-slot="plan-global-note-label" className="m-plan-comments-pane__note-label">
                {t('planReview.comments.globalNote')}
              </p>
              <p data-slot="plan-global-note-body" className="m-plan-comments-pane__body">
                {globalNote}
              </p>
            </div>
          )
        ) : (
          <TextArea
            data-slot="plan-global-note-field"
            label={t('planReview.comments.globalNote')}
            placeholder={t('planReview.comments.globalPlaceholder')}
            value={globalNote}
            rows={2}
            onChange={onGlobalNoteChange}
          />
        )}
      </div>
    </section>
  )
}
