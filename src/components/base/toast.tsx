import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastQueue as AriaToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RAC generic
function ToastRoot(props: any) {
  return <AriaToast data-slot="toast" {...props} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RAC generic
function ToastProvider(props: any) {
  return <AriaToastRegion data-slot="toast-region" {...props} />
}

function ToastContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="toast-content" {...props} className={cx('flex-1', className)} />
}

function ToastTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="toast-title" {...props} className={cx('text-body-medium', className)} />
}

function ToastDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="toast-description"
      {...props}
      className={cx('text-body-2-regular text-text-secondary', className)}
    />
  )
}

export const Toast = Object.assign(ToastRoot, {
  Provider: ToastProvider,
  Content: ToastContent,
  Title: ToastTitle,
  Description: ToastDescription,
})

export { AriaToastQueue as ToastQueue, AriaToastRegion as ToastRegion }
