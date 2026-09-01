import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Comment, TrashBin } from '@gravity-ui/icons'
import { Button, Chip, TextArea, Tooltip } from '@heroui/react'

import type { PlanCommentInfoResponse } from '@/types'

interface PlanCommentsPaneProps {
  headingId: string
  comments: PlanCommentInfoResponse[]
  globalNote: string
  isReadOnly?: boolean
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
  onChangeComment,
  onDeleteComment,
  onSelectComment,
  onGlobalNoteChange,
}: PlanCommentsPaneProps) {
  const { t } = useTranslation()
  const globalNoteId = useId()
  const visible = comments.filter((comment) => comment.state !== 'deleted')

  return (
    <section aria-labelledby={headingId} className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Comment className="size-4 text-muted" />
        <h2 id={headingId} className="text-sm font-medium">
          {t('planReview.comments.title')}
        </h2>
        <Chip size="sm" variant="secondary" className="ms-auto tabular-nums">
          {visible.length}
        </Chip>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {visible.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted">{t('planReview.comments.empty')}</p>
        )}

        {visible.map((comment) => (
          <article key={comment.id} className="rounded-lg bg-surface-secondary p-3" data-state={comment.state}>
            <div className="mb-2 flex items-start gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto min-w-0 flex-1 justify-start whitespace-normal px-0 py-0 text-start text-xs font-normal text-muted"
                onPress={() => onSelectComment(comment)}
              >
                <q className="line-clamp-3 break-words">
                  {comment.anchor.quote || t('planReview.comments.emptyQuote')}
                </q>
              </Button>
              {!isReadOnly && (
                <Tooltip>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={t('planReview.comments.delete')}
                    className="-me-1 -mt-1 shrink-0"
                    onPress={() => onDeleteComment(comment.id)}
                  >
                    <TrashBin />
                  </Button>
                  <Tooltip.Content>{t('planReview.comments.delete')}</Tooltip.Content>
                </Tooltip>
              )}
            </div>
            {isReadOnly ? (
              <p className="whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
            ) : (
              <TextArea
                aria-label={t('planReview.comments.commentLabel')}
                placeholder={t('planReview.comments.placeholder')}
                value={comment.body}
                rows={2}
                variant="secondary"
                onChange={(event) => onChangeComment(comment.id, event.target.value)}
              />
            )}
            {comment.state === 'orphaned' && (
              <p className="mt-2 text-xs text-warning">{t('planReview.comments.orphaned')}</p>
            )}
          </article>
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {isReadOnly ? (
          globalNote && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">{t('planReview.comments.globalNote')}</p>
              <p className="whitespace-pre-wrap text-sm">{globalNote}</p>
            </div>
          )
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={globalNoteId} className="text-sm font-medium">
              {t('planReview.comments.globalNote')}
            </label>
            <TextArea
              id={globalNoteId}
              placeholder={t('planReview.comments.globalPlaceholder')}
              value={globalNote}
              rows={2}
              variant="secondary"
              onChange={(event) => onGlobalNoteChange(event.target.value)}
            />
          </div>
        )}
      </div>
    </section>
  )
}
