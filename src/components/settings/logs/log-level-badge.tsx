import { tv, type VariantProps } from '@heroui/react'
import { cn } from '@/lib/utils'
import type { LogLevel } from '@/types'

const levelBadgeVariants = tv({
  base: 'inline-flex shrink-0 items-center gap-1.5 font-mono text-xs uppercase tabular-nums',
  variants: {
    level: {
      error: 'text-danger',
      warn: 'text-warning',
      info: 'text-info',
      muted: 'text-muted',
    },
  },
  defaultVariants: { level: 'muted' },
})

const dotVariants = tv({
  base: 'size-1.5 shrink-0 rounded-full',
  variants: {
    level: {
      error: 'bg-danger',
      warn: 'bg-warning',
      info: 'bg-info',
      muted: 'bg-muted',
    },
  },
  defaultVariants: { level: 'muted' },
})

type Tone = NonNullable<VariantProps<typeof levelBadgeVariants>['level']>

/** Levels below info and anything unrecognised share the muted tone: they are
 *  context, not something to draw the eye. */
export function toneFor(level: LogLevel): Tone {
  switch (level) {
    case 'ERROR':
      return 'error'
    case 'WARN':
      return 'warn'
    case 'INFO':
      return 'info'
    default:
      return 'muted'
  }
}

export function LogLevelBadge({ level, className }: { level: LogLevel; className?: string }) {
  const tone = toneFor(level)
  return (
    <span data-slot="log-level-badge" className={cn(levelBadgeVariants({ level: tone }), className)}>
      <span data-slot="log-level-dot" className={dotVariants({ level: tone })} />
      {level}
    </span>
  )
}
