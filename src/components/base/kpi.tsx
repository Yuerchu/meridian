import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

/** boardui's plain stat card (application/dashboard/stat-cards.tsx, `PlainStatCard`). */
function KPIRoot({ className, ...props }: ComponentProps<'div'>) {
  return (
    <section
      data-slot="kpi"
      {...props}
      className={cx('flex min-w-0 flex-col gap-0.5 rounded-2xl bg-background-secondary-default p-4', className)}
    />
  )
}

function KPIHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi-header" {...props} className={cx('flex items-center justify-between', className)} />
}

function KPITitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kpi-title" {...props} className={cx('text-body-medium text-text-secondary', className)} />
}

function KPIContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi-content" {...props} className={cx('', className)} />
}

function KPIValue({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="kpi-value"
      {...props}
      className={cx('text-title-1-medium text-text-primary tabular-nums', className)}
    />
  )
}

export const KPI = Object.assign(KPIRoot, {
  Header: KPIHeader,
  Title: KPITitle,
  Content: KPIContent,
  Value: KPIValue,
})
