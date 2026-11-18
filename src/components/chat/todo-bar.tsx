import { useState } from 'react'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { ProgressCircle } from '@/components/yuerchu-ui/components/progress-circle/progress-circle'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { LayoutDashboard, List } from '@keyline-icons/react/two-tone'
import { useTranslation } from 'react-i18next'

import './todo-bar.css'
import TodoBoard from './todo-board'
import { TodoItemList, todoProgress, type TodoArgs } from './todo-list'

type TodoView = 'list' | 'board'

/**
 * The checklist's progress as a ring.
 *
 * Hidden from the accessibility tree: whatever holds it takes its name from its
 * text, which spells the count out, so an exposed ring has it announced twice.
 * The attribute sits on a wrapper because React Aria's ProgressBar filters
 * `aria-hidden` off its own element. Both placements use the library's small
 * inline ring, without overriding its size or stroke.
 */
export function TodoRing({ todos }: { todos: TodoArgs }) {
  const { t } = useTranslation()
  const { done, total } = todoProgress(todos.todos)
  return (
    <span data-slot="todo-ring" aria-hidden="true" className="shrink-0">
      <ProgressCircle aria-label={t('chat.todo.progress', { done, total })} value={done} maxValue={total} size="sm" />
    </span>
  )
}

/**
 * Where the checklist stands, on one line: ring, title, the step under way and
 * the count. The queue card's current row — it is what an interjection hangs
 * off with `↳`, so it has to say what is running; the whole list is one press
 * away in the status tab's progress chip, and a second copy here would put two
 * of them on screen.
 */
export function TodoCurrentRow({ todos }: { todos: TodoArgs }) {
  const { t } = useTranslation()
  const { done, total, current } = todoProgress(todos.todos)
  return (
    <div data-slot="todo-current" className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-body-2-regular">
      <TodoRing todos={todos} />
      <span data-slot="todo-current-title" className="max-w-40 shrink-0 truncate text-body-2-medium text-text-primary">
        {todos.title}
      </span>
      <span data-slot="todo-current-step" className="min-w-0 flex-1 truncate text-text-secondary">
        {current ? current.active_form : t('chat.todo.idle')}
      </span>
      <span data-slot="todo-current-progress" className="shrink-0 tabular-nums text-text-secondary">
        {t('chat.todo.progress', { done, total })}
      </span>
    </div>
  )
}

/**
 * The whole checklist, as a list or as a board.
 *
 * Which of the two is component state, not a preference: which shape you want
 * to look at right now is not worth a round trip to the backend, and the panel
 * it lives in is closed most of the time anyway.
 */
export function TodoPanelBody({ todos, className }: { todos: TodoArgs; className?: string }) {
  const { t } = useTranslation()
  const [view, setView] = useState<TodoView>('list')
  return (
    <div data-slot="todo-panel" className={['m-todo-bar__panel', className].filter(Boolean).join(' ')}>
      <div data-slot="todo-panel-view-switch" className="m-todo-bar__view-switch">
        <SegmentedControl
          aria-label={`${t('chat.todo.viewList')} / ${t('chat.todo.viewBoard')}`}
          size="sm"
          selectedKey={view}
          onSelectionChange={(next) => {
            if (next === 'list' || next === 'board') setView(next)
          }}
        >
          <TooltipTrigger>
            <Segment id="list" aria-label={t('chat.todo.viewList')} icon={<List />} />
            <Tooltip>{t('chat.todo.viewList')}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <Segment id="board" aria-label={t('chat.todo.viewBoard')} icon={<LayoutDashboard />} />
            <Tooltip>{t('chat.todo.viewBoard')}</Tooltip>
          </TooltipTrigger>
        </SegmentedControl>
      </div>
      {view === 'board' ? <TodoBoard todos={todos.todos} /> : <TodoItemList todos={todos.todos} />}
    </div>
  )
}
