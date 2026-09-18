import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface FloatingTocProps extends ComponentProps<'div'> {
  placement?: 'left' | 'right'
}

function FloatingTocRoot({ className, placement: _placement, ...props }: FloatingTocProps) {
  return <div data-slot="floating-toc" {...props} className={cx('relative', className)} />
}

function FloatingTocTrigger({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="floating-toc-trigger" {...props} className={cx('flex flex-col gap-0.5', className)} />
}

function FloatingTocBar({ className, active, ...props }: ComponentProps<'div'> & { active?: boolean }) {
  return (
    <div
      data-slot="floating-toc-bar"
      data-active={active || undefined}
      {...props}
      className={cx(
        'h-3 w-1 rounded-full bg-background-tertiary-default transition-colors data-[active]:bg-accent-500',
        className,
      )}
    />
  )
}

function FloatingTocContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="floating-toc-content" {...props} className={cx('flex flex-col gap-0.5', className)} />
}

interface FloatingTocItemProps extends ComponentProps<'button'> {
  active?: boolean
  onClick?: () => void
}

function FloatingTocItem({ className, active: _active, onClick, ...props }: FloatingTocItemProps) {
  return (
    <button
      data-slot="floating-toc-item"
      type="button"
      onClick={onClick}
      {...props}
      className={cx(
        'rounded-md px-2 py-1 text-left text-xs text-text-secondary hover:bg-background-secondary-default hover:text-text-primary',
        className,
      )}
    />
  )
}

export const FloatingToc = Object.assign(FloatingTocRoot, {
  Trigger: FloatingTocTrigger,
  Bar: FloatingTocBar,
  Content: FloatingTocContent,
  Item: FloatingTocItem,
})
