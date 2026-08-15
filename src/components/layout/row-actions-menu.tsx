import { useTranslation } from 'react-i18next'
import { Dropdown, Label } from '@heroui/react'
import { EllipsisVertical } from '@gravity-ui/icons'
import { Sidebar } from '@heroui-pro/react/sidebar'

import type { RowAction } from './row-actions'

/**
 * The same row actions, reachable by touch.
 *
 * The right-click menu beside it cannot be opened without a right button, which
 * on a phone means the list rows had no actions at all — that was what the
 * mobile list's own overflow button was for. Pro shows `Sidebar.MenuActions` on
 * hover in the panel and *always* inside the mobile sheet
 * (`.sidebar__mobile .sidebar__menu-actions { display: flex }`), so one button
 * covers both without a breakpoint of ours.
 *
 * A separate component from the context menu rather than a shared one: this is
 * anchored to a button and opened by a click, that one is placed at a cursor.
 * What they share is `RowAction[]`, which is the part worth sharing.
 */
export function RowActionsMenu({
  label,
  actions,
}: {
  /** Names the button for a screen reader — the row's own title. */
  label: string
  /** This row's actions, already built. Nothing here reads "the open row":
      the popover renders on the press that opens it, so a list that only
      arrives with the next state update arrives empty. */
  actions: RowAction[]
}) {
  const { t } = useTranslation()
  return (
    <Sidebar.MenuActions>
      <Dropdown>
        <Sidebar.MenuAction aria-label={t('sidebar.moreActions', { name: label })}>
          <EllipsisVertical />
        </Sidebar.MenuAction>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu aria-label={t('sidebar.moreActions', { name: label })}>
            {actions.map((action) => (
              <Dropdown.Item
                key={action.key}
                id={action.key}
                textValue={action.label}
                variant={action.variant === 'destructive' ? 'danger' : undefined}
                onAction={() => void action.run()}
              >
                <action.icon className="size-4" />
                <Label>{action.label}</Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </Sidebar.MenuActions>
  )
}
