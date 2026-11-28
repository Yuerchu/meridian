import './notification-inbox.css'
import { useRef, useState, type ReactNode } from 'react'
import { Dialog } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Bell } from '@keyline-icons/react/two-tone'

import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { NotificationCard } from '@/components/yuerchu-ui/components/notification-stack/notification-stack'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import type { SettingsTab } from '@/components/settings/tabs'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { requestPendingReveal } from '@/lib/pending-reveal'
import { useConversationStore } from '@/stores/conversation-store'
import { useSystemNoticeStore } from '@/stores/system-notice-store'
import type { SystemNoticeInfoResponse } from '@/types'
import { useDismissOnOutsidePress } from '@/utils/use-dismiss-on-outside-press'
import { AttentionSummary } from './approval-notifications'
import {
  ACTION_VARIANT,
  attentionActionIds,
  attentionActionLabel,
  attentionCategory,
  attentionShape,
  useAttentionActions,
  usePendingAttention,
} from './approval-queue'

/**
 * The whole waiting-on-you queue, behind a bell in the header.
 *
 * The floating stack (`approval-notifications.tsx`) shows only the front three
 * of it; this is the complete list, read off the same `pending()` and offering
 * the same buttons — including withholding Allow/Deny from any call that is not
 * a read, or whose row cannot show everything it will do. **A row is the
 * stack's own `NotificationCard`**, with the same `AttentionSummary`, so a
 * question reads the same from either door. Rows are gathered by conversation,
 * each group where its first question stands in the queue. There is no read
 * state: a question is not "seen", it is answered, and an answered one leaves
 * the list.
 *
 * It is built from the library's primitives rather than its `NotificationCenter`,
 * which has a read state, no per-row actions, no custom categories and cannot
 * be opened from outside (Yuerchu/ui#548).
 *
 * **The conversation being read is not listed**, exactly as in the stack: its
 * cards are in the transcript. But a reader who has scrolled up into history
 * cannot see them, so the inbox says how many there are and offers to go to
 * the card — a line above the list rather than rows in it, because rows would
 * be a second place to answer the same question.
 *
 * **Below the questions, what this machine did on its own** — a dictionary
 * upgrade after an update — under a "system" group and tab. Those never reach
 * the floating stack, which carries questions and nothing else, and the tab
 * appears only while there is something in it, so an inbox with no notices is
 * exactly the inbox of questions it always was.
 */
