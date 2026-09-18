import {
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  OverlayArrow,
  type TooltipProps as AriaTooltipProps,
  type TooltipTriggerComponentProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import type { ComponentProps, ReactElement } from 'react'

interface TooltipRootProps extends TooltipTriggerComponentProps {
  delay?: number
  closeDelay?: number
}

interface TooltipContentProps extends Omit<AriaTooltipProps, 'children' | 'className'> {
  className?: string
  children?: React.ReactNode
  showArrow?: boolean
}

interface TooltipTriggerProps extends ComponentProps<'span'> {
  render?: (props: ComponentProps<'span'>) => ReactElement
  focusable?: boolean
}

function TooltipRoot({ delay = 700, closeDelay = 0, ...props }: TooltipRootProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...props} />
}

function TooltipContent({ className, children, showArrow = true, offset = 10, ...props }: TooltipContentProps) {
  return (
    <AriaTooltip
      data-slot="tooltip"
      offset={offset}
      {...props}
      className={cx(
        'z-50 max-w-[240px] select-none rounded-lg border border-border-button-default',
        'bg-background-primary-default px-2.5 py-1.5 text-caption-1-medium text-text-primary shadow-dropdown',
        'transition duration-200 ease-out',
        'data-[entering]:scale-90 data-[entering]:opacity-0 data-[entering]:blur-[4px]',
        'data-[exiting]:scale-90 data-[exiting]:opacity-0 data-[exiting]:blur-[4px]',
        className,
      )}
    >
      {showArrow && (
        <OverlayArrow data-slot="overlay-arrow">
          <svg
            data-slot="overlay-arrow-svg"
            width={12}
            height={7}
            viewBox="0 0 12 7"
            className="block overflow-visible fill-background-primary-default stroke-border-button-default"
          >
            <path d="M0 0 L6 6 L12 0" />
          </svg>
        </OverlayArrow>
      )}
      {children}
    </AriaTooltip>
  )
}

function TooltipTrigger({ render, focusable, className, ...props }: TooltipTriggerProps) {
  const domProps = {
    ...props,
    className: cx('inline-block', className),
    ...(focusable === false ? { tabIndex: -1 } : {}),
  }
  if (render) return render(domProps)
  return <span data-slot="tooltip-trigger" {...domProps} />
}

export const Tooltip = Object.assign(TooltipRoot, {
  Content: TooltipContent,
  Trigger: TooltipTrigger,
})
