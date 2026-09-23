import { useTranslation } from 'react-i18next'
import { Dropdown, DropdownItem, DropdownPopover, Label, Tooltip, TooltipTrigger } from '@/components/base'
import { MoreVertical } from '@keyline-icons/react/two-tone'
import { Sidebar } from '@/components/base'

import type { RowAction } from './row-actions'

/**
 * The dropdown's rows, shared between the button on a conversation row and the
 * one on a project's group header — the two anchored menus that render the
 * same `RowAction[]`.
 */
export function RowActionDropdownItems({ actions }: { actions: RowAction[] }) {
  return (
    <>
      {actions.map((action) => (
        <DropdownItem
          key={action.key}
          id={action.key}
          textValue={action.label}
          variant={action.variant === 'destructive' ? 'danger' : undefined}
          isDisabled={Boolean(action.disabledReason)}
          onAction={() => void action.run()}
        >
          <action.icon className="size-4" />
          <Label>{action.label}</Label>
          {/* Part of the item's own text, not a tooltip: a disabled item takes
              no pointer events, so a tooltip on one is unreachable by mouse and
              by screen reader alike. */}
          {action.disabledReason && (
            <span
              data-slot="row-action-disabled-reason"
              className="ml-auto shrink-0 text-caption-1-regular text-text-secondary"
            >
              {action.disabledReason}
            </span>
          )}
        </DropdownItem>
      ))}
    </>
  )
}

/**
 * The same row actions, reachable by touch.
 *
 * The right-click menu beside it cannot be opened without a right button, which
 * on a phone means the list rows had no actions at all — that was what the
 * mobile list's own overflow button was for. `Sidebar.MenuActions` shows on
 * hover in the panel and *always* inside the mobile sheet, so one button
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
        {/* `.sidebar__menu-action` is 24px square. In the mobile sheet it is always visible and is
            the only way to a row's actions — right-click cannot be reached by
            touch — and a miss lands on the row itself, which switches
            conversation and closes the sheet. */}
        <TooltipTrigger delay={0}>
          <Sidebar.MenuAction className="touch-hitbox" aria-label={t('sidebar.moreActions', { name: label })}>
            <MoreVertical className="size-4" />
          </Sidebar.MenuAction>
          <Tooltip>{t('sidebar.moreActions', { name: label })}</Tooltip>
        </TooltipTrigger>
        <DropdownPopover placement="bottom end" aria-label={t('sidebar.moreActions', { name: label })}>
          <RowActionDropdownItems actions={actions} />
        </DropdownPopover>
      </Dropdown>
    </Sidebar.MenuActions>
  )
}
