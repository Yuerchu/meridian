"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnProps, Key, Selection, SortDescriptor } from "react-aria-components";
import { useCollator, useIsSSR, VisuallyHidden } from "react-aria";
import { Collection, TableLayout, TableLoadMoreItem, Virtualizer } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { CircleAlertIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { Checkbox } from "../checkbox/checkbox";
import { Pagination } from "../pagination/pagination";
import { useLoadingPhase } from "../reveal/reveal";
import { Skeleton } from "../skeleton/skeleton";
import { Spinner } from "../spinner/spinner";
import { SelectionBar } from "../selection-bar/selection-bar";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../table/table";
import type { InlineEditOption } from "../inline-edit/inline-edit";
import { InlineEdit } from "../inline-edit/inline-edit";
import { dataTableStrings } from "./data-table.strings";
import "./data-table.css";

/**
 * 提供内置排序、跨页行选择、分页、虚拟滚动、列宽调整与行内编辑能力的数据表格。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

type ColumnSize = ColumnProps["width"];

export interface DataTableEditable<T> {
  /** 用于编辑的字符串值；未提供时默认读取 `row[id]`。 */
  getValue?: (row: T) => string;
  /** 保存回调；支持返回 Promise，等待期间显示加载指示，失败时保留编辑态并提示错误。 */
  onCommit: (row: T, value: string) => void | Promise<void>;
  /** 输入校验函数，返回错误文案表示校验不通过。 */
  validate?: (value: string, row: T) => string | null | undefined;
  /**
   * 编辑器类型，与 InlineEdit 的 type 一致。
   * @default "text"
   */
  type?: "text" | "number" | "select";
  /** type 为 select 时的可选项列表。 */
  options?: InlineEditOption[];
  /** type 为 number 时的数字格式化选项。 */
  formatOptions?: Intl.NumberFormatOptions;
  /** type 为 number 时的最小值。 */
  minValue?: number;
  /** type 为 number 时的最大值。 */
  maxValue?: number;
  /** 编辑器字段名称（读屏播报如“编辑 状态”）；未提供时回退为文本列标题或列 id。 */
  label?: string;
}

export interface DataTableColumn<T> {
  /** 列的唯一标识；未提供 `cell` 时直接展示 `row[id]`。 */
  id: string;
  /** 列标题内容。 */
  header: ReactNode;
  /** 自定义单元格渲染函数。 */
  cell?: (row: T) => ReactNode;
  /** 提取排序值；传入后该列支持排序，字符串按当前语言习惯与自然数字顺序比较（如“文件2”排在“文件10”之前）。 */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  /** 是否作为行标题列（读屏导航单元格时会附带播报）；每张表应指定一列。 */
  isRowHeader?: boolean;
  /** 单元格对齐方式；数字、金额与时间列建议使用 `"end"`。 */
  align?: "start" | "end";
  /** 列宽（如 200、`"1fr"`）；在虚拟滚动模式下生效，在可调列宽模式下作为初始宽度。 */
  width?: ColumnSize;
  /** 可调列宽时的最小宽度（像素），默认 75。 */
  minWidth?: number;
  /** 可调列宽时的最大宽度（像素）。 */
  maxWidth?: number;
  /**
   * 启用 `allowsColumnResizing` 时该列是否允许调整宽度。
   * @default true
   */
  allowsResizing?: boolean;
  /**
   * 行内编辑配置（基于 InlineEdit）；若同时提供了 `cell`，非编辑态仍按 `cell` 渲染。
   */
  editable?: DataTableEditable<T>;
}

