import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import type { ForwardedRef } from 'react'
import { cx } from '@/utils/cx'

export type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'danger-soft' | 'transparent'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends AriaButtonProps {
  ref?: ForwardedRef<HTMLButtonElement>
  variant?: ButtonVariant
  size?: ButtonSize
  isIconOnly?: boolean
  className?: string
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-button-primary text-text-white shadow-xs disabled:text-button-primary-disabled-foreground disabled:shadow-none',
  secondary: [
    'bg-background-primary-default text-text-primary',
    'border border-border-button-default shadow-xs',
    'hover:bg-background-primary-hover hover:border-border-button-hover',
    'data-[pressed]:bg-background-primary-active data-[pressed]:border-border-button-active',
    'disabled:bg-background-primary-disabled disabled:border-border-button-default disabled:text-text-tertiary disabled:shadow-none',
  ].join(' '),
  tertiary: [
    'bg-background-secondary-default text-text-primary',
    'hover:bg-background-secondary-hover',
    'data-[pressed]:bg-background-secondary-hover',
  ].join(' '),
  outline: [
    'bg-transparent text-text-primary',
    'border border-border-button-default',
    'hover:bg-background-primary-hover hover:border-border-button-hover',
    'data-[pressed]:bg-background-primary-active',
  ].join(' '),
  ghost: [
    'bg-transparent text-text-primary',
    'hover:bg-background-secondary-default',
    'data-[pressed]:bg-background-secondary-hover',
    'disabled:text-text-tertiary',
  ].join(' '),
  danger: 'bg-button-danger text-text-white shadow-xs disabled:text-foreground-disabled-danger disabled:shadow-none',
  'danger-soft': ['bg-danger-soft text-danger-soft-foreground', 'hover:bg-danger-soft-hover'].join(' '),
  transparent: 'bg-transparent text-text-primary hover:bg-background-secondary-default',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 md:h-8 data-[pressed]:scale-[0.98] [&_svg:not([data-slot=spinner-icon])]:size-4',
  md: '',
  lg: 'h-11 text-base md:h-10 data-[pressed]:scale-[0.96]',
}

export function Button({ variant = 'primary', size = 'md', isIconOnly = false, className, ...props }: ButtonProps) {
  return (
    <AriaButton
      data-slot="button"
      {...props}
      className={cx(
        'relative isolate inline-flex h-10 w-fit origin-center items-center justify-center gap-2 rounded-3xl px-4 text-sm font-medium whitespace-nowrap outline-none select-none',
        'button-press-motion md:h-9',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring data-[focus-visible]:ring-offset-2',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg:not([data-slot=spinner-icon])]:pointer-events-none [&_svg:not([data-slot=spinner-icon])]:-mx-0.5 [&_svg:not([data-slot=spinner-icon])]:size-5 [&_svg:not([data-slot=spinner-icon])]:shrink-0 sm:[&_svg:not([data-slot=spinner-icon])]:size-4',
        variantClasses[variant],
        sizeClasses[size],
        isIconOnly && 'w-10 p-0 md:w-9',
        isIconOnly && size === 'sm' && 'w-9 md:w-8',
        isIconOnly && size === 'lg' && 'w-11 md:w-10',
        className,
      )}
    />
  )
}
