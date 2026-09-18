import { Link as AriaLink, type LinkProps as AriaLinkProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

export function Link({ className, ...props }: Omit<AriaLinkProps, 'className'> & { className?: string }) {
  return (
    <AriaLink
      data-slot="link"
      {...props}
      className={cx(
        'inline-flex cursor-[var(--cursor-interactive)] items-center text-sm text-accent-600 underline-offset-2 outline-none hover:underline',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}
