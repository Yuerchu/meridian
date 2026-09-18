import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/utils/cx'

interface KanbanRootProps extends ComponentProps<'div'> {
  size?: string
}

function KanbanRoot({ className, size: _size, ...props }: KanbanRootProps) {
  return <div data-slot="kanban" {...props} className={cx('flex gap-3 overflow-x-auto', className)} />
}

function KanbanColumn({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-column" {...props} className={cx('flex min-w-0 flex-1 flex-col gap-2', className)} />
}

function KanbanColumnHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="kanban-column-header" {...props} className={cx('flex items-center gap-2 px-1 py-1', className)} />
  )
}

function KanbanColumnIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-indicator" {...props} className={cx('flex shrink-0', className)} />
}

function KanbanColumnTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-title" {...props} className={cx('text-sm font-medium', className)} />
}

function KanbanColumnCount({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-count" {...props} className={cx('text-xs text-text-secondary', className)} />
}

function KanbanColumnBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-column-body" {...props} className={cx('flex flex-col gap-1.5', className)} />
}

interface KanbanCardListProps extends ComponentProps<'div'> {
  renderEmptyState?: () => ReactNode
}

function KanbanCardList({ className, children, renderEmptyState, ...props }: KanbanCardListProps) {
  if (!children && renderEmptyState) return <>{renderEmptyState()}</>
  return (
    <div data-slot="kanban-card-list" {...props} className={cx('flex flex-col gap-1.5', className)}>
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
      className={cx(
        'rounded-lg border border-border-button-default bg-background-primary-default p-2.5 shadow-xs',
        className,
      )}
    />
  )
}

function KanbanDragHandle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-drag-handle" {...props} className={cx('cursor-grab text-text-secondary', className)} />
}

function KanbanDropIndicator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="kanban-drop-indicator" {...props} className={cx('h-0.5 rounded-full bg-accent-500', className)} />
  )
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
