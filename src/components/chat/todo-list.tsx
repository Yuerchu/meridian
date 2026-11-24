import {
  ToolChecklist,
  ToolChecklistRow,
  ToolChecklistStatusIcon,
} from '@/components/yuerchu-ui/components/tool-views/tool-views'
import type { TodoItemInfoResponse, TodoItemStatus } from '@/types'

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
  return (
    typeof v.content === 'string' && typeof v.active_form === 'string' && STATUSES.includes(v.status as TodoItemStatus)
  )
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

export function toDrafts(items: TodoItemInfoResponse[]): TodoDraft[] {
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
  return <ToolChecklistStatusIcon status={status} className={className} />
}

export function TodoItemRow({ item, className }: { item: TodoDraft; className?: string }) {
  return <ToolChecklistRow item={item} className={className} />
}

export function TodoItemList({ todos, className }: { todos: TodoDraft[]; className?: string }) {
  return <ToolChecklist items={todos} className={className} />
}
