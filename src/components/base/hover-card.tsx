import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface HoverCardProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  openDelay?: number
  closeDelay?: number
  children?: React.ReactNode
}

function HoverCardRoot({ children }: HoverCardProps) {
  return (
    <div data-slot="hover-card" className="relative inline-flex">
      {children}
    </div>
  )
}

function HoverCardTrigger({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="hover-card-trigger" {...props} className={cn('inline-flex', className)} />
}

interface HoverCardContentProps extends ComponentProps<'div'> {
  placement?: string
}

function HoverCardContent({ className, placement: _placement, ...props }: HoverCardContentProps) {
  return (
    <div
      data-slot="hover-card-content"
      {...props}
      className={cn(
        'absolute z-50 rounded-xl border border-border bg-overlay shadow-overlay',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        className,
      )}
    />
  )
}

function HoverCardArrow({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="hover-card-arrow" {...props} className={cn('', className)} />
}

export const HoverCard = Object.assign(HoverCardRoot, {
  Trigger: HoverCardTrigger,
  Content: HoverCardContent,
  Arrow: HoverCardArrow,
})
