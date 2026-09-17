import { Link as AriaLink, type LinkProps as AriaLinkProps } from 'react-aria-components'
import { cn } from '@/lib/utils'

export function Link({ className, ...props }: AriaLinkProps) {
  return (
    <AriaLink
      data-slot="link"
      {...props}
      className={cn(
        'inline-flex cursor-[var(--cursor-interactive)] items-center text-sm text-accent underline-offset-2 outline-none hover:underline',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}
