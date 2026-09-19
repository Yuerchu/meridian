import type { ComponentProps, Key, ReactNode } from 'react'
import { cx } from '@/utils/cx'

/**
 * Columns of cards, read-only. `Kanban.DragHandle` and `Kanban.DropIndicator`
 * are separate parts so a board without a way to move anything simply does
 * not render them — the todo board is one such.
 */

interface KanbanRootProps extends ComponentProps<'div'> {
  size?: 'sm' | 'md'
}

function KanbanRoot({ className, size = 'md', ...props }: KanbanRootProps) {
  return (
    <div
      data-slot="kanban"
      data-size={size}
      {...props}
      className={cx('group/kanban flex gap-3 overflow-x-auto', size === 'sm' && 'gap-2', className)}
    />
  )
}

function KanbanColumn({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="kanban-column"
      {...props}
      className={cx('flex min-w-0 flex-1 flex-col gap-2 rounded-2-5xl bg-background-secondary-default p-2', className)}
    />
  )
}

function KanbanColumnHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="kanban-column-header" {...props} className={cx('flex items-center gap-2 px-1 py-1', className)} />
  )
}

function KanbanColumnIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kanban-column-indicator" aria-hidden {...props} className={cx('flex shrink-0', className)} />
}

function KanbanColumnTitle({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="kanban-column-title"
      {...props}
      className={cx('text-body-medium text-text-primary group-data-[size=sm]/kanban:text-caption-1-medium', className)}
    />
  )
}

function KanbanColumnCount({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="kanban-column-count"
      {...props}
      className={cx(
        'ml-auto rounded-full bg-background-tertiary-default px-1.5 text-caption-1-medium text-text-secondary',
        className,
      )}
    />
  )
}

function KanbanColumnBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="kanban-column-body" {...props} className={cx('flex flex-col gap-1.5', className)} />
}

interface KanbanCardListProps extends ComponentProps<'ul'> {
  renderEmptyState?: () => ReactNode
}

function KanbanCardList({ className, children, renderEmptyState, ...props }: KanbanCardListProps) {
  if (!children && renderEmptyState) {
    return (
      <div data-slot="kanban-card-list-empty" className="px-2 py-3 text-caption-1-medium text-text-tertiary">
        {renderEmptyState()}
      </div>
    )
  }
  return (
    <ul data-slot="kanban-card-list" {...props} className={cx('flex list-none flex-col gap-1.5', className)}>
      {children}
    </ul>
  )
}

interface KanbanCardProps extends Omit<ComponentProps<'li'>, 'id'> {
  id?: Key
  textValue?: string
}

function KanbanCard({ className, id, textValue, ...props }: KanbanCardProps) {
  return (
    <li
      data-slot="kanban-card"
      data-key={id}
      aria-label={textValue}
      {...props}
      className={cx(
        'rounded-xl border border-border-button-default bg-background-primary-default p-2.5 text-body-regular shadow-xs group-data-[size=sm]/kanban:p-2',
        className,
      )}
    />
  )
}

function KanbanDragHandle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="kanban-drag-handle"
      {...props}
      className={cx('cursor-grab text-foreground-icon-secondary', className)}
    />
  )
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
