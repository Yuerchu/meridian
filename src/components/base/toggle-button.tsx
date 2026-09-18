import type { ReactNode, Ref } from 'react'
import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonGroupProps as AriaToggleButtonGroupProps,
  type ToggleButtonProps as AriaToggleButtonProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { buttonStyles, type ButtonSize, type ButtonVariant } from './buttons/button'

/**
 * A `Button` that stays pressed. Same sizes and variants as `Button`, drawn
 * from the same style maps; the selected state is the variant's pressed fill
 * held.
 */
export interface ToggleButtonProps extends Omit<AriaToggleButtonProps, 'className' | 'children' | 'style'> {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function ToggleButton({
  className,
  variant = 'ghost',
  size = 'medium',
  children,
  ref,
  ...props
}: ToggleButtonProps) {
  return (
    <AriaToggleButton
      ref={ref}
      data-slot="toggle-button"
      {...props}
      className={cx(
        buttonStyles.base,
        buttonStyles.size[size],
        buttonStyles.variant[variant],
        'data-[selected]:bg-background-secondary-default data-[selected]:text-text-primary',
        className,
      )}
    >
      {children}
    </AriaToggleButton>
  )
}

export interface ToggleButtonGroupProps extends Omit<AriaToggleButtonGroupProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

export function ToggleButtonGroup({ className, children, ...props }: ToggleButtonGroupProps) {
  return (
    <AriaToggleButtonGroup
      data-slot="toggle-button-group"
      {...props}
      className={cx('inline-flex items-center gap-1', className)}
    >
      {children}
    </AriaToggleButtonGroup>
  )
}
