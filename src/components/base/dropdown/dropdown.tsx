'use client'

import type { ComponentProps, ReactNode } from 'react'
import {
  Button as AriaButton,
  Header as AriaHeader,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger as AriaMenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
} from 'react-aria-components'
import type {
  MenuItemProps as AriaMenuItemProps,
  MenuProps as AriaMenuProps,
  MenuTriggerProps as AriaMenuTriggerProps,
} from 'react-aria-components'
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEM_INTERACTIVE,
  MENU_POPOVER_SURFACE,
  MENU_POPOVER_WIDTH,
} from '@/components/base/dropdown/menu-styles'
import { cx } from '@/utils/cx'

/**
 * Dropdown — the BoardUI popover-menu recipe as composable primitives, built
 * on React Aria's DialogTrigger/Popover. Unlike Select (which picks a value
 * into a trigger), Dropdown is a free-form menu surface: grouped rows of
 * actions, headers, footers, whatever the panel needs.
 *
 * The same recipe powers the dashboard sidebar's team/account menus and the
 * AI chat template's add/model/folder menus:
 *
 * - Panel: white, 1px border/button/default, radius 16, p 10, shadow/dropdown.
 * - Appear animation: 150ms fade + scale-95 + 2px blur in and out.
 * - Rows: rounded-2lg, background/secondary/hover on hover and on the selected
 *   row, body-medium labels, 4px apart (the panel's flex column carries a
 *   gap-1, the same rhythm as the Select listbox).
 *
 * Meridian (boardui.json patches): the registry's panel is a `DialogTrigger`
 * with native `<button>` rows — a panel of buttons rather than a menu: no
 * arrow keys, no typeahead, no `role="menu"`, and rows a `selectionMode`
 * cannot mark. Here the semantics are React Aria's `MenuTrigger` / `Menu` /
 * `MenuItem` / `MenuSection` / `Separator`; the surface and row treatment are
 * the recipe's, unchanged. RAC's `MenuTrigger` owns dismissal and trigger
 * toggling, so the registry's `isNonModal` + outside-press bridge is not
 * needed. Rows take `onAction` (not `onSelect`) and selection comes from the
 * menu's `selectionMode` / `selectedKeys` (not a per-row `selected`).
 *
 * Composition:
 *
 * ```tsx
 * <Dropdown>
 *   <Button>Open</Button>
 *   <DropdownPopover aria-label="Actions" placement="bottom start">
 *     <DropdownGroup label="Add">
 *       <DropdownItem id="new" onAction={create}>…row content…</DropdownItem>
 *     </DropdownGroup>
 *     <DropdownDivider />
 *     <DropdownItem id="delete" variant="danger" onAction={remove}>Delete</DropdownItem>
 *   </DropdownPopover>
 * </Dropdown>
 * ```
 */

/* ------------------------------------------------------------------- shell */

export interface DropdownProps extends AriaMenuTriggerProps {
  /** Trigger (any React Aria pressable) followed by a DropdownPopover. */
  children: ReactNode
}

export function Dropdown(props: DropdownProps) {
  return <AriaMenuTrigger {...props} />
}

/** The element that opens the menu. Style it entirely via className. */
export function DropdownTrigger({ className, ...props }: ComponentProps<typeof AriaButton>) {
  return (
    <AriaButton
      {...props}
      className={cx(
        'cursor-pointer outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className as string,
      )}
    />
  )
}

/* ------------------------------------------------------------------- panel */

export interface DropdownPopoverProps<T extends object>
  extends
    Omit<AriaMenuProps<T>, 'className' | 'style'>,
    Pick<ComponentProps<typeof AriaPopover>, 'placement' | 'offset' | 'crossOffset'> {
  'aria-label': string
  /** Extra classes on the panel — e.g. a width override (default w-[266px]). */
  className?: string
  /** Classes on the inner menu (the flex column), e.g. gap between groups. */
  dialogClassName?: string
}

export function DropdownPopover<T extends object>({
  'aria-label': ariaLabel,
  placement = 'bottom start',
  offset = 4,
  crossOffset,
  className,
  dialogClassName,
  children,
  ...menuProps
}: DropdownPopoverProps<T>) {
  return (
    <AriaPopover
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, className)}
    >
      {/* gap-1 keeps bare DropdownItems 4px apart, the same rhythm as the
          Select listbox; DropdownDivider's margins are sized to absorb it. */}
      <AriaMenu
        aria-label={ariaLabel}
        {...menuProps}
        className={cx('flex flex-col gap-1 outline-none', dialogClassName)}
      >
        {children}
      </AriaMenu>
    </AriaPopover>
  )
}

/* ----------------------------------------------------------------- content */

export interface DropdownGroupProps {
  /** Muted body-medium heading above the rows. */
  label?: string
  className?: string
  children: ReactNode
}

export function DropdownGroup({ label, className, children }: DropdownGroupProps) {
  return (
    // pt-1 is spacing for the group LABEL — a label-less group must not
    // carry it, or its first row floats 4px lower than the panel padding
    // implies (visible as extra space above the first item's hover pill).
    <AriaMenuSection className={cx('flex w-full flex-col gap-1.5', label && 'pt-1', className)}>
      {label && <AriaHeader className="pl-2 text-body-medium text-text-secondary">{label}</AriaHeader>}
      {children}
    </AriaMenuSection>
  )
}

export interface DropdownItemProps extends Omit<AriaMenuItemProps, 'className' | 'style' | 'children'> {
  /** A destructive action (Meridian: the registry has no danger row). */
  variant?: 'default' | 'danger'
  /** Row padding defaults to p-2 — override for denser rows (px-2 py-1.5). */
  className?: string
  children: ReactNode
}

/**
 * A menu row. Content is free-form — icon + label, avatar + name, label +
 * trailing badge — laid out in a gap-2 flex row.
 */
export function DropdownItem({ variant = 'default', className, children, ...props }: DropdownItemProps) {
  return (
    <AriaMenuItem
      {...props}
      className={({ isSelected, isDisabled }) =>
        cx(
          MENU_ITEM,
          isSelected ? MENU_ITEM_ACTIVE : MENU_ITEM_INTERACTIVE,
          variant === 'danger' && 'text-text-error-primary',
          isDisabled && 'cursor-not-allowed text-text-disabled',
          className,
        )
      }
    >
      {children}
    </AriaMenuItem>
  )
}

/** Full-bleed 1px divider between groups (bleeds through the panel's p-2.5).
 *  my-1.5 + the dialog's gap-1 on both sides = the original 10px breathing room. */
export function DropdownDivider({ className }: { className?: string }) {
  return <AriaSeparator className={cx('-mx-2.5 my-1.5 h-px shrink-0 bg-border-button-default', className)} />
}