export interface DataTableProps<T extends object> {
  /** 表格的可访问名称（必填）。 */
  "aria-label": string;
  /** 列配置数组。 */
  columns: DataTableColumn<T>[];
  /** 表格行数据数组。 */
  rows: T[];
  /** 提取每行的唯一标识，默认读取 `row.id`。 */
  getRowId?: (row: T) => Key;
  /**
   * 行高尺寸，与 Table 一致。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 行选择模式；设置为 `"multiple"` 时首列显示勾选框，表头勾选框全选当前页。 */
  selectionMode?: "none" | "single" | "multiple";
  /** 受控的已选行键集合。 */
  selectedKeys?: Iterable<Key>;
  /** 非受控模式下默认选中的行键集合。 */
  defaultSelectedKeys?: Iterable<Key>;
  /** 选中行变化时触发，参数包含跨页的全部已选行键。 */
  onSelectionChange?: (keys: Set<Key>) => void;
  /** 非受控模式下的默认排序状态。 */
  defaultSortDescriptor?: SortDescriptor;
  /**
   * 排序变化回调；传入后交由外部排序（如服务端排序），组件仅更新表头指示箭头并原样渲染 `rows`。
   */
  onSortChange?: (descriptor: SortDescriptor) => void;
  /** 受控模式下的当前排序状态。 */
  sortDescriptor?: SortDescriptor;
  /** 每页显示的行数；传入后在底部展示分页条，不可与 `virtualized` 同时启用。 */
  pageSize?: number;
  /** 虚拟滚动配置，指定表格视口高度（像素）；不可与 `pageSize` 同时启用。 */
  virtualized?: { height: number };
  /** 点击或按回车激活整行时触发。 */
  onRowAction?: (key: Key) => void;
  /** 自定义空状态内容，默认显示“没有数据”。 */
  renderEmptyState?: () => ReactNode;
  /**
   * 是否处于加载中状态；尚无数据时显示骨架占位，已有数据时在底部提示“正在加载”，外层带有 `aria-busy`。
   * 配合 `onLoadMore` 使用时表示正在加载更多数据。
   */
  isLoading?: boolean;
  /** 加载失败提示信息；传入后会替换数据区并显示错误说明。 */
  error?: string;
  /** 点击错误状态中的“重试”按钮时触发。 */
  onRetry?: () => void;
  /** 滚动到底部时触发的增量加载回调；需配合 `virtualized` 或 `maxHeight` 使用。 */
  onLoadMore?: () => void;
  /** 表格最大高度（像素）；超出后内部纵向滚动并固定表头。 */
  maxHeight?: number;
  /** 横向滚动时是否将首列固定在左侧（容器过窄时自动取消固定）；不支持与 `virtualized` 同时使用。 */
  stickyFirstColumn?: boolean;
  /**
   * 批量操作区渲染函数；仅在 `selectionMode="multiple"` 时生效，选中行后在表格上方展示操作栏与“清除选择”按钮。
   */
  bulkActions?: (selectedRows: T[]) => ReactNode;
  /**
   * 是否允许通过拖拽表头边缘、双击自适应或键盘 `Alt + ←/→` 调整列宽。
   */
  allowsColumnResizing?: boolean;
  /**
   * 列宽调整结束时触发，参数为各列 id 对应的宽度映射。
   */
  onColumnResizeEnd?: (widths: Record<string, number | string>) => void;
}

// 文字按 UIProvider 的语言排序（useCollator），不写死 zh-CN
function compare(a: unknown, b: unknown, collator: Intl.Collator) {
  // 空值排在最后（不论升序降序，由调用方处理方向前先比较）
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

function sortRows<T extends object>(rows: T[], columns: DataTableColumn<T>[], sort: SortDescriptor | undefined, collator: Intl.Collator) {
  const column = sort && columns.find((c) => c.id === sort.column);
  if (!sort || !column?.sortValue) return rows;
  const value = column.sortValue;
  const dir = sort.direction === "descending" ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);
    // 空值永远在最后
    if (a == null || b == null) return compare(a, b, collator);
    return compare(a, b, collator) * dir;
  });
}

const defaultRowId = (row: unknown) => (row as { id: Key }).id;

/**
 * 渲染支持排序、行选择、分页、虚拟滚动、列宽调整及行内编辑的数据表格。
 */
