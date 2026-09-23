'use client'

import type { ComponentType, HTMLAttributes, ReactNode, Ref } from 'react'
import { Fragment, useMemo, useState } from 'react'
import { Bell, CircleAlert, CircleCheck, Info } from '@keyline-icons/react/fill'
import { BellOff } from '@keyline-icons/react/two-tone'
import { Avatar, type AvatarProps } from '@/components/base/avatar/avatar'
import { Button, type ButtonProps } from '@/components/base/buttons/button'
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control'
import { cx, sortCx } from '@/utils/cx'

export type NotificationCenterTab = 'all' | 'mentions' | 'system'
export type NotificationCenterCategory = Exclude<NotificationCenterTab, 'all'> | 'activity'
export type NotificationCenterStatus = 'neutral' | 'information' | 'success' | 'error'
/** A tab id: the three registry ones, or a caller's own from `tabs`. */
export type NotificationCenterTabId = NotificationCenterTab | (string & {})

export type NotificationCenterTabDefinition = { id: NotificationCenterTabId; label: string }

export type NotificationCenterLabels = {
  unreadCount: (count: number) => string
  noUnread: string
  markAllRead: string
  emptyDescription: string
  unread: string
  category: string
}

type IconComponent = ComponentType<{
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}>

export type NotificationCenterAction = {
  id: string
  label: string
  variant?: ButtonProps['variant']
}

export type NotificationCenterItem = {
  id: string
  category: NotificationCenterCategory | (string & {})
  group: string
  title: string
  description: ReactNode
  timestamp: string
  unread?: boolean
  status?: NotificationCenterStatus
  icon?: IconComponent
  avatar?: Pick<AvatarProps, 'src' | 'alt' | 'initials' | 'color'>
  actions?: NotificationCenterAction[]
}

export interface NotificationCenterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  notifications: NotificationCenterItem[]
  defaultTab?: NotificationCenterTabId
  tab?: NotificationCenterTabId
  onTabChange?: (tab: NotificationCenterTabId) => void
  onAction?: (notificationId: string, actionId: string) => void
  title?: string
  emptyMessage?: string
  /** The category tabs. `all` lists everything; any other id lists the items
   *  whose `category` equals it. Defaults to the registry's three. */
  tabs?: NotificationCenterTabDefinition[]
  /** The fixed strings, for a translated UI. Defaults to the registry's English. */
  labels?: Partial<NotificationCenterLabels>
  /** `false` drops the internal read state and "Mark all read": an item is
   *  unread exactly while its `unread` says so. */
  readable?: boolean
  /** `true` gathers the list under a label per `group`, in the order each
   *  group first appears; items keep their order within a group. */
  showGroups?: boolean
  ref?: Ref<HTMLDivElement>
}

const STATUS_ICON: Record<NotificationCenterStatus, IconComponent> = {
  neutral: Bell,
  information: Info,
  success: CircleCheck,
  error: CircleAlert,
}

const styles = sortCx({
  status: {
    neutral: 'bg-background-tertiary-default text-text-secondary',
    information: 'bg-notification-information-background text-notification-information-foreground',
    success: 'bg-notification-success-background text-notification-success-foreground',
    error: 'bg-notification-error-background text-notification-error-foreground',
  },
})

const DEFAULT_LABELS: NotificationCenterLabels = {
  unreadCount: (count) => `${count} unread`,
  noUnread: 'No unread notifications',
  markAllRead: 'Mark all read',
  emptyDescription: 'New activity will appear here when it arrives.',
  unread: 'Unread',
  category: 'Notification category',
}

const TABS: NotificationCenterTabDefinition[] = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'system', label: 'System' },
]

function NotificationVisual({ item }: { item: NotificationCenterItem }) {
  if (item.avatar) {
    return <Avatar {...item.avatar} size="lg" className="size-10" />
  }

  const status = item.status ?? 'neutral'
  const Icon = item.icon ?? STATUS_ICON[status]

  return (
    <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', styles.status[status])}>
      <Icon className="size-5" aria-hidden />
    </span>
  )
}

function TabLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="inline-flex min-w-5 items-center justify-center rounded-sm bg-badge-neutral-background px-1 py-px text-caption-1-medium text-text-secondary">
        {count}
      </span>
    </span>
  )
}

