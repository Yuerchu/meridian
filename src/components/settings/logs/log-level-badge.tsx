import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import type { LogRecordLevel } from '@/types'

/** Levels below info share the neutral tone: they are context, and info is grey,
 *  not accent (DESIGN §4.3). The level word is the status; the badge does not
 *  add a second signal. */
export function toneFor(level: LogRecordLevel): 'danger' | 'warning' | 'neutral' {
  switch (level) {
    case 'ERROR':
      return 'danger'
    case 'WARN':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function LogLevelBadge({ level }: { level: LogRecordLevel }) {
  return (
    <Badge data-slot="log-level-badge" tone={toneFor(level)} size="sm">
      {level}
    </Badge>
  )
}
