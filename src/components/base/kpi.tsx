import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function KPIRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi" {...props} className={cx('flex flex-col gap-1 p-3', className)} />
}

function KPIHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi-header" {...props} className={cx('flex items-center justify-between', className)} />
}

function KPITitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kpi-title" {...props} className={cx('text-xs font-medium text-text-secondary', className)} />
}

function KPIContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi-content" {...props} className={cx('', className)} />
}

function KPIValue({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kpi-value" {...props} className={cx('text-2xl font-semibold tabular-nums', className)} />
}

export const KPI = Object.assign(KPIRoot, {
  Header: KPIHeader,
  Title: KPITitle,
  Content: KPIContent,
  Value: KPIValue,
})
