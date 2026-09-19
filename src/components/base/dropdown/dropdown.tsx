import type { ReactNode } from 'react'
import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
  type MenuItemProps,
  type MenuProps,
  type MenuTriggerProps,
  type PopoverProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { OVERLAY_MOTION } from '../overlay-motion'
import { MENU_ITEM, MENU_ITEM_ACTIVE, MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH } from './menu-styles'

/**
 * boardui's dropdown panel recipe (`menu-styles.ts`) on React Aria's
 * `MenuTrigger` / `Menu` / `MenuItem`.
 *
 *   <Dropdown>
 *     <Button>Actions</Button>                 // the first pressable is the trigger
 *     <DropdownPopover aria-label="Actions" placement="bottom end">
 *       <DropdownItem id="rename" onAction={rename}>Rename</DropdownItem>
 *       <DropdownSeparator />
 *       <DropdownItem id="delete" variant="danger" onAction={remove}>Delete</DropdownItem>
 *     </DropdownPopover>
 *   </Dropdown>
 *
 * The registry's dropdown is a `DialogTrigger` with native `<button>` rows,
 * which is a panel of buttons and not a menu: no arrow keys, no typeahead, no
 * `role="menu"`, and rows that a `selectionMode` cannot mark. The app's
 * dropdowns are action menus and selection menus, so the semantics come from
 * RAC's `Menu` and only the surface and row treatment come from the recipe.
 */

export interface DropdownProps extends MenuTriggerProps {
  children: ReactNode
}

export function Dropdown(props: DropdownProps) {
  return <MenuTrigger {...props} />
}

export interface DropdownPopoverProps<T extends object>
  extends Omit<MenuProps<T>, 'className' | 'style'>, Pick<PopoverProps, 'placement' | 'offset' | 'crossOffset'> {
  'aria-label'?: string
  /** Classes on the popover surface — e.g. a width override (default 266px). */
  className?: string
  /** Classes on the menu itself (the flex column). */
  menuClassName?: string
}

export function DropdownPopover<T extends object>({
  placement = 'bottom start',
  offset = 4,
  crossOffset,
  className,
  menuClassName,
  'aria-label': ariaLabel,
  children,
  ...menuProps
}: DropdownPopoverProps<T>) {
  return (
    <AriaPopover
      data-slot="dropdown-popover"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, OVERLAY_MOTION, 'p-2', className)}
    >
      <Menu
        data-slot="dropdown-menu"
        aria-label={ariaLabel}
        {...menuProps}
        className={cx('flex flex-col gap-1 outline-none', menuClassName)}
      >
        {children}
      </Menu>
    </AriaPopover>
  )
}

export interface DropdownItemProps extends Omit<MenuItemProps, 'className' | 'style'> {
  variant?: 'default' | 'danger'
  className?: string
}

export function DropdownItem({ className, variant = 'default', ...props }: DropdownItemProps) {
  return (
    <MenuItem
      data-slot="dropdown-item"
      data-variant={variant}
      {...props}
      className={(state) =>
        cx(
          MENU_ITEM,
          'text-body-medium',
          (state.isFocused || state.isSelected) && MENU_ITEM_ACTIVE,
          state.isDisabled && 'cursor-not-allowed text-text-disabled',
          variant === 'danger' && [
            'text-status-danger-soft-foreground',
            state.isFocused && 'bg-status-danger-soft text-status-danger-soft-foreground',
          ],
          className,
        )
      }
    />
  )
}

export function DropdownSeparator({ className }: { className?: string }) {
  return (
    <AriaSeparator
      data-slot="dropdown-separator"
      className={cx('-mx-2 my-1 h-px shrink-0 bg-border-button-default', className)}
    />
  )
}
