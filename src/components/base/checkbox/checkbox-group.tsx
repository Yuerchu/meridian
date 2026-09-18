import type { ReactNode, Ref } from 'react'
import {
  CheckboxGroup as AriaCheckboxGroup,
  type CheckboxGroupProps as AriaCheckboxGroupProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * A column of `Checkbox`es sharing one value and one accessible name. Not in
 * the registry, which has no multi-select form question; here it is the
 * `ask_user` card's checkbox question. React Aria wires `role="group"`,
 * `aria-labelledby`/`aria-describedby` from the surrounding `Label`/`Text`,
 * and `aria-invalid` from `isInvalid`.
 */
export interface CheckboxGroupProps extends Omit<AriaCheckboxGroupProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
  ref?: Ref<HTMLDivElement>
}

export function CheckboxGroup({ className, children, ref, ...props }: CheckboxGroupProps) {
  return (
    <AriaCheckboxGroup ref={ref} {...props} className={cx('flex flex-col gap-1', className)}>
      {children}
    </AriaCheckboxGroup>
  )
}
