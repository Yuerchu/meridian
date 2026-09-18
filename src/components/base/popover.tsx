import type { ReactNode, Ref } from 'react'
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Popover as AriaPopover,
  type ButtonProps as AriaButtonProps,
  type DialogProps,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { OVERLAY_MOTION, OVERLAY_SURFACE } from './overlay-motion'

/**
 * A floating panel anchored to the thing that opened it.
 *
 *   <Popover>
 *     <Button>Open</Button>           // any RAC pressable is the trigger
 *     <Popover.Content placement="top">
 *       <Popover.Dialog aria-label="…">…</Popover.Dialog>
 *     </Popover.Content>
 *   </Popover>
 *
 * The root is React Aria's `DialogTrigger`, which finds its trigger through
 * context: the first pressable inside it — a base `Button`, even one wrapped
 * in a `TooltipTrigger` — opens the panel and is what the panel is anchored
 * to. `Popover.Trigger` exists for content that is not already a button (a
 * gauge, a figure): it is an unstyled RAC button, so it is focusable, has
 * `aria-expanded`, and takes the ring on focus. Do not put a `Button` inside
 * it; nested buttons are invalid HTML and would toggle the panel twice.
 */

interface PopoverRootProps {
  isOpen?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

function PopoverRoot({ isOpen, defaultOpen, onOpenChange, children }: PopoverRootProps) {
  return (
    <DialogTrigger isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </DialogTrigger>
  )
}

interface PopoverTriggerProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  className?: string
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

function PopoverTrigger({ className, children, ref, ...props }: PopoverTriggerProps) {
  return (
    <AriaButton
      ref={ref}
      data-slot="popover-trigger"
      {...props}
      className={cx(
        'inline-flex cursor-[var(--cursor-interactive)] items-center outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      {children}
    </AriaButton>
  )
}

interface PopoverContentProps extends Omit<AriaPopoverProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

function PopoverContent({ className, children, offset = 8, ...props }: PopoverContentProps) {
  return (
    <AriaPopover
      data-slot="popover"
      offset={offset}
      {...props}
      className={cx('max-w-[calc(100vw-32px)] p-2.5', OVERLAY_SURFACE, OVERLAY_MOTION, className)}
    >
      {children}
    </AriaPopover>
  )
}

interface PopoverDialogProps extends Omit<DialogProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

function PopoverDialog({ className, children, ...props }: PopoverDialogProps) {
  return (
    <Dialog data-slot="popover-dialog" {...props} className={cx('outline-none', className)}>
      {children}
    </Dialog>
  )
}

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Dialog: PopoverDialog,
})
