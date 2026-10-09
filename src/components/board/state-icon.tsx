import { CircleAlert, CircleCheck, CircleQuestion, CircleX } from '@keyline-icons/react/two-tone'
import { Stop } from '@keyline-icons/react/fill'

import { Spinner } from '@/components/base'
import type { AgentState } from './agent-state'

/** A card's state as one icon, where there is no room for the line — the
 *  folded rail's peek. The colours are the status tokens the line uses. */
export function StateIcon({ state }: { state: AgentState }) {
  switch (state.kind) {
    case 'idle':
      return <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-separator-border" />
    case 'working':
      return <Spinner size="sm" color="current" aria-hidden className="text-status-info-soft-foreground" />
    case 'approval':
      return <CircleAlert aria-hidden className="size-4 shrink-0 text-status-warning-soft-foreground" />
    case 'question':
      return <CircleQuestion aria-hidden className="size-4 shrink-0 text-status-warning-soft-foreground" />
    case 'failed':
      return <CircleX aria-hidden className="size-4 shrink-0 text-status-danger-soft-foreground" />
    case 'finished':
      return state.stopped ? (
        <Stop aria-hidden className="size-4 shrink-0 text-text-secondary" />
      ) : (
        <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-soft-foreground" />
      )
  }
}
