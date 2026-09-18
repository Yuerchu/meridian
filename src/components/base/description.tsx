import { Text, type TextProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * Caption under a field. `slot="description"` is what a surrounding `TextField`
 * / `Select` / group reads to wire `aria-describedby` onto the control — the
 * same mechanism as the registry's `HintText`, in the bare form.
 */
export interface DescriptionProps extends Omit<TextProps, 'className'> {
  className?: string
}

export function Description({ className, ...props }: DescriptionProps) {
  return (
    <Text
      data-slot="description"
      slot="description"
      {...props}
      className={cx('pt-px text-caption-1-medium text-text-secondary', className)}
    />
  )
}
