import './acp-notice-bubble.css'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
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
      className="m-acp-notice"
    >
      <BubbleContent data-severity={notice.severity} className="m-acp-notice__content">
        <div data-slot="acp-notice-head" className="m-acp-notice__head">
          <span data-slot="acp-notice-category" className="m-acp-notice__category">
            {t(`chat.acpNotice.category.${notice.category}`)}
          </span>
          <span data-slot="acp-notice-title" className="m-acp-notice__title">
            {notice.title}
          </span>
        </div>
        {notice.details !== null && (
          <p data-slot="acp-notice-details" className="m-acp-notice__details">
            {notice.details}
          </p>
        )}
        {(canRetry || canRestart || wantsLogin) && (
          <div data-slot="acp-notice-actions" className="m-acp-notice__actions">
            {canRetry && (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  if (retryText !== null) actions?.retry(retryText)
                }}
              >
                {t('chat.acpNotice.action.retry')}
              </Button>
            )}
            {canRestart && (
              <Button size="sm" variant="secondary" onPress={() => actions?.restartAgent()}>
                {t('chat.acpNotice.action.newSession')}
              </Button>
            )}
            {wantsLogin && (
              <span data-slot="acp-notice-login-hint" className="m-acp-notice__login-hint">
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
    <div data-slot="acp-notices" className="m-acp-notice-list">
      {notices.map((notice) => (
        <AcpNoticeBubble key={notice.id} notice={notice} retryText={retryText} />
      ))}
    </div>
  )
}
