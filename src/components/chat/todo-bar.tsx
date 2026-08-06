import { Disclosure, ProgressCircle } from '@heroui/react'
import { useTranslation } from 'react-i18next'

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
        <Disclosure
          data-slot="todo-bar"
          className="w-full overflow-hidden rounded-xl border border-border bg-surface/30 text-xs"
        >
          <Disclosure.Heading>
            {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto`
                and `shrink-0`, which only mean anything inside a flex container. */}
            <Disclosure.Trigger
              data-slot="todo-bar-trigger"
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30"
            >
              {/* `--info` has no `color` variant of its own — HeroUI's are
                  accent/default/success/warning/danger. The stroke reads a
                  custom property, so pointing that at the token is the
                  supported way in rather than restyling the circle. */}
              <ProgressCircle
                aria-label={t('chat.todo.progress', { done, total })}
                value={done}
                maxValue={total}
                className="shrink-0 [--progress-circle-stroke:var(--info)]"
              >
                <ProgressCircle.Track className="size-3.5">
                  <ProgressCircle.TrackCircle />
                  <ProgressCircle.FillCircle />
                </ProgressCircle.Track>
              </ProgressCircle>
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
              <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content data-slot="todo-bar-content">
            {/* Body, not a plain wrapper: it is what keeps the panel measurable,
                so without it the list never collapses. */}
            <Disclosure.Body>
              <TodoItemList todos={todos.todos} className="px-3 pb-2.5" />
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </div>
    </div>
  )
}
