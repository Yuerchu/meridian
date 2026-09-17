import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cn } from '@/lib/utils'

type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'danger-soft' | 'transparent'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends AriaButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  isIconOnly?: boolean
  className?: string
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: '[--button-bg:var(--accent)] [--button-bg-hover:var(--accent-hover)] [--button-fg:var(--accent-foreground)]',
  secondary:
    '[--button-bg:var(--default)] [--button-bg-hover:var(--default-hover)] [--button-fg:var(--accent-soft-foreground)]',
  tertiary: '[--button-bg:var(--default)] [--button-bg-hover:var(--default-hover)]',
  outline:
    '[--button-bg:transparent] [--button-bg-hover:color-mix(in_srgb,var(--default)_60%,transparent)] border border-border',
  ghost: '[--button-bg:transparent] [--button-bg-hover:var(--default)] [--button-fg:var(--default-foreground)]',
  danger: '[--button-bg:var(--danger)] [--button-bg-hover:var(--danger-hover)] [--button-fg:var(--danger-foreground)]',
  'danger-soft':
    '[--button-bg:var(--danger-soft)] [--button-bg-hover:var(--danger-soft-hover)] [--button-fg:var(--danger-soft-foreground)]',
  transparent: '[--button-bg:transparent] [--button-bg-hover:transparent]',
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
      className={cn(
        'relative isolate inline-flex h-10 w-fit origin-center items-center justify-center gap-2 rounded-3xl px-4 text-sm font-medium whitespace-nowrap outline-none select-none',
        'transform-gpu will-change-transform motion-reduce:transition-none md:h-9',
        'transition-[transform,background-color,box-shadow] duration-100',
        'bg-[var(--button-bg,transparent)] text-[var(--button-fg,currentColor)]',
        'hover:bg-[var(--button-bg-hover,var(--button-bg,transparent))]',
        'data-[pressed]:bg-[var(--button-bg-hover,var(--button-bg,transparent))] data-[pressed]:scale-[0.97]',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-background',
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
