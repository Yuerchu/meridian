import { Separator as AriaSeparator, type SeparatorProps } from 'react-aria-components'
import { cn } from '@/lib/utils'

export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <AriaSeparator
      data-slot="separator"
      orientation={orientation}
      {...props}
      className={cn(
        'shrink-0 rounded-sm bg-separator',
        orientation === 'vertical' ? 'h-auto min-h-2 w-px self-stretch' : 'h-px w-full',
        className,
      )}
    />
  )
}
