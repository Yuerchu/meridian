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
  isOpen: openProp,
  onOpenChange,
}: {
  onSelect: (conversationId: string) => Promise<boolean>
  transcriptInert: boolean
  /** Controlled by the shell, which hides the floating stack while this is open. */
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [ownOpen, setOwnOpen] = useState(false)
  const isOpen = openProp ?? ownOpen
  const setIsOpen = (open: boolean) => {
    setOwnOpen(open)
    onOpenChange?.(open)
  }
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
      // The popover does not follow the viewport by itself: React Aria writes
      // the height left below the bell as an inline max-height on it, and
      // nothing inside read it. So the dialog takes that bound (`inherit`) and
      // the center is the one scroller inside it — with the registry's 516px
      // list cap lifted, since a second, nested scroller is what left the last
      // rows below the fold of a short window. The soft keyboard does not
      // shrink the visual viewport here (`adjustNothing`), so its height is
      // added as bottom padding for the last row to scroll clear of it.
      dialogClassName="flex max-h-[inherit] flex-col"
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
        // Fill the 440px popover instead of the registry's 430px card.
        className:
          'max-w-none min-h-0 max-h-[41rem] overflow-x-hidden overflow-y-auto overscroll-contain pb-[var(--ime-bottom,0px)]',
        // `max-h-[none]`, not `max-h-none`: tailwind-merge does not put the
        // keyword in the max-height group, so `max-h-none` would sit beside the
        // registry's `max-h-[516px]` and lose or win on stylesheet order.
        listClassName: 'max-h-[none] overflow-visible',
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
