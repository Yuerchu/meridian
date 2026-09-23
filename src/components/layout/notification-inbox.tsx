import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/base'

import { NotificationBell } from '@/components/application/app-shell/notification-bell'
import {
  type NotificationCenterItem,
  type NotificationCenterTabDefinition,
} from '@/components/application/notification-center/notification-center'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { requestPendingReveal } from '@/lib/pending-reveal'
import { useConversationStore } from '@/stores/conversation-store'
import { AttentionSummary } from './approval-notifications'
import {
  ACTION_VARIANT,
  attentionActionIds,
  attentionActionLabel,
  attentionCategory,
  attentionShape,
  isAttentionActionId,
  useAttentionActions,
  usePendingAttention,
} from './approval-queue'

/**
 * The whole waiting-on-you queue, behind a bell in the header — the registry's
 * own `NotificationBell` (from its app-shell starter), fed from the queue.
 *
 * The floating stack (`approval-notifications.tsx`) shows only the front three
 * of it; this is the complete list, read off the same `pending()` and offering
 * the same buttons — including withholding Allow/Deny from any call that is not
 * a read, or whose row cannot show everything it will do. Rows are grouped under
 * their conversation (`showGroups`), in queue order. There is no read state: a question is not
 * "seen", it is answered, and an answered one leaves the list, so the
 * registry's `NotificationCenter` is used with `readable={false}` and every row
 * carries the pending dot.
 *
 * **The conversation being read is not listed**, exactly as in the stack: its
 * cards are in the transcript. But a reader who has scrolled up into history
 * cannot see them, so the inbox says how many there are and offers to go to
 * the card — a line above the list rather than rows in it, because rows would
 * be a second place to answer the same question.
 */
export function NotificationInbox({
  onSelect,
  transcriptInert,
}: {
  onSelect: (conversationId: string) => void
  transcriptInert: boolean
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { listed, here } = usePendingAttention(transcriptInert)
  const activeId = useConversationStore((s) => s.activeId)
  const conversations = useConversationStore((s) => s.conversations)
  const act = useAttentionActions(onSelect)
  const relativeTime = useRelativeTime()

  const byId = useMemo(() => new Map(listed.map((item) => [item.approvalId, item])), [listed])

  const notifications = useMemo<NotificationCenterItem[]>(
    () =>
      listed.map((item) => {
        const shape = attentionShape(item)
        const title = conversations.find((c) => c.id === item.conversationId)?.title ?? t('chat.newChat')
        return {
          id: item.approvalId,
          category: attentionCategory(item),
          group: title,
          title,
          description: <AttentionSummary item={item} shape={shape} />,
          // Unknown for a question rebuilt after a reload: the register does
          // not say when it was asked, and "just now" would be a lie.
          timestamp: item.askedAt === null ? '' : relativeTime(item.askedAt),
          unread: true,
          actions: attentionActionIds(shape).map((id) => ({
            id,
            label: attentionActionLabel(t, item, id),
            variant: ACTION_VARIANT[id],
          })),
        }
      }),
    [listed, conversations, relativeTime, t],
  )

  const tabs = useMemo<NotificationCenterTabDefinition[]>(
    () => [
      { id: 'all', label: t('notifications.inbox.tabAll') },
      { id: 'approvals', label: t('notifications.inbox.tabApprovals') },
      { id: 'questions', label: t('notifications.inbox.tabQuestions') },
    ],
    [t],
  )

  return (
    <NotificationBell
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      notifications={notifications}
      triggerLabel={t('notifications.inbox.bell', { count: listed.length })}
      dialogLabel={t('notifications.inbox.title')}
      before={
        here.length > 0 && activeId !== null ? (
          <div
            data-slot="notification-inbox-here"
            className="mb-2 flex items-center gap-3 rounded-2xl border border-border-button-default bg-background-primary-default py-2 pr-2 pl-4 shadow-dropdown"
          >
            <p className="min-w-0 flex-1 text-body-regular text-text-secondary">
              {t('notifications.inbox.here', { count: here.length })}
            </p>
            <Button
              size="small"
              variant="secondary"
              onPress={() => {
                setIsOpen(false)
                requestPendingReveal(activeId)
              }}
            >
              {t('notifications.inbox.jumpToCard')}
            </Button>
          </div>
        ) : null
      }
      centerProps={{
        tabs,
        readable: false,
        // Several questions from one conversation read as one block under its
        // name; the groups follow the queue's order, and so do their rows.
        showGroups: true,
        title: t('notifications.inbox.title'),
        emptyMessage: t('notifications.inbox.empty'),
        labels: {
          unreadCount: (n) => t('notifications.inbox.pendingCount', { count: n }),
          noUnread: t('notifications.inbox.nonePending'),
          emptyDescription: t('notifications.inbox.emptyDescription'),
          unread: t('notifications.inbox.pending'),
          category: t('notifications.inbox.category'),
        },
        onAction: (id, actionId) => {
          const item = byId.get(id)
          if (!item || !isAttentionActionId(actionId)) return
          // Leaving for the card closes the inbox; everything else is
          // answered in place and the list moves on under the reader.
          if (actionId === 'view') setIsOpen(false)
          act(item, actionId)
        },
      }}
    />
  )
}
