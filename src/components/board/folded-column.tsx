// A column folded to a rail while attention is elsewhere.
//
// Three widths, one per question: folded says how many and whether any is
// waiting on you; hovered (or focused from the keyboard) widens a little and
// lists what is in it; pressed opens the column for real. The peek is drawn
// over the neighbours, so the cards under the pointer never reflow.
import { useTranslation } from 'react-i18next'
import { Button as RacButton } from 'react-aria-components'

import { Kanban } from '@/components/base'
import { cx } from '@/utils/cx'
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
    <Kanban.Column data-folded className="group/rail relative w-12 min-w-12 flex-none bg-transparent p-0">
      <RacButton
        aria-label={
          waiting > 0
            ? t('board.column.openWaiting', { title, count: cards.length, waiting })
            : t('board.column.open', { title, count: cards.length })
        }
        onPress={onOpen}
        className={cx(
          'absolute inset-y-0 z-10 flex w-12 flex-col items-stretch gap-2 overflow-hidden rounded-2-5xl bg-background-secondary-default p-2 text-left outline-none',
          'transition-[width,box-shadow] duration-200 ease-out data-hovered:w-56 data-hovered:shadow-card data-focus-visible:w-56 data-focus-visible:shadow-card data-focus-visible:ring-2 data-focus-visible:ring-border-focus-ring',
          side === 'start' ? 'left-0' : 'right-0',
        )}
      >
        <span className="flex items-center justify-center gap-1.5 group-hover/rail:justify-start group-has-data-focus-visible/rail:justify-start">
          <Kanban.ColumnCount className="ml-0">{cards.length}</Kanban.ColumnCount>
          <span className="hidden truncate text-caption-1-medium text-text-primary group-hover/rail:inline group-has-data-focus-visible/rail:inline">
            {title}
          </span>
        </span>
        {waiting > 0 && (
          <span className="mx-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-status-warning text-caption-2-semibold text-status-warning-foreground group-hover/rail:hidden group-has-data-focus-visible/rail:hidden">
            {waiting}
          </span>
        )}
        <span className="self-center text-caption-1-medium whitespace-nowrap text-text-secondary [writing-mode:vertical-rl] group-hover/rail:hidden group-has-data-focus-visible/rail:hidden">
          {title}
        </span>
        <span className="hidden flex-col gap-1 group-hover/rail:flex group-has-data-focus-visible/rail:flex">
          {cards.map(({ task, state }) => (
            <span
              key={task.id}
              className="flex min-w-0 items-center gap-1.5 rounded-lg bg-background-primary-default px-2 py-1.5 text-caption-1-regular"
            >
              <StateIcon state={state} />
              <span className="truncate text-text-primary">{task.title}</span>
            </span>
          ))}
        </span>
      </RacButton>
    </Kanban.Column>
  )
}
