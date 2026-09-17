import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonProps as AriaToggleButtonProps,
  type ToggleButtonGroupProps as AriaToggleButtonGroupProps,
} from 'react-aria-components'
import { cn } from '@/lib/utils'

export function ToggleButton({
  className,
  variant: _v,
  size: _s,
  ...props
}: AriaToggleButtonProps & { className?: string; variant?: string; size?: string }) {
  return (
    <AriaToggleButton
      data-slot="toggle-button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium outline-none select-none',
        'data-[selected]:bg-default data-[selected]:text-foreground',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

export function ToggleButtonGroup({ className, ...props }: AriaToggleButtonGroupProps & { className?: string }) {
  return (
    <AriaToggleButtonGroup
      data-slot="toggle-button-group"
      {...props}
      className={cn('inline-flex items-center gap-1', className)}
    />
  )
}
