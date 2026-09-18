import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function CardRoot({ className, variant: _variant, ...props }: ComponentProps<'div'> & { variant?: string }) {
  return (
    <div data-slot="card" {...props} className={cx('rounded-xl bg-background-primary-default shadow-xs', className)} />
  )
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" {...props} className={cx('flex flex-col gap-1 px-4 pt-4 pb-2', className)} />
}

function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" {...props} className={cx('text-base font-semibold', className)} />
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" {...props} className={cx('text-sm text-text-secondary', className)} />
}

function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-body" {...props} className={cx('px-4 py-2', className)} />
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" {...props} className={cx('flex items-center gap-2 px-4 pt-2 pb-4', className)} />
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardBody,
  Body: CardBody,
  Footer: CardFooter,
})
