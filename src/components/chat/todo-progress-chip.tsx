import './todo-progress-chip.css'
import { DialogTrigger, Dialog as PopoverDialog, Button as PopoverButton } from 'react-aria-components'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { useTranslation } from 'react-i18next'

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
    <DialogTrigger>
      <PopoverButton
        data-slot="todo-progress-chip"
        aria-label={`${todos.title}, ${progress}, ${step}`}
        className="m-todo-progress-chip__trigger"
      >
        <TodoRing todos={todos} />
        <span data-slot="todo-progress-chip-count" className="m-todo-progress-chip__count">
          {progress}
        </span>
        <span data-slot="todo-progress-chip-step" className="m-todo-progress-chip__step">
          {step}
        </span>
      </PopoverButton>
      <Popover offset={8} placement="top start" className="m-todo-progress-chip__panel-1">
        <PopoverDialog aria-label={todos.title}>
          <div className="m-todo-progress-chip__panel-1-body m-todo-progress-chip__details">
            <div data-slot="todo-progress-header" className="m-todo-progress-chip__heading">
              <span className="m-todo-progress-chip__title">{todos.title}</span>
              <span className="m-todo-progress-chip__progress">{progress}</span>
            </div>
            <TodoPanelBody todos={todos} />
          </div>
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  )
}
