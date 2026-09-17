import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface FloatingTocProps extends ComponentProps<'div'> {
  placement?: 'left' | 'right'
}

function FloatingTocRoot({ className, placement: _placement, ...props }: FloatingTocProps) {
  return <div data-slot="floating-toc" {...props} className={cn('relative', className)} />
}

function FloatingTocTrigger({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="floating-toc-trigger" {...props} className={cn('flex flex-col gap-0.5', className)} />
}

function FloatingTocBar({ className, active, ...props }: ComponentProps<'div'> & { active?: boolean }) {
  return (
    <div
      data-slot="floating-toc-bar"
      data-active={active || undefined}
      {...props}
      className={cn('h-3 w-1 rounded-full bg-default transition-colors data-[active]:bg-accent', className)}
    />
  )
}

function FloatingTocContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="floating-toc-content" {...props} className={cn('flex flex-col gap-0.5', className)} />
}

interface FloatingTocItemProps extends ComponentProps<'button'> {
  active?: boolean
  onPress?: () => void
}

function FloatingTocItem({ className, active: _active, onPress, ...props }: FloatingTocItemProps) {
  return (
    <button
      data-slot="floating-toc-item"
      type="button"
      onClick={onPress}
      {...props}
      className={cn(
        'rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-default hover:text-foreground',
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
