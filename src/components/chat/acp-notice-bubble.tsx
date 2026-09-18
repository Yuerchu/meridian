import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/base'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { cn } from '@/lib/utils'
import { AcpNoticeActionsContext } from './acp-notice-actions'
import type { AcpSessionNoticeInfoResponse } from '@/types'

/**
 * One incident a hosted Claude Code session reported, drawn where it happened.
 *
 * Severity decides the fill — an error is destructive, a warning is muted with
 * warning ink — and the category is a label, never a colour of its own: the
 * text is the message and the group is only how the adapter filed it.
 */
export function AcpNoticeBubble({
  notice,
  retryText,
}: {
  notice: AcpSessionNoticeInfoResponse
  /** The question to re-send for `retry`; null when there is nothing to. */
  retryText: string | null
}) {
  const { t } = useTranslation()
  const actions = useContext(AcpNoticeActionsContext)
  const isError = notice.severity === 'error'
  const canRetry = notice.actions.includes('retry') && actions !== null && !actions.busy && retryText !== null
  const canRestart = notice.actions.includes('new_session') && actions !== null && !actions.busy
  const wantsLogin = notice.actions.includes('login')

  return (
    <Bubble
      data-slot="acp-notice"
      data-severity={notice.severity}
      data-category={notice.category}
      variant={isError ? 'destructive' : 'muted'}
      className="max-w-[85%]"
    >
      <BubbleContent className={cn('space-y-2', !isError && 'text-warning-soft-foreground')}>
        <div data-slot="acp-notice-head" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span data-slot="acp-notice-category" className="text-xs opacity-80">
            {t(`chat.acpNotice.category.${notice.category}`)}
          </span>
          <span data-slot="acp-notice-title" className="font-medium">
            {notice.title}
          </span>
        </div>
        {notice.details !== null && (
          <p data-slot="acp-notice-details" className="text-xs whitespace-pre-wrap opacity-90">
            {notice.details}
          </p>
        )}
        {(canRetry || canRestart || wantsLogin) && (
          <div data-slot="acp-notice-actions" className="flex flex-wrap items-center gap-2 pt-1">
            {canRetry && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  if (retryText !== null) actions?.retry(retryText)
                }}
              >
                {t('chat.acpNotice.action.retry')}
              </Button>
            )}
            {canRestart && (
              <Button size="small" variant="outline" className="rounded-lg" onClick={() => actions?.restartAgent()}>
                {t('chat.acpNotice.action.newSession')}
              </Button>
            )}
            {wantsLogin && (
              <span data-slot="acp-notice-login-hint" className="text-xs opacity-80">
                {t('chat.acpNotice.loginHint')}
              </span>
            )}
          </div>
        )}
      </BubbleContent>
    </Bubble>
  )
}

/** The notices filed against one turn, in the order they were first seen. */
export function AcpNoticeList({
  notices,
  retryText,
}: {
  notices: readonly AcpSessionNoticeInfoResponse[]
  retryText: string | null
}) {
  if (notices.length === 0) return null
  return (
    <div data-slot="acp-notices" className="flex flex-col gap-2 pl-10">
      {notices.map((notice) => (
        <AcpNoticeBubble key={notice.id} notice={notice} retryText={retryText} />
      ))}
    </div>
  )
}
