import type { ReactNode, Ref } from 'react'
import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonGroupProps as AriaToggleButtonGroupProps,
  type ToggleButtonProps as AriaToggleButtonProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { buttonStyles, type ButtonSize } from './buttons/button'

/**
 * A `Button` that stays pressed. Same sizes as `Button`, drawn from the same
 * style maps. Selection follows the registry's blue pill tab
 * (tabs/pill-tab.tsx, `blue`): unselected is neutral — no fill,
 * `text-text-secondary`, the pill tab's hover wash — and selected is the blue
 * pill `bg-pill-tab-blue-selected-background` with `text-accent-500`.
 */
export interface ToggleButtonProps extends Omit<AriaToggleButtonProps, 'className' | 'children' | 'style'> {
  size?: ButtonSize
  className?: string
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function ToggleButton({ className, size = 'medium', children, ref, ...props }: ToggleButtonProps) {
  return (
    <AriaToggleButton
      ref={ref}
      data-slot="toggle-button"
      {...props}
      className={cx(
        buttonStyles.base,
        buttonStyles.size[size],
        'text-text-secondary data-[hovered]:bg-pill-tab-blue-hover-background',
        'data-[selected]:bg-pill-tab-blue-selected-background data-[selected]:text-accent-500',
        'disabled:text-text-disabled',
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
