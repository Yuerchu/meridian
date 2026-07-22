import { cn } from '@/lib/utils'

interface CircularProgressProps extends React.ComponentProps<'svg'> {
  value?: number
  max?: number
  size?: number
  strokeWidth?: number
  indeterminate?: boolean
}

function CircularProgress({
  value = 0,
  max = 100,
  size = 20,
  strokeWidth = 2.5,
  indeterminate,
  className,
  ...props
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  if (indeterminate) {
    return (
      <svg
        data-slot="circular-progress"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn('shrink-0 animate-spin', className)}
        role="progressbar"
        {...props}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="opacity-15"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference * 0.25} ${circumference * 0.75}`}
          strokeLinecap="round"
        />
      </svg>
    )
  }

  const ratio = Math.min(Math.max(value / max, 0), 1)
  const offset = circumference * (1 - ratio)

  return (
    <svg
      data-slot="circular-progress"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0 -rotate-90', className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      {...props}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-15"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  )
}

export { CircularProgress }
export type { CircularProgressProps }
