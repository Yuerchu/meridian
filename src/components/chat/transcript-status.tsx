import { useTranslation } from 'react-i18next'
import { AgentThinking } from '@/components/application/agent-thinking/agent-thinking'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { AcpNoticeBubble } from './acp-notice-bubble'
import type { AcpSessionNoticeInfoResponse } from '@/types'

/**
 * The rows that sit under the last turn: a compaction in progress, the error
 * the turn that just failed left behind, and a hosted session's incidents
 * that belong to no turn on this path.
 */
export function TranscriptStatus({
  compacting,
  error,
  redactionNotice,
  notices = [],
  retryText = null,
}: {
  compacting: boolean
  error: string | null
  redactionNotice: { redactedCount: number; rules: string[] } | null
  /** Session-scoped incidents, and ones whose turn is not on this path. */
  notices?: readonly AcpSessionNoticeInfoResponse[]
  /** The last question on the path, for a notice that offers a retry. */
  retryText?: string | null
}) {
  const { t } = useTranslation()

  return (
    <>
      {notices.map((notice) => (
        <MessageScrollerItem key={notice.id} messageId={`__acp_notice:${notice.id}`}>
          <div data-slot="acp-notice-row" className="pl-10">
            <AcpNoticeBubble notice={notice} retryText={retryText} />
          </div>
        </MessageScrollerItem>
      ))}
      {redactionNotice && (
        <MessageScrollerItem messageId="__redaction_notice">
          <Bubble variant="muted">
            <BubbleContent className="text-caption-1-regular text-text-secondary">
              {t('chat.redaction.notice', { count: redactionNotice.redactedCount })}
            </BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      )}
      {compacting && (
        <MessageScrollerItem messageId="__compacting">
          {/* boardui's agent-thinking is the whole row, and the status: its
              own `role="status"` announces it, so nothing around it is one. */}
          <div data-slot="compacting-status" className="flex justify-center py-3">
            <AgentThinking variant="spin" label={t('chat.compact.inProgress')} />
          </div>
        </MessageScrollerItem>
      )}
      {/* After the turns, not before them: the error belongs to the turn that
          just failed, and the user is already at the bottom when it arrives.
          Deliberately not a scrollAnchor — an anchor aligns its item to the
          top of the viewport, which is what put the error out of sight in the
          first place. */}
      {error && (
        <MessageScrollerItem messageId="__error">
          <Bubble variant="destructive">
            <BubbleContent className="break-all">{error}</BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      )}
    </>
  )
}
