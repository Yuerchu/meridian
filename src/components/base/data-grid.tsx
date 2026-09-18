import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'
import {
  Button as AriaButton,
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
import { cx } from '@/utils/cx'
import { Checkbox } from './checkbox/checkbox'

/**
 * A data table on React Aria's `Table`, described by a column list rather
 * than composed by hand, because the three tables in the app (models,
 * stickers, usage) are all "here are the rows, here is what each column
 * shows".
 *
 * Two things the registry's `table` does not do and this app needs:
 *
 * - **Nested rows.** `getChildren` makes a row expandable, and the table
 *   becomes a `treegrid`: children are flattened into the row list under their
 *   parent with `aria-level` / `aria-expanded` / `aria-posinset`, and the
 *   `treeColumn` cell carries the expand button and the indent. RAC's `Table`
 *   has no tree of its own, so the flattening is done here and re-done when a
 *   parent opens.
 * - **A selection column.** `showSelectionCheckboxes` adds the checkbox column
 *   RAC wires up through `slot="selection"`.
 *
 * Sorting is client-side through a column's `sortFn` unless the caller holds
 * the `sortDescriptor` itself.
 */

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
  /** Sticks the column to an edge while the rest scrolls horizontally. */
  pinned?: 'start' | 'end'
}

const pinnedClass = { start: 'sticky left-0 z-10 bg-inherit', end: 'sticky right-0 z-10 bg-inherit' } as const

export type DataGridSelection = Selection

export interface DataGridProps<T extends object> {
  'aria-label'?: string
  columns?: DataGridColumn<T>[]
  items?: T[]
  data?: T[]
  getKey?: (item: T) => Key
  getRowId?: (item: T) => Key
  getChildren?: (item: T) => T[] | undefined
  /** Which column carries the expand button and indent. Defaults to the row header. */
  treeColumn?: string
  selectionMode?: 'none' | 'single' | 'multiple'
  selectedKeys?: Selection
  onSelectionChange?: (keys: Selection) => void
  showSelectionCheckboxes?: boolean
  sortDescriptor?: SortDescriptor
  onSortChange?: (descriptor: SortDescriptor) => void
  renderEmptyState?: () => ReactNode
  variant?: 'primary' | 'secondary'
  className?: string
  /** Classes on the table itself — a `min-w-*` that forces horizontal scroll. */
  contentClassName?: string
  /** Classes on the scroll container around the table. */
  scrollContainerClassName?: string
}

function columnKey<T>(col: DataGridColumn<T>): string {
  return col.key ?? col.id ?? col.accessorKey ?? ''
}

interface FlatRow<T> {
  item: T
  key: Key
  level: number
  hasChildren: boolean
  expanded: boolean
  setSize: number
  posInSet: number
}

