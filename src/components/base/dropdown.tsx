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

interface DropdownProps extends MenuTriggerProps {
  'aria-label'?: string
  'data-slot'?: string
  className?: string
}

export function Dropdown({ 'aria-label': _al, 'data-slot': _ds, className: _cn, ...props }: DropdownProps) {
  return <MenuTrigger data-slot="dropdown" {...props} />
}

export function DropdownTrigger(props: ComponentProps<'div'>) {
  return <>{props.children}</>
}

export function DropdownPopover({
  className,
  'aria-label': ariaLabel,
  placement = 'bottom start',
  ...props
}: MenuProps<object> & { className?: string; placement?: string; 'aria-label'?: string }) {
  return (
    <AriaPopover
      data-slot="dropdown-popover"
      placement={placement as never}
      className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, className)}
    >
      <Menu
        data-slot="dropdown-menu"
        aria-label={ariaLabel}
        {...props}
        className={cx('flex flex-col gap-1 outline-none')}
      />
    </AriaPopover>
  )
}

export function DropdownItem({
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

export function DropdownDivider({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaSeparator
      data-slot="dropdown-separator"
      {...props}
      className={cx('-mx-2.5 my-1.5 h-px shrink-0 bg-border-button-default', className)}
    />
  )
}

export function DropdownGroup({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cx('flex w-full flex-col gap-1.5', label && 'pt-1', className)}>
      {label && <span className="pl-2 text-body-medium text-text-secondary">{label}</span>}
      <div className="flex w-full flex-col gap-1">{children}</div>
    </div>
  )
}
