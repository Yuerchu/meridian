import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
  type Key,
  type Selection,
  type SortDescriptor,
} from 'react-aria-components'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DataGridColumn<T> {
  id?: string
  key?: string
  accessorKey?: string
  header?: ReactNode | (() => ReactNode)
  cell?: (item: T) => ReactNode
  width?: number
  minWidth?: number
  maxWidth?: number
  allowsSorting?: boolean
  isRowHeader?: boolean
  align?: 'start' | 'center' | 'end'
  cellClassName?: string
  headerClassName?: string
  sortFn?: (a: T, b: T) => number
  pinned?: 'start' | 'end'
}

export type DataGridSelection = Selection

interface DataGridProps<T extends object> {
  'aria-label'?: string
  columns?: DataGridColumn<T>[]
  items?: T[]
  data?: T[]
  getKey?: (item: T) => Key
  getRowId?: (item: T) => Key
  getChildren?: (item: T) => T[] | undefined
  treeColumn?: string
  selectionMode?: 'none' | 'single' | 'multiple'
  selectedKeys?: Selection
  onSelectionChange?: (keys: Selection) => void
  sortDescriptor?: SortDescriptor
  onSortChange?: (descriptor: SortDescriptor) => void
  renderEmptyState?: () => ReactNode
  showSelectionCheckboxes?: boolean
  variant?: string
  className?: string
  contentClassName?: string
  scrollContainerClassName?: string
  children?: ReactNode
}

function resolveColumnKey<T>(col: DataGridColumn<T>): string {
  return col.key ?? col.id ?? col.accessorKey ?? ''
}

export function DataGrid<T extends object>({
  'aria-label': ariaLabel,
  columns = [],
  items,
  data,
  getKey,
  getRowId,
  selectionMode = 'none',
  selectedKeys,
  onSelectionChange,
  sortDescriptor,
  onSortChange,
  renderEmptyState,
  className,
}: DataGridProps<T>) {
  const allItems = items ?? data ?? []
  const keyFn = getKey ?? getRowId

  return (
    <Table
      data-slot="data-grid"
      aria-label={ariaLabel}
      selectionMode={selectionMode === 'none' ? undefined : selectionMode}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      sortDescriptor={sortDescriptor}
      onSortChange={onSortChange}
      className={cn('w-full text-sm', className)}
    >
      <TableHeader>
        {columns.map((col) => {
          const key = resolveColumnKey(col)
          return (
            <Column
              key={key}
              id={key}
              isRowHeader={col.isRowHeader}
              allowsSorting={col.allowsSorting}
              width={col.width}
              minWidth={col.minWidth}
              maxWidth={col.maxWidth}
              className={cn(
                'border-b border-separator px-3 py-2 text-left text-xs font-medium text-muted',
                col.align === 'end' && 'text-right',
                col.align === 'center' && 'text-center',
                col.headerClassName,
              )}
            >
              {typeof col.header === 'function' ? col.header() : col.header}
            </Column>
          )
        })}
      </TableHeader>
      <TableBody items={allItems} renderEmptyState={renderEmptyState}>
        {(item) => (
          <Row
            key={keyFn?.(item) ?? (item as Record<string, Key>).id}
            id={keyFn?.(item) ?? (item as Record<string, Key>).id}
            className="border-b border-separator outline-none last:border-0 data-[selected]:bg-accent-soft data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-focus data-[hovered]:bg-default/50"
          >
            {columns.map((col) => {
              const key = resolveColumnKey(col)
              return (
                <Cell
                  key={key}
                  className={cn(
                    'px-3 py-2',
                    col.align === 'end' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.cellClassName,
                  )}
                >
                  {col.cell?.(item)}
                </Cell>
              )
            })}
          </Row>
        )}
      </TableBody>
    </Table>
  )
}
