import { Collapsible } from '@base-ui/react/collapsible'
import { ChevronDownIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CircularProgress } from '@/components/ui/circular-progress'
import { useConversationStore } from '@/stores/conversation-store'
import { cn } from '@/lib/utils'
import { TodoItemList, todoProgress, type TodoArgs } from './todo-list'

/**
 * The running checklist, pinned above the composer. The transcript cards show
 * what the checklist looked like at each update; this shows where it stands
 * now, which is otherwise lost as soon as the user scrolls.
 */
export function TodoBar({ conversationId, className }: { conversationId: string; className?: string }) {
  const todos = useConversationStore((s) => s.sessions[conversationId]?.activeTodos ?? null)
  if (!todos) return null
  return <TodoBarView todos={todos} className={className} />
}

/** Split out from the store so the playground can render it without a session. */
export function TodoBarView({ todos, className }: { todos: TodoArgs; className?: string }) {
  const { t } = useTranslation()
  const { done, total, current } = todoProgress(todos.todos)

  return (
    <div data-slot="todo-bar-shell" className={cn('px-4 pt-2', className)}>
      <div className="mx-auto max-w-2xl">
        <Collapsible.Root
          data-slot="todo-bar"
          className="w-full overflow-hidden rounded-xl border border-border bg-card/30 text-xs"
        >
          <Collapsible.Trigger
            data-slot="todo-bar-trigger"
            className="group/todo-bar flex w-full items-center gap-2 px-3 py-2 text-left transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30"
          >
            <CircularProgress
              value={done}
              max={total}
              size={14}
              strokeWidth={2.5}
              className="shrink-0 text-info"
            />
            {/* Same shape as ChatToolTrigger: the label row absorbs the slack
                so the count and chevron sit at the right edge without an
                ml-auto fighting for the free space. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                data-slot="todo-bar-title"
                className="max-w-40 shrink-0 truncate font-medium text-foreground"
              >
                {todos.title}
              </span>
              <span data-slot="todo-bar-current" className="truncate text-muted">
                {current ? current.active_form : t('chat.todo.idle')}
              </span>
            </div>
            <span className="shrink-0 tabular-nums text-muted">
              {t('chat.todo.progress', { done, total })}
            </span>
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-data-panel-open/todo-bar:rotate-180"
            />
          </Collapsible.Trigger>
          <Collapsible.Panel
            data-slot="todo-bar-content"
            className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0"
          >
            <TodoItemList todos={todos.todos} className="px-3 pb-2.5" />
          </Collapsible.Panel>
        </Collapsible.Root>
      </div>
    </div>
  )
}