export function NotificationInbox({
  onSelect,
  onOpenSettingsTab,
  transcriptInert,
  boardOpen = false,
  isOpen: openProp,
  onOpenChange,
}: {
  onSelect: (conversationId: string) => Promise<boolean>
  /** Where a failed system notice sends the reader to fix it. */
  onOpenSettingsTab: (tab: SettingsTab) => void
  transcriptInert: boolean
  /** The board is the page: its cards' questions are on it, and this says so. */
  boardOpen?: boolean
  /** Controlled by the shell, which hides the floating stack while this is open. */
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const [ownOpen, setOwnOpen] = useState(false)
  const [tab, setTab] = useState<string>('all')
  const isOpen = openProp ?? ownOpen
  const setIsOpen = (open: boolean) => {
    setOwnOpen(open)
    onOpenChange?.(open)
  }
  const { listed, here } = usePendingAttention(transcriptInert, boardOpen)
  const activeId = useConversationStore((s) => s.activeId)
  const conversations = useConversationStore((s) => s.conversations)
  const act = useAttentionActions(onSelect)
  const relativeTime = useRelativeTime()
  const notices = useSystemNoticeStore((s) => s.notices)
  const dismissNotice = useSystemNoticeStore((s) => s.dismiss)

  // A non-modal popover is not dismissed by a press outside it on its own.
  useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [triggerRef, popoverRef])

  const entries = ((): InboxEntry[] => {
    const questions = listed.map<InboxEntry>((item) => {
      const shape = attentionShape(item)
      const title = conversations.find((c) => c.id === item.conversationId)?.title ?? t('chat.newChat')
      return {
        id: item.approvalId,
        category: attentionCategory(item),
        group: title,
        pending: true,
        card: (
          <NotificationCard
            key={item.approvalId}
            heading={title}
            description={
              <>
                <AttentionSummary item={item} shape={shape} />
                {/* Unknown for a question rebuilt after a reload: the register
                    does not say when it was asked, and "just now" would be a lie. */}
                {item.askedAt !== null && <span className="m-inbox__time">{relativeTime(item.askedAt)}</span>}
              </>
            }
            actions={attentionActionIds(shape).map((id) => (
              <Button
                key={id}
                size="sm"
                variant={ACTION_VARIANT[id]}
                onPress={() => {
                  // Leaving for the card closes the inbox; everything else is
                  // answered in place and the list moves on under the reader.
                  if (id === 'view') setIsOpen(false)
                  act(item, id)
                }}
              >
                {attentionActionLabel(t, item, id)}
              </Button>
            ))}
          />
        ),
      }
    })
    const system = notices.map((notice) =>
      systemEntry(notice, t, relativeTime, {
        settings: (tab) => {
          setIsOpen(false)
          onOpenSettingsTab(tab)
          void dismissNotice(notice.id).catch((err) => console.error('notice not dismissed', err))
        },
        dismiss: () => void dismissNotice(notice.id).catch((err) => console.error('notice not dismissed', err)),
      }),
    )
    return [...questions, ...system]
  })()

  const tabs = [
    { id: 'all', label: t('notifications.inbox.tabAll') },
    { id: 'approvals', label: t('notifications.inbox.tabApprovals') },
    { id: 'questions', label: t('notifications.inbox.tabQuestions') },
    ...(notices.length > 0 ? [{ id: SYSTEM_CATEGORY, label: t('notifications.inbox.tabSystem') }] : []),
  ]
  const countOf = (id: string) => (id === 'all' ? entries.length : entries.filter((e) => e.category === id).length)
  // A tab that disappeared (the last notice was dismissed) must not leave the
  // list filtered by it.
  const activeTab = tabs.some((candidate) => candidate.id === tab) ? tab : 'all'

  const visible = (() => {
    const filtered = activeTab === 'all' ? entries : entries.filter((e) => e.category === activeTab)
    // Several questions from one conversation read as one block; the groups
    // follow the queue's order, and so do their rows.
    const rank = new Map<string, number>()
    for (const entry of filtered) if (!rank.has(entry.group)) rank.set(entry.group, rank.size)
    return [...filtered].sort((a, b) => (rank.get(a.group) ?? 0) - (rank.get(b.group) ?? 0))
  })()
  const groups = (() => {
    const out: { name: string; entries: InboxEntry[] }[] = []
    for (const entry of visible) {
      const last = out[out.length - 1]
      if (last && last.name === entry.group) last.entries.push(entry)
      else out.push({ name: entry.group, entries: [entry] })
    }
    return out
  })()

  const pending = entries.filter((e) => e.pending).length

  return (
    <>
      <span className="m-inbox__bell">
        <Button
          ref={triggerRef}
          icon={<Bell />}
          variant="ghost"
          size="sm"
          className="touch-hitbox"
          aria-label={t('notifications.inbox.bell', { count: listed.length })}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onPress={() => setIsOpen(!isOpen)}
        />
        {listed.length > 0 && (
          <Badge data-slot="notification-inbox-badge" tone="danger" size="sm" className="m-inbox__count" aria-hidden>
            {listed.length > 99 ? '99+' : listed.length}
          </Badge>
        )}
      </span>
      <Popover
        ref={popoverRef}
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        placement="bottom end"
        offset={8}
        isNonModal
        className="m-inbox__popover"
      >
        <Dialog aria-label={t('notifications.inbox.title')} className="m-inbox__dialog">
          {here.length > 0 && boardOpen ? (
            <p data-slot="notification-inbox-on-board" className="m-inbox__note">
              {t('notifications.inbox.onBoard', { count: here.length })}
            </p>
          ) : here.length > 0 && activeId !== null ? (
            <div data-slot="notification-inbox-here" data-action className="m-inbox__note">
              <p className="m-inbox__note-text">{t('notifications.inbox.here', { count: here.length })}</p>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  setIsOpen(false)
                  requestPendingReveal(activeId)
                }}
              >
                {t('notifications.inbox.jumpToCard')}
              </Button>
            </div>
          ) : null}

          <section aria-label={t('notifications.inbox.title')} className="m-inbox">
            <header className="m-inbox__header">
              <h2 className="m-inbox__title">{t('notifications.inbox.title')}</h2>
              <p className="m-inbox__status">
                {pending === 0
                  ? t('notifications.inbox.nonePending')
                  : t('notifications.inbox.pendingCount', { count: pending })}
              </p>
              <SegmentedControl
                aria-label={t('notifications.inbox.category')}
                size="sm"
                selectedKey={activeTab}
                onSelectionChange={(key) => setTab(String(key))}
                className="m-inbox__tabs"
              >
                {tabs.map(({ id, label }) => (
                  <Segment key={id} id={id}>
                    {label}
                    <span className="m-inbox__tab-count">{countOf(id)}</span>
                  </Segment>
                ))}
              </SegmentedControl>
            </header>

            <div className="m-inbox__list">
              {groups.length === 0 ? (
                <EmptyState
                  heading={t('notifications.inbox.empty')}
                  headingLevel={3}
                  size="sm"
                  description={t('notifications.inbox.emptyDescription')}
                />
              ) : (
                groups.map((group) => (
                  <div key={group.name} role="group" aria-label={group.name} className="m-inbox__group">
                    {group.entries.map((entry) => entry.card)}
                  </div>
                ))
              )}
            </div>
          </section>
        </Dialog>
      </Popover>
    </>
  )
}

