import { useTranslation } from 'react-i18next'
import { Kanban } from '@/components/base'

import type { TodoItemStatus } from '@/types'
import { cx } from '@/utils/cx'
import { TodoStatusIcon, type TodoDraft } from './todo-list'

const COLUMNS: readonly TodoItemStatus[] = ['pending', 'in_progress', 'completed']

/**
 * The same checklist as three columns.
 *
 * Read-only, and not by suppressing anything: `Kanban.DragHandle` and
 * `Kanban.DropIndicator` are separate components, so a board without a way to
 * drag is what you get by not rendering them. There is nothing to write back to
 * anyway — the list belongs to the model, and a status the user changed by hand
 * would be overwritten by the next `update_todos` without a trace.
 *
 * Imported statically, having checked. `kanban.js` does load `LazyMotion` with
 * `domMax` where the project otherwise asks for `domAnimation` alone
 * (`chat-transcript.tsx`) — but `domMax` is already in the main bundle by two
 * other routes: `prompt-input`, which the composer uses, and
 * `utils/tree-motion.js`, which every `Sidebar.Menu` pulls in. So the drag and
 * projection features are paid for whether this file exists or not, and what is
 * left to defer is five kilobytes.
 */
export default function TodoBoard({ todos, className }: { todos: TodoDraft[]; className?: string }) {
  const { t } = useTranslation()

  return (
    // 200px rather than the 240 that `size="sm"` sets: three columns have to
    // fit inside the composer's own width, and the grid is `auto-flow: column`
    // — too wide and it silently becomes a horizontal scroller with two
    // columns showing. Below that width it still scrolls, one column at a
    // snap, which is the right answer on a phone.
    <Kanban
      size="sm"
      aria-label={t('chat.todo.board')}
      className={cx('[--kanban-column-min-width:200px] [--kanban-column-height:auto]', className)}
    >
      {COLUMNS.map((status) => {
        const items = todos.filter((todo) => todo.status === status)
        return (
          <Kanban.Column key={status} data-status={status}>
            <Kanban.ColumnHeader>
              <Kanban.ColumnIndicator>
                <TodoStatusIcon status={status} />
              </Kanban.ColumnIndicator>
              <Kanban.ColumnTitle className="text-xs">{t(`chat.todo.status.${status}`)}</Kanban.ColumnTitle>
              <Kanban.ColumnCount>{items.length}</Kanban.ColumnCount>
            </Kanban.ColumnHeader>
            <Kanban.ColumnBody>
              <Kanban.CardList
                aria-label={t(`chat.todo.status.${status}`)}
                renderEmptyState={() => (
                  <span data-slot="todo-board-empty" className="text-xs text-text-secondary">
                    {t('chat.todo.emptyColumn')}
                  </span>
                )}
              >
                {/* Index as key and as id, for the reason `TodoItemList`
                    gives: a `TodoDraft` carries no id, and the list is
                    replaced wholesale rather than reordered. Scoped by status
                    because React Aria wants ids unique across the collection,
                    and three columns of `0` are not. */}
                {items.map((todo, i) => (
                  <Kanban.Card key={i} id={`${status}:${i}`} textValue={todo.content}>
                    <div data-slot="todo-board-card-body" className="p-2.5 text-xs">
                      <span
                        data-slot="todo-board-card-text"
                        className={cx(
                          status === 'completed' && 'text-text-secondary line-through',
                          status === 'in_progress' && 'font-medium text-text-primary',
                          status === 'pending' && 'text-text-secondary',
                        )}
                      >
                        {todo.content}
                      </span>
                    </div>
                  </Kanban.Card>
                ))}
              </Kanban.CardList>
            </Kanban.ColumnBody>
          </Kanban.Column>
        )
      })}
    </Kanban>
  )
}
