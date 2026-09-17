import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl'
type SpinnerColor = 'current' | 'accent' | 'danger' | 'success' | 'warning'

interface SpinnerProps extends Omit<ComponentProps<'span'>, 'color'> {
  size?: SpinnerSize
  color?: SpinnerColor
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8',
  xl: 'size-10',
}

const colorClasses: Record<SpinnerColor, string> = {
  current: 'text-current',
  accent: 'text-accent',
  danger: 'text-danger',
  success: 'text-success',
  warning: 'text-warning',
}

function SpinnerIcon(props: ComponentProps<'svg'>) {
  const id = useId()
  return (
    <svg data-slot="spinner-icon" viewBox="0 0 24 24" {...props}>
      <defs>
        <linearGradient id={`sp-g1-${id}`} x1="50%" x2="50%" y1="5.271%" y2="91.793%">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
        </linearGradient>
        <linearGradient id={`sp-g2-${id}`} x1="50%" x2="50%" y1="15.24%" y2="87.15%">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
        </linearGradient>
      </defs>
      <g fill="none">
        <path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z" />
        <path
          d="M8.749.021a1.5 1.5 0 0 1 .497 2.958A7.5 7.5 0 0 0 3 10.375a7.5 7.5 0 0 0 7.5 7.5v3c-5.799 0-10.5-4.7-10.5-10.5C0 5.23 3.726.865 8.749.021"
          fill={`url(#sp-g1-${id})`}
          transform="translate(1.5 1.625)"
        />
        <path
          d="M15.392 2.673a1.5 1.5 0 0 1 2.119-.115A10.48 10.48 0 0 1 21 10.375c0 5.8-4.701 10.5-10.5 10.5v-3a7.5 7.5 0 0 0 5.007-13.084a1.5 1.5 0 0 1-.115-2.118"
          fill={`url(#sp-g2-${id})`}
          transform="translate(1.5 1.625)"
        />
      </g>
    </svg>
  )
}

export function Spinner({ className, size = 'md', color = 'current', ...props }: SpinnerProps) {
  return (
    <span
      aria-label="Loading"
      data-slot="spinner"
      role="status"
      {...props}
      className={cn(
        // eslint-disable-next-line no-restricted-syntax -- this IS the Spinner component
        'pointer-events-none inline-flex shrink-0 animate-spin-fast motion-reduce:animate-none',
        sizeClasses[size],
        colorClasses[color],
        className,
      )}
    >
      <SpinnerIcon aria-hidden />
    </span>
  )
}
