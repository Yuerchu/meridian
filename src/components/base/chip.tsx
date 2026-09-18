import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

type ChipVariant = 'primary' | 'secondary' | 'soft' | 'tertiary'
type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger'
type ChipSize = 'sm' | 'md' | 'lg'

interface ChipProps extends Omit<ComponentProps<'span'>, 'color'> {
  variant?: ChipVariant
  color?: ChipColor
  size?: ChipSize
}

const colorClasses: Record<ChipColor, string> = {
  default: 'text-text-primary',
  accent: 'text-accent-soft-foreground',
  success: 'text-success-soft-foreground',
  warning: 'text-warning-soft-foreground',
  danger: 'text-danger-soft-foreground',
}

const softColorClasses: Record<ChipColor, string> = {
  default: 'bg-background-secondary-default text-text-secondary',
  accent: 'bg-accent-soft text-accent-soft-foreground',
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
}

const primaryColorClasses: Record<ChipColor, string> = {
  default: '',
  accent: 'bg-accent-500 text-text-white',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  danger: 'bg-danger text-danger-foreground',
}

const sizeClasses: Record<ChipSize, string> = {
  sm: 'px-1 py-0 text-caption-1-medium',
  md: 'text-caption-1-medium',
  lg: 'px-3 py-1 text-body-2-medium',
}

function ChipRoot({ variant = 'primary', color = 'default', size = 'md', className, ...props }: ChipProps) {
  const variantColorClass =
    variant === 'soft'
      ? softColorClasses[color]
      : variant === 'primary'
        ? primaryColorClasses[color]
        : variant === 'tertiary'
          ? 'bg-transparent'
          : colorClasses[color]

  return (
    <span
      data-slot="chip"
      {...props}
      className={cx(
        'inline-flex w-fit shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 leading-5 font-medium',
        variant === 'primary' && color === 'default' && 'bg-background-secondary-default text-text-primary',
        variant === 'secondary' && 'bg-background-secondary-default',
        variantColorClass,
        sizeClasses[size],
        className,
      )}
    />
  )
}

function ChipLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="chip-label" {...props} className={cx('px-0.5', className)} />
}

export const Chip = Object.assign(ChipRoot, { Label: ChipLabel })
