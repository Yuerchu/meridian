import { tv, type VariantProps } from '@/components/base'
import { cx } from '@/utils/cx'
import type { LogRecordLevel } from '@/types'

const levelBadgeVariants = tv({
  base: 'inline-flex shrink-0 items-center gap-1.5 font-mono text-caption-1-regular tabular-nums',
  variants: {
    level: {
      error: 'text-status-danger',
      warn: 'text-status-warning-soft-foreground',
      info: 'text-status-info-soft-foreground',
      muted: 'text-text-secondary',
    },
  },
  defaultVariants: { level: 'muted' },
})

const dotVariants = tv({
  base: 'size-1.5 shrink-0 rounded-full',
  variants: {
    level: {
      error: 'bg-status-danger',
      warn: 'bg-status-warning',
      info: 'bg-status-info',
      muted: 'bg-background-secondary-default',
    },
  },
  defaultVariants: { level: 'muted' },
})

type Tone = NonNullable<VariantProps<typeof levelBadgeVariants>['level']>

/** Levels below info and anything unrecognised share the muted tone: they are
 *  context, not something to draw the eye. */
export function toneFor(level: LogRecordLevel): Tone {
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

export function LogLevelBadge({ level, className }: { level: LogRecordLevel; className?: string }) {
  const tone = toneFor(level)
  return (
    <span data-slot="log-level-badge" className={cx(levelBadgeVariants({ level: tone }), className)}>
      <span data-slot="log-level-dot" className={dotVariants({ level: tone })} />
      {level}
    </span>
  )
}
