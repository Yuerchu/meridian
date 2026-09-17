import { Dialog, DialogTrigger, Heading as AriaHeading, Modal as AriaModal, ModalOverlay } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface AlertDialogProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function AlertDialogRoot({ isOpen, onOpenChange, children }: AlertDialogProps) {
  return (
    <DialogTrigger>
      <ModalOverlay
        data-slot="alert-dialog-backdrop"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop/50 data-[entering]:animate-in data-[entering]:fade-in-0 data-[exiting]:animate-out data-[exiting]:fade-out-0"
      >
        <AriaModal
          data-slot="alert-dialog"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-overlay shadow-overlay outline-none data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-200"
        >
          {children}
        </AriaModal>
      </ModalOverlay>
    </DialogTrigger>
  )
}

function AlertDialogDialog({
  className,
  ...props
}: {
  className?: string
  role?: 'alertdialog' | 'dialog'
  children?: React.ReactNode
}) {
  return (
    <Dialog
      data-slot="alert-dialog-dialog"
      role="alertdialog"
      {...props}
      className={cn('flex flex-col outline-none', className)}
    />
  )
}

function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" {...props} className={cn('px-5 pt-4 pb-2', className)} />
}

function AlertDialogHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <AriaHeading
      data-slot="alert-dialog-heading"
      slot="title"
      {...props}
      className={cn('text-lg font-semibold', className)}
    />
  )
}

function AlertDialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-body" {...props} className={cn('px-5 py-2 text-sm text-muted', className)} />
}

function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      {...props}
      className={cn('flex items-center justify-end gap-2 px-5 pt-2 pb-4', className)}
    />
  )
}

function AlertDialogBackdrop({
  children,
  ...props
}: {
  isOpen?: boolean
  onOpenChange?: (o: boolean) => void
  children?: React.ReactNode
}) {
  return <AlertDialogRoot {...props}>{children}</AlertDialogRoot>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function AlertDialogContainer({ children }: any) {
  return <>{children}</>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function AlertDialogIcon({ className, ...props }: any) {
  return <span data-slot="alert-dialog-icon" {...props} className={cn('flex shrink-0', className)} />
}

export const AlertDialog = Object.assign(AlertDialogRoot, {
  Backdrop: AlertDialogBackdrop,
  Container: AlertDialogContainer,
  Dialog: AlertDialogDialog,
  Header: AlertDialogHeader,
  Icon: AlertDialogIcon,
  Heading: AlertDialogHeading,
  Body: AlertDialogBody,
  Footer: AlertDialogFooter,
})
