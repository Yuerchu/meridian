import { Dialog, DialogTrigger, Heading as AriaHeading, Modal as AriaModal, ModalOverlay } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface ModalProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  isDismissable?: boolean
  children?: React.ReactNode
}

function ModalRoot({ isOpen, onOpenChange, isDismissable = true, children }: ModalProps) {
  return (
    <DialogTrigger>
      <ModalOverlay
        data-slot="modal-backdrop"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isDismissable={isDismissable}
        className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop/50 data-[entering]:animate-in data-[entering]:fade-in-0 data-[exiting]:animate-out data-[exiting]:fade-out-0"
      >
        <AriaModal
          data-slot="modal"
          className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-overlay shadow-overlay outline-none data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-200 data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-150"
        >
          {children}
        </AriaModal>
      </ModalOverlay>
    </DialogTrigger>
  )
}

function ModalDialog({
  className,
  ...props
}: {
  className?: string
  'aria-label'?: string
  children?: React.ReactNode
}) {
  return <Dialog data-slot="modal-dialog" {...props} className={cn('flex flex-col outline-none', className)} />
}

function ModalHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="modal-header"
      {...props}
      className={cn('flex items-center justify-between px-5 pt-4 pb-2', className)}
    />
  )
}

function ModalHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <AriaHeading data-slot="modal-heading" slot="title" {...props} className={cn('text-lg font-semibold', className)} />
  )
}

function ModalBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="modal-body" {...props} className={cn('px-5 py-3', className)} />
}

function ModalFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="modal-footer"
      {...props}
      className={cn('flex items-center justify-end gap-2 px-5 pt-2 pb-4', className)}
    />
  )
}

function ModalBackdrop({
  children,
  ...props
}: {
  isOpen?: boolean
  onOpenChange?: (o: boolean) => void
  children?: React.ReactNode
}) {
  return <ModalRoot {...props}>{children}</ModalRoot>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function ModalContainer({ children, ..._props }: any) {
  return <>{children}</>
}

function ModalCloseTrigger({ className, 'aria-label': ariaLabel }: { className?: string; 'aria-label'?: string }) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- modal close
    <Button
      slot="close"
      data-slot="modal-close-trigger"
      variant="ghost"
      isIconOnly
      aria-label={ariaLabel ?? 'Close'}
      className={cn('absolute top-3 right-3 text-muted', className)}
    >
      <svg
        data-slot="modal-close-icon"
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

export const Modal = Object.assign(ModalRoot, {
  Backdrop: ModalBackdrop,
  Container: ModalContainer,
  Dialog: ModalDialog,
  Header: ModalHeader,
  Heading: ModalHeading,
  Body: ModalBody,
  Footer: ModalFooter,
  CloseTrigger: ModalCloseTrigger,
})
