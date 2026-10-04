import { useTranslation } from 'react-i18next'

import { Popover } from '@/components/base'
import { TodoPanelBody, TodoRing } from './todo-bar'
import { todoProgress, type TodoArgs } from './todo-list'

/**
 * The running checklist, as a chip in the composer's status tab: the ring, the
 * count and the step under way, and the whole list one press away.
 *
 * It used to be a disclosure bar pinned over the composer, open or shut, which
 * took a row of the transcript for as long as a checklist existed. The status
 * tab already says what the conversation is doing — which model is filling
 * which window — and where the checklist stands is the same kind of fact. The
 * list is a popover, the way the `+` menu is: pressing anywhere else closes it.
 */
export function TodoProgressChip({ todos }: { todos: TodoArgs }) {
  const { t } = useTranslation()
  const { done, total, current } = todoProgress(todos.todos)
  const progress = t('chat.todo.progress', { done, total })
  const step = current ? current.active_form : t('chat.todo.idle')
  return (
    <Popover>
      <Popover.Trigger
        data-slot="todo-progress-chip"
        aria-label={`${todos.title}, ${progress}, ${step}`}
        className="touch-hitbox h-7 min-w-0 gap-1.5 rounded-full px-1.5 text-body-2-medium text-text-secondary transition-colors duration-150 data-[hovered]:bg-background-primary-hover data-[pressed]:bg-background-primary-hover"
      >
        <TodoRing todos={todos} className="size-4" />
        <span data-slot="todo-progress-chip-count" className="shrink-0 tabular-nums">
          {progress}
        </span>
        <span data-slot="todo-progress-chip-step" className="min-w-0 max-w-40 truncate">
          {step}
        </span>
      </Popover.Trigger>
      <Popover.Content placement="top start" className="w-80 p-3">
        <Popover.Dialog aria-label={todos.title} className="flex flex-col gap-2">
          <div data-slot="todo-progress-header" className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">{todos.title}</span>
            <span className="shrink-0 text-body-2-regular tabular-nums text-text-secondary">{progress}</span>
          </div>
          <TodoPanelBody todos={todos} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
