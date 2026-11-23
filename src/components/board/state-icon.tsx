import './state-icon.css'
import { CircleAlert, CircleCheck, CircleQuestion, CircleX } from '@keyline-icons/react/two-tone'
import { Stop } from '@keyline-icons/react/fill'

import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import type { AgentState } from './agent-state'

/** A card's state as one icon, where there is no room for the line — the
 *  folded rail's peek. The colours are the status tokens the line uses. */
export function StateIcon({ state }: { state: AgentState }) {
  switch (state.kind) {
    case 'idle':
      return <span aria-hidden className="m-board-state-icon__idle" />
    case 'working':
      return (
        <span aria-hidden className="m-board-state-icon__working">
          <Spinner size="sm" />
        </span>
      )
    case 'approval':
      return <CircleAlert aria-hidden data-tone="warning" className="m-board-state-icon" />
    case 'question':
      return <CircleQuestion aria-hidden data-tone="warning" className="m-board-state-icon" />
    case 'failed':
      return <CircleX aria-hidden data-tone="danger" className="m-board-state-icon" />
    case 'finished':
      return state.stopped ? (
        <Stop aria-hidden data-tone="muted" className="m-board-state-icon" />
      ) : (
        <CircleCheck aria-hidden data-tone="success" className="m-board-state-icon" />
      )
  }
}
