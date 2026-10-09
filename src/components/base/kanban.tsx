import type { ComponentProps, ReactNode, Ref } from 'react'
import {
  Button as AriaButton,
  DropIndicator as AriaDropIndicator,
  DropZone as AriaDropZone,
  GridList,
  GridListItem,
  type DragAndDropHooks,
  type DropIndicatorProps as AriaDropIndicatorProps,
  type DropZoneProps as AriaDropZoneProps,
  type GridListItemProps,
  type Key,
} from 'react-aria-components'
import { GripVertical } from '@keyline-icons/react/two-tone'
import { cx } from '@/utils/cx'

/**
 * Columns of cards. A column's cards are a React Aria `GridList`, so a board
 * that can move cards passes `dragAndDropHooks` from its own `useDragAndDrop`
 * — one per column, since a hook cannot be called in a loop — and a board that
 * cannot (the todo board) passes nothing and gets a plain list. The moving
 * itself is the caller's: which drops are allowed and what a drop means differ
 * per board, and the base has no business knowing either.
 *
 * `DragHandle` is the keyboard's and the screen reader's way to pick a card
 * up (`slot="drag"`); `DropIndicator` is what `renderDropIndicator` returns;
 * `DropZone` takes drops where there is no list to drop between — an empty
 * column whose list is not drawn, a folded column.
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

interface KanbanCardListProps {
  /** Required: a column's list is named by its column, which React Aria cannot infer. */
  'aria-label': string
  children?: ReactNode
  renderEmptyState?: () => ReactNode
  dragAndDropHooks?: DragAndDropHooks
  className?: string
  ref?: Ref<HTMLDivElement>
}

function KanbanCardList({ className, renderEmptyState, dragAndDropHooks, ref, ...props }: KanbanCardListProps) {
  return (
    <GridList
      ref={ref}
      data-slot="kanban-card-list"
      selectionMode="none"
      // Tab, not the arrow keys, moves between the controls inside a card: a
      // card may hold a text field, and with 'arrow' its ← and → went to the
      // row instead of the caret.
      keyboardNavigationBehavior="tab"
      dragAndDropHooks={dragAndDropHooks}
      renderEmptyState={
        renderEmptyState
          ? () => (
              <div data-slot="kanban-card-list-empty" className="px-2 py-3 text-caption-1-medium text-text-secondary">
                {renderEmptyState()}
              </div>
            )
          : undefined
      }
      {...props}
      className={cx(
        'flex flex-col gap-1.5 rounded-xl outline-none',
        'data-[drop-target]:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    />
  )
}

interface KanbanCardProps extends Omit<GridListItemProps, 'className' | 'style' | 'children' | 'id' | 'textValue'> {
  id: Key
  /** What a screen reader and the keyboard's type-ahead read for the card. */
  textValue: string
  className?: string
  children?: ReactNode
  ref?: Ref<HTMLDivElement>
}

function KanbanCard({ className, children, ...props }: KanbanCardProps) {
  return (
    <GridListItem
      data-slot="kanban-card"
      {...props}
      className={cx(
        'rounded-xl border border-border-button-default bg-background-primary-default p-2.5 text-body-regular shadow-xs outline-none group-data-[size=sm]/kanban:p-2',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[dragging]:opacity-50',
        className,
      )}
    >
      {children}
    </GridListItem>
  )
}

interface KanbanDragHandleProps {
  /** Required: the handle is a grip glyph with no text of its own. */
  'aria-label': string
  className?: string
}

function KanbanDragHandle({ className, ...props }: KanbanDragHandleProps) {
  return (
    <AriaButton
      slot="drag"
      data-slot="kanban-drag-handle"
      {...props}
      className={cx(
        'flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-icon-secondary outline-none',
        'data-[hovered]:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      <GripVertical aria-hidden className="size-4" />
    </AriaButton>
  )
}

function KanbanDropIndicator({
  className,
  ...props
}: Omit<AriaDropIndicatorProps, 'className'> & { className?: string }) {
  return (
    <AriaDropIndicator
      data-slot="kanban-drop-indicator"
      {...props}
      className={cx('h-0.5 rounded-full bg-transparent data-[drop-target]:bg-accent-500', className)}
    />
  )
}

function KanbanDropZone({ className, ...props }: Omit<AriaDropZoneProps, 'className'> & { className?: string }) {
  return (
    <AriaDropZone
      data-slot="kanban-drop-zone"
      {...props}
      className={cx(
        'rounded-xl outline-none data-[drop-target]:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    />
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
  DropZone: KanbanDropZone,
})
