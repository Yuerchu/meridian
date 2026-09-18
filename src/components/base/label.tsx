import { Label as AriaLabel, type LabelProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

export function Label({ className, ...props }: LabelProps) {
  return <AriaLabel data-slot="label" {...props} className={cx('text-sm font-medium text-text-primary', className)} />
}
