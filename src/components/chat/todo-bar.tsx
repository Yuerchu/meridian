import { useState } from 'react'
import { Disclosure, ProgressCircle } from '@heroui/react'
import { Segment } from '@heroui-pro/react/segment'
import { LayoutColumns3, LayoutList } from '@gravity-ui/icons'
import { useTranslation } from 'react-i18next'

import { useConversationStore } from '@/stores/conversation-store'
import { cn } from '@/lib/utils'
import TodoBoard from './todo-board'
import { TodoItemList, todoProgress, type TodoArgs } from './todo-list'

type TodoView = 'list' | 'board'

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
  // Component state, not a preference: which of two shapes you want to look at
  // right now is not worth a round trip to the backend, and the panel it lives
  // in is closed most of the time anyway.
  const [view, setView] = useState<TodoView>('list')

  return (
    <div
      data-slot="todo-bar-shell"
      className={cn('px-4 pt-2 pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]', className)}
    >
      <div className="mx-auto max-w-2xl">
        {/* Same card as the tool cards, edge included — see `CHAT_TOOL_CARD` in
            `ui/chat-tool.tsx` for why a card in the transcript cannot rely on
            fill and shadow alone. */}
        <Disclosure
          data-slot="todo-bar"
          className="w-full overflow-hidden rounded-2xl bg-surface text-sm shadow-surface ring-1 ring-border ring-inset"
        >
          <Disclosure.Heading>
            {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto`
                and `shrink-0`, which only mean anything inside a flex container. */}
            <Disclosure.Trigger
              data-slot="todo-bar-trigger"
              className={cn(
                'flex w-full items-center gap-2 p-4 text-left transition-colors outline-none',
                'hover:bg-default focus-visible:bg-default',
              )}
            >
              {/* `--info` has no `color` variant of its own — HeroUI's are
                  accent/default/success/warning/danger. The stroke reads a
                  custom property, so pointing that at the token is the
                  supported way in rather than restyling the circle. */}
              {/* Hidden from the accessibility tree: the trigger takes its name
                  from its contents and the count is already spelled out to the
                  right, so an exposed ring has it announced twice. The attribute
                  sits on a wrapper because React Aria's ProgressBar filters
                  `aria-hidden` off its own element; the label it insists on
                  never surfaces from in here. */}
              <span aria-hidden="true" className="shrink-0">
                <ProgressCircle
                  aria-label={t('chat.todo.progress', { done, total })}
                  value={done}
                  maxValue={total}
                  className="[--progress-circle-stroke:var(--info)]"
                >
                  <ProgressCircle.Track className="size-3.5">
                    <ProgressCircle.TrackCircle />
                    <ProgressCircle.FillCircle />
                  </ProgressCircle.Track>
                </ProgressCircle>
              </span>
              {/* Same shape as ChatToolTrigger: the label row absorbs the slack
                  so the count and chevron sit at the right edge without an
                  ml-auto fighting for the free space. */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span data-slot="todo-bar-title" className="max-w-40 shrink-0 truncate font-medium text-foreground">
                  {todos.title}
                </span>
                <span data-slot="todo-bar-current" className="truncate text-muted">
                  {current ? current.active_form : t('chat.todo.idle')}
                </span>
              </div>
              <span className="shrink-0 tabular-nums text-muted">{t('chat.todo.progress', { done, total })}</span>
              <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content data-slot="todo-bar-content">
            {/* Body, not a plain wrapper: it is what keeps the panel measurable,
                so without it the list never collapses. */}
            <Disclosure.Body>
              <div className="flex justify-end px-4 pb-2">
                <Segment
                  aria-label={`${t('chat.todo.viewList')} / ${t('chat.todo.viewBoard')}`}
                  size="sm"
                  selectedKey={view}
                  onSelectionChange={(next) => {
                    if (next === 'list' || next === 'board') setView(next)
                  }}
                >
                  <Segment.Item id="list" aria-label={t('chat.todo.viewList')} className="w-7 px-0">
                    <LayoutList />
                  </Segment.Item>
                  <Segment.Item id="board" aria-label={t('chat.todo.viewBoard')} className="w-7 px-0">
                    <LayoutColumns3 />
                  </Segment.Item>
                </Segment>
              </div>
              {view === 'board' ? (
                <TodoBoard todos={todos.todos} className="px-4 pb-4" />
              ) : (
                <TodoItemList todos={todos.todos} className="px-4 pb-4" />
              )}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </div>
    </div>
  )
}
