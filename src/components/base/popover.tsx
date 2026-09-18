import {
  Popover as AriaPopover,
  DialogTrigger,
  Dialog,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components'
import type { ComponentProps, ReactElement } from 'react'
import { cx } from '@/utils/cx'

interface PopoverRootProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function PopoverRoot({ isOpen, onOpenChange, children }: PopoverRootProps) {
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {children}
    </DialogTrigger>
  )
}

interface PopoverTriggerProps extends ComponentProps<'span'> {
  render?: (props: ComponentProps<'span'>) => ReactElement
}

function PopoverTrigger({ render, className, ...props }: PopoverTriggerProps) {
  const domProps = { ...props, className: cx('inline-flex', className) }
  if (render) return render(domProps)
  return <span data-slot="popover-trigger" {...domProps} />
}

function PopoverContent({ className, ...props }: AriaPopoverProps & { className?: string }) {
  return (
    <AriaPopover
      data-slot="popover"
      {...props}
      className={cx(
        'overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default p-1 shadow-dropdown outline-none',
        'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-150',
        'data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100',
        className,
      )}
    />
  )
}

function PopoverDialog({
  className,
  ...props
}: {
  className?: string
  'aria-label'?: string
  children?: React.ReactNode
}) {
  return <Dialog data-slot="popover-dialog" {...props} className={cx('outline-none', className)} />
}

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Dialog: PopoverDialog,
})
