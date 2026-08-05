import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * There is no Badge in the UI kit, so this is a plain span with variants.
 * Colours stay on theme tokens — the palette classes are off limits, and the
 * amber exception is reserved for default-item stars.
 */
const memoryBadgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-normal',
  {
    variants: {
      tone: {
        neutral: 'bg-default text-muted',
        accent: 'bg-default text-default-foreground',
        /** Owner-only rows: the subject cannot see these. */
        warning: 'bg-default text-warning',
        info: 'bg-default text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface MemoryBadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof memoryBadgeVariants> {}

export function MemoryBadge({ className, tone, ...props }: MemoryBadgeProps) {
  return (
    <span
      data-slot="memory-badge"
      className={cn(memoryBadgeVariants({ tone }), className)}
      {...props}
    />
  )
}
