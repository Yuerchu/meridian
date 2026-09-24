import type { ComponentProps, ReactNode } from 'react'
import {
  Dialog,
  Heading as AriaHeading,
  Modal as AriaModal,
  ModalOverlay,
  type DialogProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { CloseButton } from './buttons/close-button'
import { MODAL_BACKDROP, MODAL_BACKDROP_MOTION, MODAL_MOTION, MODAL_SURFACE } from './overlay-motion'

/**
 * A centred dialog on React Aria's `ModalOverlay` / `Modal` / `Dialog`.
 *
 *   <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
 *     <Modal.Container size="sm">
 *       <Modal.Dialog aria-label="…">
 *         <Modal.Header><Modal.Heading>…</Modal.Heading></Modal.Header>
 *         <Modal.Body>…</Modal.Body>
 *         <Modal.Footer><Button slot="close">Cancel</Button></Modal.Footer>
 *       </Modal.Dialog>
 *     </Modal.Container>
 *   </Modal.Backdrop>
 *
 * `slot="close"` on any RAC button inside the `Dialog` closes it — the
 * `Dialog` publishes that slot from the overlay's own state, which is why the
 * base `Button` has to be a RAC button and not a native one. Focus is trapped
 * and restored, Escape and outside press dismiss unless `isDismissable` is
 * false, and the page behind is inert.
 */

export type ModalSize = 'sm' | 'md' | 'lg' | 'full' | 'cover'

interface ModalBackdropProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  isDismissable?: boolean
  isKeyboardDismissDisabled?: boolean
  className?: string
  children?: ReactNode
}

function ModalBackdrop({
  isOpen,
  onOpenChange,
  isDismissable = true,
  isKeyboardDismissDisabled,
  className,
  children,
}: ModalBackdropProps) {
  return (
    <ModalOverlay
      data-slot="modal-backdrop"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      className={cx(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        MODAL_BACKDROP,
        MODAL_BACKDROP_MOTION,
        className,
      )}
    >
      {children}
    </ModalOverlay>
  )
}

const containerSize: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  // Edge to edge inside the backdrop's padding.
  full: 'h-full max-w-none',
  // Edge to edge, period: the backdrop's own padding is cancelled.
  cover: '-m-4 h-[100dvh] w-[100vw] max-w-none rounded-none border-0',
}

interface ModalContainerProps {
  size?: ModalSize
  placement?: 'center' | 'top'
  className?: string
  children?: ReactNode
}

function ModalContainer({ size = 'md', placement = 'center', className, children }: ModalContainerProps) {
  return (
    <AriaModal
      data-slot="modal"
      data-size={size}
      className={cx(
        'flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden',
        MODAL_SURFACE,
        MODAL_MOTION,
        containerSize[size],
        placement === 'top' && 'mt-12 self-start',
        className,
      )}
    >
      {children}
    </AriaModal>
  )
}

interface ModalDialogProps extends Omit<DialogProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

function ModalDialog({ className, children, ...props }: ModalDialogProps) {
  return (
    <Dialog
      data-slot="modal-dialog"
      {...props}
      className={cx('relative flex min-h-0 flex-1 flex-col outline-none', className)}
    >
      {children}
    </Dialog>
  )
}

function ModalHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="modal-header" {...props} className={cx('flex shrink-0 flex-col gap-1 px-5 pt-4 pb-2', className)} />
  )
}

function ModalHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <AriaHeading
      data-slot="modal-heading"
      slot="title"
      {...props}
      className={cx('text-title-3-semibold text-text-primary', className)}
    />
  )
}

function ModalBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="modal-body" {...props} className={cx('min-h-0 flex-1 overflow-y-auto px-5 py-3', className)} />
}

function ModalFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="modal-footer"
      {...props}
      className={cx('flex shrink-0 items-center justify-end gap-2 px-5 pt-2 pb-4', className)}
    />
  )
}

function ModalCloseTrigger({
  className,
  'aria-label': ariaLabel,
}: {
  className?: string
  /** Required, as on `CloseButton`: the X has no visible text, and an English
   *  default here is what a Chinese screen reader used to announce. */
  'aria-label': string
}) {
  return (
    <CloseButton
      slot="close"
      size="sm"
      data-slot="modal-close-trigger"
      aria-label={ariaLabel}
      className={cx('absolute top-3 right-3', className)}
    />
  )
}

export const Modal = Object.assign(ModalBackdrop, {
  Backdrop: ModalBackdrop,
  Container: ModalContainer,
  Dialog: ModalDialog,
  Header: ModalHeader,
  Heading: ModalHeading,
  Body: ModalBody,
  Footer: ModalFooter,
  CloseTrigger: ModalCloseTrigger,
})
