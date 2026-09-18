import { Dialog, DialogTrigger, Heading as AriaHeading, Modal, ModalOverlay } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'
import { Button } from './buttons/button'

type SheetPlacement = 'left' | 'right' | 'top' | 'bottom'

interface SheetProps {
  isOpen?: boolean
  placement?: SheetPlacement
  onOpenChange?: (isOpen: boolean) => void
  isDismissable?: boolean
  children?: React.ReactNode
}

const slideIn: Record<SheetPlacement, string> = {
  right: 'data-[entering]:animate-in data-[entering]:slide-in-from-right',
  left: 'data-[entering]:animate-in data-[entering]:slide-in-from-left',
  top: 'data-[entering]:animate-in data-[entering]:slide-in-from-top',
  bottom: 'data-[entering]:animate-in data-[entering]:slide-in-from-bottom',
}

const slideOut: Record<SheetPlacement, string> = {
  right: 'data-[exiting]:animate-out data-[exiting]:slide-out-to-right',
  left: 'data-[exiting]:animate-out data-[exiting]:slide-out-to-left',
  top: 'data-[exiting]:animate-out data-[exiting]:slide-out-to-top',
  bottom: 'data-[exiting]:animate-out data-[exiting]:slide-out-to-bottom',
}

const positionClasses: Record<SheetPlacement, string> = {
  right: 'inset-y-0 right-0 rounded-l-2xl',
  left: 'inset-y-0 left-0 rounded-r-2xl',
  top: 'inset-x-0 top-0 rounded-b-2xl',
  bottom: 'inset-x-0 bottom-0 rounded-t-2xl',
}

function SheetRoot({ isOpen, placement = 'right', onOpenChange, isDismissable = true, children }: SheetProps) {
  return (
    <DialogTrigger>
      <ModalOverlay
        data-slot="sheet-backdrop"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isDismissable={isDismissable}
        className="fixed inset-0 z-50 bg-backdrop/50 backdrop-blur-sm data-[entering]:animate-in data-[entering]:fade-in-0 data-[exiting]:animate-out data-[exiting]:fade-out-0"
      >
        <Modal
          data-slot="sheet-content"
          className={cx(
            'fixed z-50 bg-background-primary-default shadow-dropdown outline-none',
            'flex flex-col',
            'duration-300',
            positionClasses[placement],
            slideIn[placement],
            slideOut[placement],
          )}
        >
          {children}
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}

interface SheetBackdropProps {
  variant?: 'blur' | 'opaque' | 'transparent'
  children?: React.ReactNode
}

function SheetBackdrop({ children }: SheetBackdropProps) {
  return <>{children}</>
}

function SheetContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-content-inner" {...props} className={cx('flex h-full flex-col', className)} />
}

interface SheetDialogProps {
  className?: string
  'aria-label'?: string
  children?: React.ReactNode
}

function SheetDialog({ className, ...props }: SheetDialogProps) {
  return (
    <Dialog
      data-slot="sheet-dialog"
      {...props}
      className={cx('flex h-full min-h-0 flex-col outline-none', className)}
    />
  )
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-header" {...props} className={cx('flex shrink-0 flex-col gap-1 px-5 pt-4 pb-2', className)} />
  )
}

function SheetHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <AriaHeading data-slot="sheet-heading" slot="title" {...props} className={cx('text-lg font-semibold', className)} />
  )
}

function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-body" {...props} className={cx('flex-auto overflow-y-auto px-5 py-2', className)} />
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      {...props}
      className={cx('flex shrink-0 items-center justify-end gap-2 px-5 pt-2 pb-4', className)}
    />
  )
}

function SheetCloseTrigger({ className, 'aria-label': ariaLabel }: { className?: string; 'aria-label'?: string }) {
  return (
    <Button
      slot="close"
      data-slot="sheet-close-trigger"
      variant="ghost"
      iconOnly
      aria-label={ariaLabel ?? 'Close'}
      className={cx('absolute top-3 right-3 text-text-secondary', className)}
    >
      <svg
        data-slot="sheet-close-icon"
        className="size-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </Button>
  )
}

export const Sheet = Object.assign(SheetRoot, {
  Backdrop: SheetBackdrop,
  Content: SheetContent,
  Dialog: SheetDialog,
  Header: SheetHeader,
  Heading: SheetHeading,
  Body: SheetBody,
  Footer: SheetFooter,
  CloseTrigger: SheetCloseTrigger,
})
