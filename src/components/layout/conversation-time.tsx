import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MenuSection } from '@/components/yuerchu-ui/components/menu/menu'
import { useRelativeTime } from '@/hooks/use-relative-time'

/**
 * A conversation row's relative age label. The hover/focus swap between the
 * timestamp and the row's actions menu is handled by Yuerchu UI's `NavItem`
 * (`trailing` + `actions` on `data-hovered` / `data-focus-within`).
 */
export function ConversationTime({ updatedAt }: { updatedAt: number }) {
  const relativeTime = useRelativeTime()
  return <span data-slot="conversation-time">{relativeTime(updatedAt)}</span>
}

/**
 * The right-click / long-press / overflow menu's heading for a conversation:
 * the full untruncated title (essential when the narrow sidebar row truncated
 * it) followed by when it last moved, relative and in full.
 */
export function ConversationTimeSection({
  title,
  updatedAt,
  children,
}: {
  title?: string
  updatedAt: number
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const relativeTime = useRelativeTime()
  const exact = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.resolvedLanguage, i18n.language],
  )
  const timestamp = t('sidebar.updatedAt', { relative: relativeTime(updatedAt), exact: exact.format(updatedAt) })
  return (
    <MenuSection
      header={
        title ? (
          <span data-slot="conversation-menu-header" className="m-sidebar__menu-header">
            <span data-slot="conversation-menu-title" className="m-sidebar__menu-title">
              {title}
            </span>
            <span className="m-sidebar__menu-time">{timestamp}</span>
          </span>
        ) : (
          timestamp
        )
      }
    >
      {children}
    </MenuSection>
  )
}
