import './todo-board.css'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Kanban,
  KanbanCard,
  KanbanColumn,
  type KanbanColumnData,
  type KanbanItem,
} from '@/components/yuerchu-ui/components/kanban/kanban'

import type { TodoItemStatus } from '@/types'
import type { TodoDraft } from './todo-list'

const COLUMNS: readonly TodoItemStatus[] = ['pending', 'in_progress', 'completed']

interface TodoBoardCard extends KanbanItem {
  status: TodoItemStatus
  todo: TodoDraft
}

/**
 * The same checklist as three read-only columns.
 *
 * The list belongs to the model, and a status the user changed by hand would be
 * overwritten by the next `update_todos` without a trace, so the board renders
 * with `isReadOnly`.
 */
export default function TodoBoard({ todos, className }: { todos: TodoDraft[]; className?: string }) {
  const { t } = useTranslation()

  const columns: KanbanColumnData<TodoBoardCard>[] = useMemo(
    () =>
      COLUMNS.map((status) => ({
        id: status,
        heading: t(`chat.todo.status.${status}`),
        cards: todos
          .filter((todo) => todo.status === status)
          .map((todo, i) => ({
            // Index as id, scoped by status because React Aria wants ids
            // unique across the collection and a `TodoDraft` carries no id.
            id: `${status}:${i}`,
            textValue: todo.content.trim() ? todo.content : `${status}:${i}`,
            status,
            todo,
          })),
      })),
    [todos, t],
  )

  return (
    <div data-slot="todo-board" className={['m-todo-board', className].filter(Boolean).join(' ')}>
      <Kanban columns={columns} isReadOnly aria-label={t('chat.todo.board')}>
        {(column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            emptyState={
              <span data-slot="todo-board-empty" className="m-todo-board__empty">
                {t('chat.todo.emptyColumn')}
              </span>
            }
          >
            {(card) => (
              <KanbanCard key={card.id} card={card}>
                <div data-slot="todo-board-card-body" className="m-todo-board__card-body">
                  <span data-slot="todo-board-card-text" data-status={card.status} className="m-todo-board__card-text">
                    {card.todo.content}
                  </span>
                </div>
              </KanbanCard>
            )}
          </KanbanColumn>
        )}
      </Kanban>
    </div>
  )
}
