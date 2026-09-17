import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function CardRoot({ className, variant: _variant, ...props }: ComponentProps<'div'> & { variant?: string }) {
  return <div data-slot="card" {...props} className={cn('rounded-xl bg-surface shadow-surface', className)} />
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" {...props} className={cn('flex flex-col gap-1 px-4 pt-4 pb-2', className)} />
}

function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" {...props} className={cn('text-base font-semibold', className)} />
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" {...props} className={cn('text-sm text-muted', className)} />
}

function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-body" {...props} className={cn('px-4 py-2', className)} />
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" {...props} className={cn('flex items-center gap-2 px-4 pt-2 pb-4', className)} />
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardBody,
  Body: CardBody,
  Footer: CardFooter,
})