export function NotificationCenter({
  notifications,
  defaultTab = 'all',
  tab,
  onTabChange,
  onAction,
  title = 'Notifications',
  emptyMessage = 'You’re all caught up.',
  tabs = TABS,
  labels: labelOverrides,
  readable = true,
  showGroups = false,
  className,
  ref,
  ...props
}: NotificationCenterProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const [internalTab, setInternalTab] = useState<NotificationCenterTabId>(defaultTab)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const activeTab = tab ?? internalTab

  const setTab = (nextTab: NotificationCenterTabId) => {
    if (tab === undefined) setInternalTab(nextTab)
    onTabChange?.(nextTab)
  }

  const isUnread = (item: NotificationCenterItem) => item.unread === true && (!readable || !readIds.has(item.id))
  const unreadCount = notifications.filter(isUnread).length

  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map(({ id }) => [
          id,
          id === 'all' ? notifications.length : notifications.filter((item) => item.category === id).length,
        ]),
      ),
    [notifications, tabs],
  )

  const visibleNotifications = useMemo(() => {
    const filtered = activeTab === 'all' ? notifications : notifications.filter((item) => item.category === activeTab)
    if (!showGroups) return filtered
    const rank = new Map<string, number>()
    for (const item of filtered) if (!rank.has(item.group)) rank.set(item.group, rank.size)
    return [...filtered].sort((a, b) => (rank.get(a.group) ?? 0) - (rank.get(b.group) ?? 0))
  }, [activeTab, notifications, showGroups])

  const markAllRead = () => {
    setReadIds(new Set(notifications.filter((item) => item.unread).map((item) => item.id)))
  }

  return (
    <section
      ref={ref}
      aria-label={title}
      className={cx(
        'flex w-full max-w-[430px] flex-col overflow-hidden rounded-3xl border border-border-button-default bg-notification-center-background shadow-dropdown',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-3 p-4 pb-1.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-title-3-medium text-text-primary">{title}</h2>
            <p className="text-body-regular text-text-secondary">
              {unreadCount === 0 ? labels.noUnread : labels.unreadCount(unreadCount)}
            </p>
          </div>
          {readable ? (
            <Button variant="ghost" size="small" onPress={markAllRead} isDisabled={unreadCount === 0}>
              {labels.markAllRead}
            </Button>
          ) : null}
        </div>

        <SegmentedControl
          aria-label={labels.category}
          selectedKeys={[activeTab]}
          onSelectionChange={(keys) => {
            const next = [...(keys as Set<string>)][0] as NotificationCenterTabId | undefined
            if (next) setTab(next)
          }}
          className="flex w-full"
        >
          {tabs.map(({ id, label }) => (
            <SegmentedControlItem key={id} id={id} className="flex-1">
              <TabLabel label={label} count={tabCounts[id]} />
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      <div className="bg-notification-center-background p-1.5">
        <div className="overflow-hidden rounded-2xl bg-background-secondary-default">
          <div className="max-h-[516px] overflow-y-auto overscroll-contain bg-background-secondary-default p-2">
            {visibleNotifications.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl bg-background-primary-default px-6 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-background-secondary-default text-foreground-icon-secondary">
                  <BellOff className="size-5" aria-hidden />
                </span>
                <p className="text-body-medium text-text-primary">{emptyMessage}</p>
                <p className="max-w-64 text-body-regular text-text-secondary">{labels.emptyDescription}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleNotifications.map((item, index) => {
                  const unread = isUnread(item)
                  return (
                    <Fragment key={item.id}>
                      {showGroups && item.group !== visibleNotifications[index - 1]?.group ? (
                        <p className="px-2 pb-1 text-body-2-medium text-text-tertiary">{item.group}</p>
                      ) : null}
                      <article className="group/item relative flex gap-3 rounded-notification-card bg-background-primary-default px-3 py-3">
                        <NotificationVisual item={item} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <p className="min-w-0 text-body-medium text-text-primary">{item.title}</p>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-caption-1-medium whitespace-nowrap text-text-tertiary">
                                {item.timestamp}
                              </span>
                              {unread ? (
                                <span className="size-2 rounded-full bg-accent-500" aria-label={labels.unread} />
                              ) : null}
                            </div>
                          </div>
                          <p className="text-body-regular text-text-secondary">{item.description}</p>
                          {item.actions?.length ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {item.actions.map((action) => (
                                <Button
                                  key={action.id}
                                  size="small"
                                  variant={action.variant ?? 'secondary'}
                                  onPress={() => {
                                    if (readable) setReadIds((current) => new Set(current).add(item.id))
                                    onAction?.(item.id, action.id)
                                  }}
                                >
                                  {action.label}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
