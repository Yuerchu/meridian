import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function KPIRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi" {...props} className={cn('flex flex-col gap-1 p-3', className)} />
}

function KPIHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi-header" {...props} className={cn('flex items-center justify-between', className)} />
}

function KPITitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kpi-title" {...props} className={cn('text-xs font-medium text-muted', className)} />
}

function KPIContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kpi-content" {...props} className={cn('', className)} />
}

function KPIValue({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kpi-value" {...props} className={cn('text-2xl font-semibold tabular-nums', className)} />
}

export const KPI = Object.assign(KPIRoot, {
  Header: KPIHeader,
  Title: KPITitle,
  Content: KPIContent,
  Value: KPIValue,
})
