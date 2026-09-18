import { Separator as AriaSeparator, type SeparatorProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <AriaSeparator
      data-slot="separator"
      orientation={orientation}
      {...props}
      className={cx(
        'shrink-0 bg-separator-border',
        orientation === 'vertical' ? 'h-auto min-h-2 w-px self-stretch' : 'h-px w-full',
        className,
      )}
    />
  )
}
