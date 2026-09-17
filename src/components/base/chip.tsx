import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type ChipVariant = 'primary' | 'secondary' | 'soft' | 'tertiary'
type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger'
type ChipSize = 'sm' | 'md' | 'lg'

interface ChipProps extends Omit<ComponentProps<'span'>, 'color'> {
  variant?: ChipVariant
  color?: ChipColor
  size?: ChipSize
}

const colorClasses: Record<ChipColor, string> = {
  default: '[--chip-fg:var(--default-foreground)]',
  accent: '[--chip-fg:var(--accent-soft-foreground)]',
  success: '[--chip-fg:var(--success-soft-foreground)]',
  warning: '[--chip-fg:var(--warning-soft-foreground)]',
  danger: '[--chip-fg:var(--danger-soft-foreground)]',
}

const softColorClasses: Record<ChipColor, string> = {
  default: '[--chip-bg:var(--default-soft)] [--chip-fg:var(--default-soft-foreground)]',
  accent: '[--chip-bg:var(--accent-soft)] [--chip-fg:var(--accent-soft-foreground)]',
  success: '[--chip-bg:var(--success-soft)] [--chip-fg:var(--success-soft-foreground)]',
  warning: '[--chip-bg:var(--warning-soft)] [--chip-fg:var(--warning-soft-foreground)]',
  danger: '[--chip-bg:var(--danger-soft)] [--chip-fg:var(--danger-soft-foreground)]',
}

const primaryColorClasses: Record<ChipColor, string> = {
  default: '',
  accent: '[--chip-bg:var(--accent)] [--chip-fg:var(--accent-foreground)]',
  success: '[--chip-bg:var(--success)] [--chip-fg:var(--success-foreground)]',
  warning: '[--chip-bg:var(--warning)] [--chip-fg:var(--warning-foreground)]',
  danger: '[--chip-bg:var(--danger)] [--chip-fg:var(--danger-foreground)]',
}

const sizeClasses: Record<ChipSize, string> = {
  sm: 'px-1 py-0 text-xs',
  md: 'text-xs',
  lg: 'px-3 py-1 text-sm font-medium',
}

function ChipRoot({ variant = 'primary', color = 'default', size = 'md', className, ...props }: ChipProps) {
  const variantColorClass =
    variant === 'soft'
      ? softColorClasses[color]
      : variant === 'primary'
        ? primaryColorClasses[color]
        : variant === 'tertiary'
          ? '[--chip-bg:transparent]'
          : colorClasses[color]

  return (
    <span
      data-slot="chip"
      {...props}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-0.5 rounded-2xl px-2 py-0.5 text-xs leading-5 font-medium',
        'bg-[var(--chip-bg,var(--default))] text-[var(--chip-fg,currentColor)]',
        variantColorClass,
        sizeClasses[size],
        className,
      )}
    />
  )
}

function ChipLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="chip-label" {...props} className={cn('px-0.5', className)} />
}

export const Chip = Object.assign(ChipRoot, { Label: ChipLabel })
