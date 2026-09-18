import type { ComponentProps, ReactNode } from 'react'
import { RiAlertFill, RiErrorWarningFill, RiInformationFill } from '@remixicon/react'
import {
  Dialog,
  Heading as AriaHeading,
  Modal as AriaModal,
  ModalOverlay,
  type DialogProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { BACKDROP_MOTION, BACKDROP_VARIANT, OVERLAY_MOTION, OVERLAY_SURFACE } from './overlay-motion'

/**
 * A `Modal` that asks one question: `role="alertdialog"`, one size, a status
 * glyph beside the heading. Same overlay stack as `Modal`, same `slot="close"`
 * contract for the cancel button.
 */

export type AlertDialogStatus = 'danger' | 'warning' | 'accent'

interface AlertDialogBackdropProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  isDismissable?: boolean
  className?: string
  children?: ReactNode
}

function AlertDialogBackdrop({
  isOpen,
  onOpenChange,
  isDismissable = true,
  className,
  children,
}: AlertDialogBackdropProps) {
  return (
    <ModalOverlay
      data-slot="alert-dialog-backdrop"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      className={cx(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        BACKDROP_VARIANT.opaque,
        BACKDROP_MOTION,
        className,
      )}
    >
      {children}
    </ModalOverlay>
  )
}

function AlertDialogContainer({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <AriaModal
      data-slot="alert-dialog"
      className={cx('flex w-full max-w-md flex-col overflow-hidden', OVERLAY_SURFACE, OVERLAY_MOTION, className)}
    >
      {children}
    </AriaModal>
  )
}

interface AlertDialogDialogProps extends Omit<DialogProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

function AlertDialogDialog({ className, children, ...props }: AlertDialogDialogProps) {
  return (
    <Dialog
      data-slot="alert-dialog-dialog"
      role="alertdialog"
      {...props}
      className={cx('flex flex-col outline-none', className)}
    >
      {children}
    </Dialog>
  )
}

function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      {...props}
      className={cx('flex items-center gap-3 px-5 pt-4 pb-2', className)}
    />
  )
}

const statusIcon = {
  danger: { Icon: RiErrorWarningFill, className: 'bg-status-danger-soft text-status-danger-soft-foreground' },
  warning: { Icon: RiAlertFill, className: 'bg-status-warning-soft text-status-warning-soft-foreground' },
  accent: { Icon: RiInformationFill, className: 'bg-button-ghost-background text-button-ghost-foreground' },
} as const

function AlertDialogIcon({ status = 'danger', className }: { status?: AlertDialogStatus; className?: string }) {
  const { Icon, className: tint } = statusIcon[status]
  return (
    <span
      data-slot="alert-dialog-icon"
      data-status={status}
      aria-hidden
      className={cx('flex size-9 shrink-0 items-center justify-center rounded-full', tint, className)}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  )
}

function AlertDialogHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <AriaHeading
      data-slot="alert-dialog-heading"
      slot="title"
      {...props}
      className={cx('text-title-3-semibold text-text-primary', className)}
    />
  )
}

function AlertDialogBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-body"
      {...props}
      className={cx('px-5 py-2 text-body-regular text-text-secondary', className)}
    />
  )
}

function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      {...props}
      className={cx('flex items-center justify-end gap-2 px-5 pt-2 pb-4', className)}
    />
  )
}

export const AlertDialog = Object.assign(AlertDialogBackdrop, {
  Backdrop: AlertDialogBackdrop,
  Container: AlertDialogContainer,
  Dialog: AlertDialogDialog,
  Header: AlertDialogHeader,
  Icon: AlertDialogIcon,
  Heading: AlertDialogHeading,
  Body: AlertDialogBody,
  Footer: AlertDialogFooter,
})
