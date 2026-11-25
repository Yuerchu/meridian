// A column folded to a rail while attention is elsewhere.
//
// Three widths, one per question: folded says how many and whether any is
// waiting on you; hovered (or focused from the keyboard) widens a little and
// lists what is in it; pressed opens the column for real. The peek is drawn
// over the neighbours, so the cards under the pointer never reflow.
import './folded-column.css'
import { useTranslation } from 'react-i18next'
import { Button as RacButton } from 'react-aria-components'

import type { BoardTaskInfoResponse } from '@/types'
import type { AgentState } from './agent-state'
import { StateIcon } from './state-icon'

export interface FoldedCard {
  task: BoardTaskInfoResponse
  state: AgentState
  waiting: boolean
}

export function FoldedColumn({
  title,
  cards,
  side,
  onOpen,
}: {
  title: string
  cards: FoldedCard[]
  /** Which edge the peek grows from: away from the open columns, so it covers them rather than pushing them. */
  side: 'start' | 'end'
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const waiting = cards.filter((c) => c.waiting).length
  return (
    <div data-slot="board-folded-column" data-folded="" className="m-board-folded">
      <RacButton
        data-side={side}
        aria-label={
          waiting > 0
            ? t('board.column.openWaiting', { title, count: cards.length, waiting })
            : t('board.column.open', { title, count: cards.length })
        }
        onPress={onOpen}
        className="m-board-folded__rail"
      >
        <span className="m-board-folded__header">
          <span className="m-board-folded__count">{cards.length}</span>
          <span className="m-board-folded__title">{title}</span>
        </span>
        {waiting > 0 && <span className="m-board-folded__waiting">{waiting}</span>}
        <span className="m-board-folded__vertical-title">{title}</span>
        <span className="m-board-folded__list">
          {cards.map(({ task, state }) => (
            <span key={task.id} className="m-board-folded__card">
              <StateIcon state={state} />
              <span className="m-board-folded__card-title">{task.title}</span>
            </span>
          ))}
        </span>
      </RacButton>
    </div>
  )
}
