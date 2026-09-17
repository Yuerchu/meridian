import {
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  OverlayArrow,
  type TooltipProps as AriaTooltipProps,
  type TooltipTriggerComponentProps,
} from 'react-aria-components'
import { cn } from '@/lib/utils'
import type { ComponentProps, ReactElement } from 'react'

interface TooltipRootProps extends TooltipTriggerComponentProps {
  delay?: number
  closeDelay?: number
}

interface TooltipContentProps extends Omit<AriaTooltipProps, 'children'> {
  className?: string
  children?: React.ReactNode
}

interface TooltipTriggerProps extends ComponentProps<'span'> {
  render?: (props: ComponentProps<'span'>) => ReactElement
  focusable?: boolean
}

function TooltipRoot({ delay = 700, closeDelay = 0, ...props }: TooltipRootProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...props} />
}

function TooltipContent({ className, children, ...props }: TooltipContentProps) {
  return (
    <AriaTooltip
      data-slot="tooltip"
      {...props}
      className={cn(
        'max-w-xs origin-[var(--trigger-anchor-point)] rounded-xl bg-overlay p-2 text-xs shadow-overlay break-all',
        'data-[entering]:animate-in data-[entering]:duration-150 data-[entering]:fade-in-0 data-[entering]:zoom-in-90',
        'data-[entering]:data-[placement=top]:slide-in-from-bottom-1',
        'data-[entering]:data-[placement=bottom]:slide-in-from-top-1',
        'data-[entering]:data-[placement=left]:slide-in-from-right-1',
        'data-[entering]:data-[placement=right]:slide-in-from-left-1',
        'data-[exiting]:animate-out data-[exiting]:duration-100 data-[exiting]:zoom-out-95 data-[exiting]:fade-out',
        className,
      )}
    >
      <OverlayArrow data-slot="overlay-arrow">
        <svg
          data-slot="overlay-arrow-svg"
          width={8}
          height={8}
          viewBox="0 0 8 8"
          className="stroke-border/40 fill-overlay"
        >
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </OverlayArrow>
      {children}
    </AriaTooltip>
  )
}

function TooltipTrigger({ render, focusable, className, ...props }: TooltipTriggerProps) {
  const domProps = {
    ...props,
    className: cn('inline-block', className),
    ...(focusable === false ? { tabIndex: -1 } : {}),
  }
  if (render) return render(domProps)
  return <span data-slot="tooltip-trigger" {...domProps} />
}

export const Tooltip = Object.assign(TooltipRoot, {
  Content: TooltipContent,
  Trigger: TooltipTrigger,
})
