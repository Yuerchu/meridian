import { Text, type TextProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

export function Description({ className, ...props }: TextProps) {
  return (
    <Text
      data-slot="description"
      slot="description"
      {...props}
      className={cx('text-sm text-text-secondary', className)}
    />
  )
}