export function DataGrid<T extends object>({
  'aria-label': ariaLabel,
  columns = [],
  items,
  data,
  getKey,
  getRowId,
  getChildren,
  treeColumn,
  selectionMode = 'none',
  selectedKeys,
  onSelectionChange,
  showSelectionCheckboxes = false,
  sortDescriptor: controlledSort,
  onSortChange,
  renderEmptyState,
  variant = 'primary',
  className,
  contentClassName,
  scrollContainerClassName,
}: DataGridProps<T>) {
  const { t } = useTranslation()
  const tableRef = useRef<HTMLTableElement>(null)
  const keyOf = (item: T): Key => (getKey ?? getRowId)?.(item) ?? (item as { id: Key }).id
  const [uncontrolledSort, setUncontrolledSort] = useState<SortDescriptor | undefined>()
  const sortDescriptor = controlledSort ?? uncontrolledSort
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(() => new Set())

  const treeKey = treeColumn ?? columns.find((c) => c.isRowHeader)?.id ?? columnKey(columns[0] ?? {})
  const isTree = typeof getChildren === 'function'

  const rows = useMemo<FlatRow<T>[]>(() => {
    const source = items ?? data ?? []
    const sortCol = sortDescriptor && columns.find((c) => columnKey(c) === sortDescriptor.column)
    const sorted = (list: T[]) => {
      if (!sortCol?.sortFn) return list
      const out = [...list].sort(sortCol.sortFn)
      return sortDescriptor?.direction === 'descending' ? out.reverse() : out
    }
    const out: FlatRow<T>[] = []
    const walk = (list: T[], level: number) => {
      const ordered = sorted(list)
      ordered.forEach((item, i) => {
        const key = keyOf(item)
        const children = getChildren?.(item)
        const hasChildren = !!children && children.length > 0
        const expanded = hasChildren && expandedKeys.has(key)
        out.push({ item, key, level, hasChildren, expanded, setSize: ordered.length, posInSet: i + 1 })
        if (expanded && children) walk(children, level + 1)
      })
    }
    walk(source, 1)
    return out
    // keyOf is stable per props; the callbacks it closes over are in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, data, columns, sortDescriptor, getChildren, expandedKeys, getKey, getRowId])

  const toggle = (key: Key) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const selectable = selectionMode !== 'none'

  // RAC renders `role="grid"` and its prop type has no `role`; a table whose
  // rows nest is a treegrid to a screen reader, so the role is written to the
  // element after render. React leaves an attribute alone while its prop is
  // unchanged, so the value holds until the tree-ness changes.
  useEffect(() => {
    tableRef.current?.setAttribute('role', isTree ? 'treegrid' : 'grid')
  }, [isTree])

  return (
    <div
      data-slot="data-grid-scroll"
      data-variant={variant}
      className={cx(
        'w-full overflow-x-auto rounded-2xl border border-border-button-default',
        variant === 'secondary' ? 'bg-background-secondary-default' : 'bg-background-primary-default',
        scrollContainerClassName,
        className,
      )}
    >
      <Table
        data-slot="data-grid"
        ref={tableRef}
        aria-label={ariaLabel}
        selectionMode={selectable ? selectionMode : undefined}
        selectionBehavior={showSelectionCheckboxes ? 'toggle' : undefined}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        sortDescriptor={sortDescriptor}
        onSortChange={(d) => {
          setUncontrolledSort(d)
          onSortChange?.(d)
        }}
        className={cx('w-full border-separate border-spacing-0 text-body-regular', contentClassName)}
      >
        <TableHeader>
          {showSelectionCheckboxes && selectable && (
            <Column id="__selection" width={40} className="border-b border-border-button-default px-3 py-2">
              {selectionMode === 'multiple' && <Checkbox slot="selection" size="sm" />}
            </Column>
          )}
          {columns.map((col) => {
            const key = columnKey(col)
            return (
              <Column
                key={key}
                id={key}
                isRowHeader={col.isRowHeader}
                allowsSorting={col.allowsSorting}
                width={col.width}
                minWidth={col.minWidth}
                maxWidth={col.maxWidth}
                className={cx(
                  'border-b border-border-button-default px-3 py-2 text-left text-caption-1-medium text-text-secondary outline-none',
                  'data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
                  col.align === 'end' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.pinned && pinnedClass[col.pinned],
                  col.headerClassName,
                )}
              >
                {({ sortDirection, allowsSorting }) => (
                  <span className="inline-flex items-center gap-1">
                    {typeof col.header === 'function' ? col.header() : col.header}
                    {allowsSorting && (
                      <RiArrowRightSLine
                        aria-hidden
                        className={cx(
                          'size-3.5 transition-transform',
                          sortDirection === 'ascending' && '-rotate-90',
                          sortDirection === 'descending' && 'rotate-90',
                          !sortDirection && 'opacity-0',
                        )}
                      />
                    )}
                  </span>
                )}
              </Column>
            )
          })}
        </TableHeader>
        <TableBody
          items={rows}
          renderEmptyState={renderEmptyState}
          className="[&_[role=row]:last-child_[role=gridcell]]:border-b-0 [&_[role=row]:last-child_[role=rowheader]]:border-b-0"
        >
          {(row) => (
            <Row
              key={row.key}
              id={row.key}
              aria-level={isTree ? row.level : undefined}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-setsize={isTree ? row.setSize : undefined}
              aria-posinset={isTree ? row.posInSet : undefined}
              className={cx(
                'outline-none',
                'data-[hovered]:bg-background-primary-hover data-[selected]:bg-button-ghost-background',
                'data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
              )}
            >
              {showSelectionCheckboxes && selectable && (
                <Cell className="border-b border-border-button-default px-3 py-2">
                  <Checkbox slot="selection" size="sm" />
                </Cell>
              )}
              {columns.map((col) => {
                const key = columnKey(col)
                const isTreeCell = isTree && key === treeKey
                return (
                  <Cell
                    key={key}
                    className={cx(
                      'border-b border-border-button-default px-3 py-2 text-text-primary outline-none',
                      'data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
                      col.align === 'end' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.pinned && pinnedClass[col.pinned],
                      col.cellClassName,
                    )}
                  >
                    {isTreeCell ? (
                      <span
                        className="flex min-w-0 items-center gap-1"
                        style={{ paddingInlineStart: `${(row.level - 1) * 1.25}rem` }}
                      >
                        {row.hasChildren ? (
                          // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- named per row by aria-label; one tooltip per row is noise
                          <AriaButton
                            data-slot="data-grid-expand"
                            aria-label={t(row.expanded ? 'dataGrid.collapseRow' : 'dataGrid.expandRow', {
                              label: rowLabel(row.item, columns, treeKey),
                            })}
                            onPress={() => toggle(row.key)}
                            className="flex size-5 shrink-0 cursor-[var(--cursor-interactive)] items-center justify-center rounded-md text-foreground-icon-secondary outline-none data-[hovered]:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring"
                          >
                            <RiArrowRightSLine
                              aria-hidden
                              className={cx('size-4 transition-transform duration-150', row.expanded && 'rotate-90')}
                            />
                          </AriaButton>
                        ) : (
                          <span aria-hidden className="size-5 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">{col.cell?.(row.item)}</span>
                      </span>
                    ) : (
                      col.cell?.(row.item)
                    )}
                  </Cell>
                )
              })}
            </Row>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** Best-effort text for the expand button's name: the row's own label cell if it is a string. */
function rowLabel<T>(item: T, columns: DataGridColumn<T>[], treeKey: string): string {
  const col = columns.find((c) => columnKey(c) === treeKey)
  const value = col?.cell?.(item)
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  const raw = (item as Record<string, unknown>)[treeKey] ?? (item as Record<string, unknown>).label
  return typeof raw === 'string' ? raw : ''
}
