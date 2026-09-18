import type { ComponentProps, ReactElement, ReactNode } from 'react'
import {
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as AriaToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  type QueuedToast,
  type ToastProps as AriaToastProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { CloseButton } from './buttons/close-button'

/**
 * Toasts on React Aria's queue. The region is the fixed, safe-area-aware
 * column; each toast is a boardui notification card.
 *
 *   const queue = new ToastQueue<Content>({ maxVisibleToasts: 3 })
 *   <Toast.Provider queue={queue} placement="top">
 *     {({ toast }) => (
 *       <Toast toast={toast} variant="warning">
 *         <Toast.Content>
 *           <Toast.Title>…</Toast.Title>
 *           <Toast.Description>…</Toast.Description>
 *         </Toast.Content>
 *         <Toast.CloseButton aria-label="Dismiss" />
 *       </Toast>
 *     )}
 *   </Toast.Provider>
 *
 * The region is `fixed` and therefore outside the app shell's own safe-area
 * padding, so it pads itself from the `--safe-*` insets; every other frame
 * element is inside the shell. How many are visible is the queue's setting —
 * react-stately reads `maxVisibleToasts` off the queue it was constructed
 * with, and nothing on the region can change that.
 */

export type ToastPlacement = 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end'
export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'danger'

const placementClasses: Record<ToastPlacement, string> = {
  top: 'top-[max(1rem,var(--safe-top,0px))] left-1/2 -translate-x-1/2 items-center',
  'top-start': 'top-[max(1rem,var(--safe-top,0px))] left-[max(1rem,var(--safe-left,0px))] items-start',
  'top-end': 'top-[max(1rem,var(--safe-top,0px))] right-[max(1rem,var(--safe-right,0px))] items-end',
  bottom: 'bottom-[max(1rem,var(--safe-bottom,0px))] left-1/2 -translate-x-1/2 items-center',
  'bottom-start': 'bottom-[max(1rem,var(--safe-bottom,0px))] left-[max(1rem,var(--safe-left,0px))] items-start',
  'bottom-end': 'bottom-[max(1rem,var(--safe-bottom,0px))] right-[max(1rem,var(--safe-right,0px))] items-end',
}

interface ToastProviderProps<T> {
  queue: AriaToastQueue<T>
  placement?: ToastPlacement
  className?: string
  'aria-label'?: string
  children: (renderProps: { toast: QueuedToast<T> }) => ReactElement
}

function ToastProvider<T>({ queue, placement = 'top', className, children, ...props }: ToastProviderProps<T>) {
  return (
    <AriaToastRegion
      data-slot="toast-region"
      data-placement={placement}
      queue={queue}
      {...props}
      className={cx(
        'fixed z-[60] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 outline-none',
        'px-[var(--safe-left,0px)] pr-[var(--safe-right,0px)]',
        placementClasses[placement],
        className,
      )}
    >
      {children}
    </AriaToastRegion>
  )
}

const variantClasses: Record<ToastVariant, string> = {
  default: '',
  info: 'border-l-4 border-l-status-info',
  success: 'border-l-4 border-l-status-success',
  warning: 'border-l-4 border-l-status-warning',
  danger: 'border-l-4 border-l-status-danger',
}

interface ToastRootProps<T> extends Omit<AriaToastProps<T>, 'className' | 'style' | 'children'> {
  variant?: ToastVariant
  className?: string
  children?: ReactNode
}

function ToastRoot<T>({ variant = 'default', className, children, ...props }: ToastRootProps<T>) {
  return (
    <AriaToast
      data-slot="toast"
      data-variant={variant}
      {...props}
      className={cx(
        'relative flex w-full items-start gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-4 shadow-dropdown outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'motion-safe:animate-[meridian-rise-in_200ms_ease-out]',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </AriaToast>
  )
}

function ToastContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaToastContent
      data-slot="toast-content"
      {...props}
      className={cx('flex min-w-0 flex-1 flex-col gap-1', className)}
    />
  )
}

function ToastTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <Text
      slot="title"
      data-slot="toast-title"
      {...props}
      className={cx('text-body-medium text-text-primary', className)}
    />
  )
}

function ToastDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <Text
      slot="description"
      data-slot="toast-description"
      {...props}
      className={cx('text-body-2-regular text-text-secondary', className)}
    />
  )
}

function ToastCloseButton({ className, 'aria-label': ariaLabel }: { className?: string; 'aria-label': string }) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- named by aria-label; a toast is transient
    <CloseButton
      slot="close"
      size="xs"
      data-slot="toast-close"
      aria-label={ariaLabel}
      className={cx('shrink-0', className)}
    />
  )
}

export const Toast = Object.assign(ToastRoot, {
  Provider: ToastProvider,
  Content: ToastContent,
  Title: ToastTitle,
  Description: ToastDescription,
  CloseButton: ToastCloseButton,
})

export { AriaToastQueue as ToastQueue }
