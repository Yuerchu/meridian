import { useTranslation } from 'react-i18next'
import { useConversationStore } from '@/stores/conversation-store'

/**
 * A dot on a conversation the reader is not currently looking at.
 *
 * Shared by the desktop sidebar and the mobile list: the precedence below is a
 * product rule, and two copies of it would drift.
 *
 * The waiting case is read off the top-level queue rather than the session,
 * because the session is the half that cannot see it. A conversation nobody has
 * opened has no session at all — so for the whole set of conversations this dot
 * matters most for, the old read was against an object that did not exist and
 * the dot never lit. The other two states are genuinely per-session: a
 * conversation with no session is not streaming and has nothing unseen.
 */
export function ConversationIndicator({
  conversationId,
  activeId,
  transcriptInert = false,
}: {
  conversationId: string
  activeId: string | null
  transcriptInert?: boolean
}) {
  const { t } = useTranslation()
  const waiting = useConversationStore((s) =>
    Object.values(s.attention).some((a) => a.conversationId === conversationId),
  )
  const session = useConversationStore((s) => s.sessions[conversationId])
  if (conversationId === activeId && !transcriptInert) return null

  if (waiting) {
    return (
      <span className="shrink-0">
        <span aria-hidden className="block size-2 rounded-full bg-warning animate-pulse motion-reduce:animate-none" />
        <span className="sr-only">{t('sidebar.status.waiting')}</span>
      </span>
    )
  }
  if (!session) return null
  if (session.streaming) {
    return (
      <span className="shrink-0">
        <span aria-hidden className="block size-2 rounded-full bg-info animate-pulse motion-reduce:animate-none" />
        <span className="sr-only">{t('sidebar.status.streaming')}</span>
      </span>
    )
  }
  if (session.fulfilledUnseen) {
    return (
      <span className="shrink-0">
        <span aria-hidden className="block size-2 rounded-full bg-success" />
        <span className="sr-only">{t('sidebar.status.unseen')}</span>
      </span>
    )
  }
  return null
}
