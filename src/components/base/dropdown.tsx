import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
  type MenuProps,
  type MenuItemProps,
  type MenuTriggerProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'
import { MENU_ITEM, MENU_ITEM_INTERACTIVE, MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH } from './dropdown/menu-styles'

interface DropdownRootProps extends MenuTriggerProps {
  'aria-label'?: string
  'data-slot'?: string
  className?: string
}

function DropdownRoot({ 'aria-label': _al, 'data-slot': _ds, className: _cn, ...props }: DropdownRootProps) {
  return <MenuTrigger data-slot="dropdown" {...props} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic menu
function DropdownMenu({ className, ...props }: MenuProps<any> & { className?: string }) {
  return (
    <AriaPopover data-slot="dropdown-popover" className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE)}>
      <Menu data-slot="dropdown-menu" {...props} className={cx('flex flex-col gap-1 outline-none', className)} />
    </AriaPopover>
  )
}

function DropdownItem({
  className,
  variant: _variant,
  ...props
}: MenuItemProps & { className?: string; variant?: string }) {
  return (
    <MenuItem
      data-slot="dropdown-item"
      {...props}
      className={cx(
        MENU_ITEM,
        MENU_ITEM_INTERACTIVE,
        'data-[focused]:bg-dropdown-item-hover-background',
        'data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled',
        className,
      )}
    />
  )
}

function DropdownSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaSeparator
      data-slot="dropdown-separator"
      {...props}
      className={cx('-mx-2.5 my-1.5 h-px shrink-0 bg-border-button-default', className)}
    />
  )
}

function DropdownTrigger(props: ComponentProps<'div'>) {
  return <>{props.children}</>
}

function DropdownPopover({ children }: ComponentProps<'div'> & { placement?: string }) {
  return <>{children}</>
}

export const Dropdown = Object.assign(DropdownRoot, {
  Trigger: DropdownTrigger,
  Popover: DropdownPopover,
  Menu: DropdownMenu,
  Item: DropdownItem,
  Separator: DropdownSeparator,
})