const SYSTEM_CATEGORY = 'system'

interface InboxEntry {
  id: string
  category: string
  /** Rows with the same group sit together, under that name for a reader. */
  group: string
  /** Counts toward the header's "N waiting". */
  pending: boolean
  card: ReactNode
}

/**
 * One notice as a card. Pending while it is running or failed — those are the
 * two worth counting — and not once it succeeded, when it only reports.
 */
function systemEntry(
  notice: SystemNoticeInfoResponse,
  t: TFunction,
  relativeTime: (ms: number) => string,
  on: { settings: (tab: SettingsTab) => void; dismiss: () => void },
): InboxEntry {
  const { detail } = notice
  const names = detail.dictionaries.join('、')
  const running = detail.state === 'running'
  const failed = detail.state === 'failed'
  return {
    id: `system:${notice.id}`,
    category: SYSTEM_CATEGORY,
    group: t('notifications.system.group'),
    pending: running || failed,
    card: (
      <NotificationCard
        key={`system:${notice.id}`}
        heading={t(`notifications.system.imeUpgrade.${detail.state}.title`)}
        description={
          <>
            {failed ? (
              <span className="m-inbox__lines">
                {[
                  t('notifications.system.imeUpgrade.failed.description', { count: detail.upgraded }),
                  ...detail.failures.map((f) =>
                    t('notifications.system.imeUpgrade.failure', { name: f.name, error: f.error }),
                  ),
                ].join('\n')}
              </span>
            ) : (
              t(`notifications.system.imeUpgrade.${detail.state}.description`, { names })
            )}
            <span className="m-inbox__time">{relativeTime(notice.finished_at ?? notice.started_at)}</span>
          </>
        }
        actions={
          running ? null : (
            <>
              {failed && (
                <Button size="sm" variant="secondary" onPress={() => on.settings('ime')}>
                  {t('notifications.system.openSettings')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onPress={on.dismiss}>
                {t('notifications.system.dismiss')}
              </Button>
            </>
          )
        }
      />
    ),
  }
}
