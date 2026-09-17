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
import { cn } from '@/lib/utils'

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
    <AriaPopover
      data-slot="dropdown-popover"
      className="min-w-[10rem] overflow-hidden rounded-xl border border-border bg-overlay p-1 shadow-overlay outline-none data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-150 data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100"
    >
      <Menu data-slot="dropdown-menu" {...props} className={cn('outline-none', className)} />
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
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none',
        'data-[focused]:bg-default data-[focused]:text-foreground',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

function DropdownSeparator({ className, ...props }: ComponentProps<'div'>) {
  return <AriaSeparator data-slot="dropdown-separator" {...props} className={cn('my-1 h-px bg-separator', className)} />
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
