import { Text, type TextProps } from 'react-aria-components'
import { cn } from '@/lib/utils'

export function Description({ className, ...props }: TextProps) {
  return <Text data-slot="description" slot="description" {...props} className={cn('text-sm text-muted', className)} />
}
