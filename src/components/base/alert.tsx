import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/utils/cx'

type AlertStatus = 'default' | 'success' | 'warning' | 'danger' | 'info'

interface AlertProps extends ComponentProps<'div'> {
  status?: AlertStatus
  variant?: string
  icon?: ReactNode
}

const statusClasses: Record<AlertStatus, string> = {
  default: 'bg-background-secondary-default text-text-primary',
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
  info: 'bg-[var(--info)]/10 text-[var(--info-soft-foreground)]',
}

function AlertRoot({ className, status = 'default', variant: _variant, icon, children, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      {...props}
      className={cx('flex items-start gap-2 rounded-xl p-3 text-body-medium', statusClasses[status], className)}
    >
      {icon && (
        <span data-slot="alert-icon" className="mt-0.5 flex shrink-0">
          {icon}
        </span>
      )}
      <div data-slot="alert-content-wrapper" className="flex-1">
        {children}
      </div>
    </div>
  )
}

function AlertIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="alert-indicator" {...props} className={cx('mt-0.5 flex shrink-0', className)} />
}

function AlertContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-content" {...props} className={cx('flex-1', className)} />
}

function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-title" {...props} className={cx('text-body-medium', className)} />
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="alert-description" {...props} className={cx('mt-0.5 text-body-2-regular opacity-90', className)} />
  )
}

export const Alert = Object.assign(AlertRoot, {
  Indicator: AlertIndicator,
  Content: AlertContent,
  Title: AlertTitle,
  Description: AlertDescription,
})
