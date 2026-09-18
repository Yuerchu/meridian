import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonProps as AriaToggleButtonProps,
  type ToggleButtonGroupProps as AriaToggleButtonGroupProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'

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
      className={cx(
        'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium outline-none select-none',
        'data-[selected]:bg-background-secondary-default data-[selected]:text-text-primary',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

export function ToggleButtonGroup({
  className,
  isDetached: _isDetached,
  size: _size,
  ...props
}: AriaToggleButtonGroupProps & { className?: string; isDetached?: boolean; size?: string }) {
  return (
    <AriaToggleButtonGroup
      data-slot="toggle-button-group"
      {...props}
      className={cx('inline-flex items-center gap-1', className)}
    />
  )
}