export function DataTable<T extends object>({
  "aria-label": ariaLabel,
  columns,
  rows,
  getRowId = defaultRowId,
  size = "md",
  selectionMode = "none",
  selectedKeys,
  defaultSelectedKeys,
  onSelectionChange,
  defaultSortDescriptor,
  onSortChange,
  sortDescriptor,
  pageSize,
  virtualized,
  onRowAction,
  renderEmptyState,
  isLoading = false,
  error,
  onRetry,
  onLoadMore,
  maxHeight,
  stickyFirstColumn = false,
  bulkActions,
  allowsColumnResizing = false,
  onColumnResizeEnd,
}: DataTableProps<T>) {
  const t = useStrings(dataTableStrings);
  // 虚拟滚动在服务端不知道视口多大：服务端只放一个同样高的占位，挂载后再建表（否则水合时整张表要重做一遍）
  const isSSR = useIsSSR();
  const [ownSort, setOwnSort] = useState<SortDescriptor | undefined>(defaultSortDescriptor);
  const sort = sortDescriptor ?? ownSort;
  const [page, setPage] = useState(1);
  const [ownSelection, setOwnSelection] = useState<Set<Key>>(() => new Set(defaultSelectedKeys));
  // 已经不在 rows 里的行（被删掉了）不算选中：数量、批量操作、onSelectionChange 都只看还在的行
  const rowIds = useMemo(() => new Set(rows.map(getRowId)), [rows, getRowId]);
  const selection = new Set([...(selectedKeys ?? ownSelection)].filter((k) => rowIds.has(k)));
  const tableRef = useRef<HTMLTableElement>(null);

  // 使用方排序（写了 onSortChange）时 rows 原样显示
  const collator = useCollator({ numeric: true, sensitivity: "base" });
  const sorted = useMemo(() => (onSortChange ? rows : sortRows(rows, columns, sort, collator)), [rows, columns, sort, onSortChange, collator]);
  const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const currentPage = Math.min(page, totalPages);
  const visible = error ? [] : pageSize ? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize) : sorted;

  // 出错是加载之后才出现的：主动读出来（表格里的空状态读屏不会自己读）
  useEffect(() => {
    if (error) announce(error, "assertive");
  }, [error]);

  const handleSort = (descriptor: SortDescriptor) => {
    setPage(1);
    if (onSortChange) onSortChange(descriptor);
    else setOwnSort(descriptor);
  };

  const setSelection = (next: Set<Key>) => {
    if (!selectedKeys) setOwnSelection(next);
    onSelectionChange?.(next);
  };

  // React Aria 只知道当前页的行："全选""清空"只作用于当前页，其他页选中的保留
  const handleSelection = (keys: Selection) => {
    const pageKeys = new Set(visible.map(getRowId));
    const next = new Set([...selection].filter((k) => !pageKeys.has(k)));
    for (const k of keys === "all" ? pageKeys : keys) if (pageKeys.has(k) || selectionMode === "single") next.add(k);
    if (selectionMode === "single") {
      const last = keys === "all" ? undefined : [...keys][0];
      setSelection(new Set<Key>(last === undefined ? [] : [last]));
      return;
    }
    setSelection(next);
  };

  const isMultiple = selectionMode === "multiple";
  const skeletonRows = Math.min(pageSize ?? 5, 8);
  const { phase: loadingPhase } = useLoadingPhase(isLoading);
  const emptyState = error
    ? () => (
        <div className="ui-data-table__error">
          <span className="ui-data-table__error-icon" aria-hidden="true">
            <CircleAlertIcon />
          </span>
          <span>{error}</span>
          {onRetry ? (
            <Button variant="secondary" size="sm" onPress={onRetry}>
              {t.retry}
            </Button>
          ) : null}
        </div>
      )
    : isLoading
      ? () => (
          // 等待阶段占住位置但看不见：很快就加载完时不闪一下（同 Reveal 的时机）
          <div className="ui-data-table__skeleton" data-waiting={loadingPhase === "waiting" || undefined}>
            {/* 骨架对读屏隐藏，读屏读这一句 */}
            <VisuallyHidden>{t.loading}</VisuallyHidden>
            {Array.from({ length: skeletonRows }, (_, i) => (
              <Skeleton key={i} width={i % 3 === 2 ? "60%" : undefined} />
            ))}
          </div>
        )
      : renderEmptyState;
  const table = (
    <Table
      ref={tableRef}
      aria-label={ariaLabel}
      maxHeight={virtualized ? undefined : maxHeight}
      stickyFirstColumn={virtualized ? false : stickyFirstColumn}
      size={size}
      selectionMode={selectionMode}
      selectedKeys={selection}
      onSelectionChange={handleSelection}
      sortDescriptor={sort}
      onSortChange={handleSort}
      onRowAction={onRowAction}
      className={virtualized ? "ui-data-table__virtual" : undefined}
      style={virtualized ? { height: virtualized.height } : undefined}
      allowsColumnResizing={allowsColumnResizing}
      onColumnResizeEnd={
        onColumnResizeEnd
          ? (widths) => onColumnResizeEnd(Object.fromEntries(columns.filter((c) => widths.has(c.id)).map((c) => [c.id, widths.get(c.id)!])))
          : undefined
      }
    >
      <TableHeader>
        {isMultiple ? (
          <Column width={44} className="ui-data-table__select">
            <Checkbox slot="selection" />
          </Column>
        ) : null}
        {columns.map((c) => (
          <Column
            key={c.id}
            id={c.id}
            isRowHeader={c.isRowHeader}
            allowsSorting={Boolean(c.sortValue)}
            allowsResizing={allowsColumnResizing && c.allowsResizing !== false}
            // 可调列宽时 width 只是初始宽度，之后由拖动决定
            {...(allowsColumnResizing ? { defaultWidth: c.width, minWidth: c.minWidth, maxWidth: c.maxWidth } : { width: c.width })}
            data-align={c.align}
          >
            {c.header}
          </Column>
        ))}
      </TableHeader>
      <TableBody renderEmptyState={emptyState}>
        <Collection items={visible} dependencies={[columns]}>
          {(row) => (
            <Row id={getRowId(row)}>
              {isMultiple ? (
                <Cell className="ui-data-table__select">
                  <Checkbox slot="selection" />
                </Cell>
              ) : null}
              {columns.map((c) => (
                <Cell key={c.id} data-align={c.align}>
                  {c.editable ? (
                    <EditableCell row={row} column={c} editable={c.editable} />
                  ) : c.cell ? (
                    c.cell(row)
                  ) : (
                    String((row as Record<string, unknown>)[c.id] ?? "")
                  )}
                </Cell>
              ))}
            </Row>
          )}
        </Collection>
        {onLoadMore && visible.length > 0 ? (
          <TableLoadMoreItem onLoadMore={onLoadMore} isLoading={isLoading} className="ui-data-table__load-more">
            <Spinner size="sm" aria-label={t.loadingMore} />
          </TableLoadMoreItem>
        ) : null}
      </TableBody>
    </Table>
  );

  const selectedCount = selection.size;
  const showBulk = Boolean(bulkActions) && isMultiple;
  const selectedRows = showBulk && selectedCount ? rows.filter((r) => selection.has(getRowId(r))) : [];
  const busyWithRows = isLoading && !onLoadMore && visible.length > 0;
  // 首次加载、出错时还没有可数的行：不显示"共 0 条"
  const showStatus = visible.length > 0 || (!isLoading && !error);
  return (
    // React Aria 的 Table 不往 DOM 上传 aria-busy：写在外层
    <div className="ui-data-table" data-size={size} aria-busy={isLoading || undefined}>
      {/* 批量操作栏的位置一直留着（没选时是一行提示）：选中第一行时表格不会往下跳 */}
      {showBulk ? (
        <div className="ui-data-table__bulk-slot">
          {!selectedCount ? <div className="ui-data-table__bulk-hint">{t.bulkHint}</div> : null}
          <SelectionBar
            placement="inline"
            selectedCount={selectedCount}
            onClear={() => {
              setSelection(new Set());
              // 操作栏会换回提示，焦点回到表格
              tableRef.current?.focus();
            }}
            getFocusTarget={() => tableRef.current}
          >
            {selectedCount ? bulkActions!(selectedRows) : null}
          </SelectionBar>
        </div>
      ) : null}
      {virtualized && isSSR ? (
        <div className="ui-data-table__placeholder" style={{ height: virtualized.height }} aria-busy="true" />
      ) : virtualized ? (
        <Virtualizer layout={TableLayout} layoutOptions={{ rowHeight: size === "sm" ? 32 : 40, headingHeight: size === "sm" ? 32 : 40 }}>
          {table}
        </Virtualizer>
      ) : (
        table
      )}
      {(pageSize || isMultiple || busyWithRows) && showStatus ? (
        <div className="ui-data-table__footer">
          <span className="ui-data-table__status" aria-live="polite">
            {busyWithRows ? (
              <span aria-hidden="true">
                <Spinner size="sm" />
              </span>
            ) : null}
            {busyWithRows ? t.loadingPrefix : ""}
            {isMultiple && !showBulk && selectedCount ? t.selectedPrefix({ count: selectedCount }) : ""}
            {t.total({ count: rows.length })}
          </span>
          {pageSize && totalPages > 1 ? (
            <Pagination aria-label={t.pagination({ table: ariaLabel })} page={currentPage} totalPages={totalPages} onChange={setPage} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 可编辑的单元格：InlineEdit，不在编辑时显示列的 cell */
function EditableCell<T>({ row, column, editable }: { row: T; column: DataTableColumn<T>; editable: DataTableEditable<T> }) {
  const value = editable.getValue ? editable.getValue(row) : String((row as Record<string, unknown>)[column.id] ?? "");
  return (
    <InlineEdit
      aria-label={editable.label ?? (typeof column.header === "string" ? column.header : column.id)}
      size="sm"
      value={value}
      onCommit={(v) => editable.onCommit(row, v)}
      validate={editable.validate ? (v) => editable.validate!(v, row) : undefined}
      renderValue={column.cell ? () => column.cell!(row) : undefined}
      type={editable.type}
      options={editable.options}
      formatOptions={editable.formatOptions}
      minValue={editable.minValue}
      maxValue={editable.maxValue}
    />
  );
}
