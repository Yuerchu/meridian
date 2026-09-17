import { Label as AriaLabel, type LabelProps } from 'react-aria-components'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: LabelProps) {
  return <AriaLabel data-slot="label" {...props} className={cn('text-sm font-medium text-foreground', className)} />
}
