import {
  Popover as AriaPopover,
  DialogTrigger,
  Dialog,
  OverlayArrow,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface HoverCardProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  openDelay?: number
  closeDelay?: number
  children?: React.ReactNode
}

function HoverCardRoot({ open, onOpenChange, children }: HoverCardProps) {
  return (
    <DialogTrigger isOpen={open} onOpenChange={onOpenChange}>
      {children}
    </DialogTrigger>
  )
}

function HoverCardTrigger({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="hover-card-trigger" {...props} className={cn('inline-block', className)} />
}

function HoverCardContent({
  className,
  ...props
}: Omit<AriaPopoverProps, 'children'> & { children?: React.ReactNode }) {
  return (
    <AriaPopover
      data-slot="hover-card-content"
      {...props}
      className={cn(
        'rounded-xl border border-border bg-overlay shadow-overlay',
        'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-150',
        'data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100',
        className,
      )}
    >
      <Dialog className="outline-none">{props.children}</Dialog>
    </AriaPopover>
  )
}

function HoverCardArrow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <OverlayArrow data-slot="hover-card-arrow" {...props}>
      <svg
        data-slot="hover-card-arrow-svg"
        width={12}
        height={12}
        viewBox="0 0 12 12"
        className={cn('stroke-border fill-overlay', className)}
      >
        <path d="M0 0 L6 6 L12 0" />
      </svg>
    </OverlayArrow>
  )
}

export const HoverCard = Object.assign(HoverCardRoot, {
  Trigger: HoverCardTrigger,
  Content: HoverCardContent,
  Arrow: HoverCardArrow,
})
