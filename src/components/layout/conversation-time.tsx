import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DropdownGroup } from '@/components/base'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { cx } from '@/utils/cx'

/**
 * A conversation row's age and its actions button, sharing one slot.
 *
 * The registry's chat history row (`agent-chat-history.tsx`) draws it this way:
 * the age steps aside and the control appears in its place, driven by one
 * condition each way so the two are never visible together — the row hovered,
 * something in the slot keyboard-focused, or the menu open.
 *
 * **Hover is React Aria's `data-hovered` on the row, never `:hover`.** The swap
 * used to be a plain `:hover` rule in `index.css`, and a WebView keeps `:hover`
 * on whatever was last tapped: on Android, choosing a conversation hid its time
 * until something else was touched. `data-hovered` is not set by touch at all
 * (the registry's `group-hover` is only gated by `@media (hover: hover)`, which a
 * touchscreen laptop with a trackpad satisfies while being tapped), and it is
 * the same signal the row's own hover fill reads, so the fill and the swap
 * cannot disagree.
 *
 * `:focus-visible` rather than `:focus-within`, as upstream says: closing the
 * menu with the pointer hands focus back to the trigger, and `focus-within`
 * would keep the button lit over the age that had already returned. The open
 * menu is read off the trigger's own `aria-expanded`.
 *
 * On a touch screen the age therefore stays put. The button is still there,
 * transparent, over it — a tap on the age opens the actions — and the long-press
 * menu carries the full time (`ConversationTimeSection`).
 */
export function ConversationTimeSlot({ updatedAt, children }: { updatedAt: number; children: ReactNode }) {
  const relativeTime = useRelativeTime()
  return (
    <span data-slot="conversation-time-slot" className="group/slot relative flex shrink-0 items-center">
      <span
        data-slot="conversation-time"
        className={cx(
          'transition-opacity',
          'group-data-[hovered]/tree-item:opacity-0',
          'group-has-[:focus-visible]/slot:opacity-0 group-has-[[aria-expanded=true]]/slot:opacity-0',
        )}
      >
        {relativeTime(updatedAt)}
      </span>
      <span
        data-slot="conversation-time-actions"
        className={cx(
          'absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity',
          'group-data-[hovered]/tree-item:opacity-100',
          'group-has-[:focus-visible]/slot:opacity-100 group-has-[[aria-expanded=true]]/slot:opacity-100',
        )}
      >
        {children}
      </span>
    </span>
  )
}

/**
 * The right-click / long-press menu's heading for a conversation: when it last
 * moved, relative and in full.
 *
 * It is the registry's read-only group heading (`DropdownGroup`'s React Aria
 * `Header`), not an item, so it takes no focus and cannot be pressed. It exists
 * because a touch screen never swaps the age away, and so never shows the
 * tooltip that used to carry the full time either — the long-press menu is the
 * one place a finger can ask for it.
 */
export function ConversationTimeSection({ updatedAt, children }: { updatedAt: number; children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const relativeTime = useRelativeTime()
  const exact = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.resolvedLanguage, i18n.language],
  )
  return (
    <DropdownGroup
      label={t('sidebar.updatedAt', { relative: relativeTime(updatedAt), exact: exact.format(updatedAt) })}
    >
      {children}
    </DropdownGroup>
  )
}
