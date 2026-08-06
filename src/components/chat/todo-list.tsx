import { Square, SquareCheck, SquareMinus } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'
import type { TodoItem, TodoItemStatus } from '@/types'

/**
 * One step as the model sent it. The tool arguments and the stored rows carry
 * the same three fields, so both the transcript card (which only has the
 * arguments) and the status bar (which reloads rows from the database) render
 * through the same components.
 */
export interface TodoDraft {
  content: string
  active_form: string
  status: TodoItemStatus
}

export interface TodoArgs {
  title: string
  todos: TodoDraft[]
}

const STATUSES: readonly TodoItemStatus[] = ['pending', 'in_progress', 'completed']

function isDraft(value: unknown): value is TodoDraft {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.content === 'string'
    && typeof v.active_form === 'string'
    && STATUSES.includes(v.status as TodoItemStatus)
}

/**
 * `null` when the payload is not (yet) a complete checklist. Tool arguments
 * arrive as partial JSON while the call streams in, and callers fall back to
 * the generic tool card until the whole thing parses.
 */
export function parseTodoArgs(args: Record<string, unknown>): TodoArgs | null {
  if (typeof args.title !== 'string' || !Array.isArray(args.todos)) return null
  if (args.todos.length === 0 || !args.todos.every(isDraft)) return null
  return { title: args.title, todos: args.todos }
}

export function toDrafts(items: TodoItem[]): TodoDraft[] {
  return items.map((i) => ({ content: i.content, active_form: i.active_form, status: i.status }))
}

export function todoProgress(todos: TodoDraft[]) {
  return {
    done: todos.filter((t) => t.status === 'completed').length,
    total: todos.length,
    current: todos.find((t) => t.status === 'in_progress') ?? null,
  }
}

export function TodoStatusIcon({ status, className }: { status: TodoItemStatus; className?: string }) {
  const Icon = status === 'completed' ? SquareCheck : status === 'in_progress' ? SquareMinus : Square
  return (
    <Icon
      aria-hidden
      data-slot="todo-status-icon"
      data-status={status}
      className={cn(
        'size-3.5 shrink-0',
        status === 'completed' && 'text-success',
        status === 'in_progress' && 'text-info',
        status === 'pending' && 'text-muted',
        className,
      )}
    />
  )
}

export function TodoItemRow({ item, className }: { item: TodoDraft; className?: string }) {
  return (
    <div
      data-slot="todo-item"
      data-status={item.status}
      className={cn('flex items-start gap-2 text-xs', className)}
    >
      <TodoStatusIcon status={item.status} className="mt-px" />
      <span
        data-slot="todo-item-content"
        className={cn(
          'min-w-0 flex-1',
          item.status === 'completed' && 'text-muted line-through',
          item.status === 'in_progress' && 'font-medium text-foreground',
          item.status === 'pending' && 'text-muted',
        )}
      >
        {item.content}
      </span>
    </div>
  )
}

export function TodoItemList({ todos, className }: { todos: TodoDraft[]; className?: string }) {
  return (
    <div data-slot="todo-item-list" className={cn('flex flex-col gap-1.5', className)}>
      {todos.map((item, i) => (
        <TodoItemRow key={i} item={item} />
      ))}
    </div>
  )
}
