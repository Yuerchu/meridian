import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface KanbanRootProps extends ComponentProps<'div'> {
  size?: string
}

function KanbanRoot({ className, size: _size, ...props }: KanbanRootProps) {
  return <div data-slot="kanban" {...props} className={cn('flex gap-3 overflow-x-auto', className)} />
}

function KanbanColumn({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-column" {...props} className={cn('flex min-w-0 flex-1 flex-col gap-2', className)} />
}

function KanbanColumnHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="kanban-column-header" {...props} className={cn('flex items-center gap-2 px-1 py-1', className)} />
  )
}

function KanbanColumnIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-indicator" {...props} className={cn('flex shrink-0', className)} />
}

function KanbanColumnTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-title" {...props} className={cn('text-sm font-medium', className)} />
}

function KanbanColumnCount({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-count" {...props} className={cn('text-xs text-muted', className)} />
}

function KanbanColumnBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-column-body" {...props} className={cn('flex flex-col gap-1.5', className)} />
}

interface KanbanCardListProps extends ComponentProps<'div'> {
  renderEmptyState?: () => ReactNode
}

function KanbanCardList({ className, children, renderEmptyState, ...props }: KanbanCardListProps) {
  if (!children && renderEmptyState) return <>{renderEmptyState()}</>
  return (
    <div data-slot="kanban-card-list" {...props} className={cn('flex flex-col gap-1.5', className)}>
      {children}
    </div>
  )
}

interface KanbanCardProps extends Omit<ComponentProps<'div'>, 'id'> {
  id?: string | number
  textValue?: string
}

function KanbanCard({ className, id: _id, textValue: _textValue, ...props }: KanbanCardProps) {
  return (
    <div
      data-slot="kanban-card"
      {...props}
      className={cn('rounded-lg border border-border bg-surface p-2.5 shadow-surface', className)}
    />
  )
}

function KanbanDragHandle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-drag-handle" {...props} className={cn('cursor-grab text-muted', className)} />
}

function KanbanDropIndicator({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-drop-indicator" {...props} className={cn('h-0.5 rounded-full bg-accent', className)} />
}

export const Kanban = Object.assign(KanbanRoot, {
  Column: KanbanColumn,
  ColumnHeader: KanbanColumnHeader,
  ColumnIndicator: KanbanColumnIndicator,
  ColumnTitle: KanbanColumnTitle,
  ColumnCount: KanbanColumnCount,
  ColumnBody: KanbanColumnBody,
  CardList: KanbanCardList,
  Card: KanbanCard,
  DragHandle: KanbanDragHandle,
  DropIndicator: KanbanDropIndicator,
})
