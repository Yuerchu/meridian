"use client";

import type { ReactNode, Ref } from "react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CellProps as AriaCellProps,
  ColumnProps as AriaColumnProps,
  RowProps as AriaRowProps,
  TableBodyProps as AriaTableBodyProps,
  TableHeaderProps as AriaTableHeaderProps,
  Key,
  TableProps as AriaTableProps,
} from "react-aria-components";
import {
  Cell as AriaCell,
  Column as AriaColumn,
  ColumnResizer,
  ResizableTableContainer,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableColumnResizeStateContext,
  TableHeader as AriaTableHeader,
  useLocale,
} from "react-aria-components";
import { VisuallyHidden } from "react-aria";
import { useStrings } from "../../lib/i18n";
import { withUiClass } from "../../lib/class-name";
import { keyOfItem, useMarqueeSelection, useOwnedSelection } from "../../lib/marquee-selection";
import { ChevronDownIcon, ChevronUpIcon } from "../../lib/icons";
import { ResizeGrip, useGripDirection } from "../resizable-panels/resize-grip";
import { type LoadingPhase, useLoadingPhase } from "../reveal/reveal";
import { Skeleton } from "../skeleton/skeleton";
import "../resizable-panels/resizable-panels.css";
import { tableStrings } from "./table.strings";
import "./table.css";

/**
 * 按行列展示结构化数据，支持按列排序、调整列宽及多行框选。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface TableProps extends Omit<AriaTableProps, "children"> {
  /** 表格头部（`TableHeader`）与表体（`TableBody`）。 */
  children?: ReactNode;
  /**
   * 表格行高规格；`sm`（32px）适合高密度数据展示，`md`（40px）为默认行高。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 最大高度（px）；超出后在容器内部纵向滚动并固定表头。 */
  maxHeight?: number;
  /** 指向底层 `<table>` 元素的引用。 */
  ref?: Ref<HTMLTableElement>;
  /**
   * 是否允许调整列宽；开启后，设置了 `allowsResizing` 与 `id` 的列表头右边缘可拖动。表格总宽为各列之和，超出容器时横向滚动，未指定宽度的列平分剩余空间。
   */
  allowsColumnResizing?: boolean;
  /** 列宽调整结束（释放指针、键盘按 `Enter` 或双击自动适配）时的回调，返回全部列的当前宽度以便持久化并在下次作为 `defaultWidth` 传入。 */
  onColumnResizeEnd?: (widths: Map<Key, ColumnSize>) => void;
  /**
   * 横向滚动时是否将首列固定在起始侧（若前置了多选勾选列则一并固定）；当容器宽度不足以容纳固定列加 96px 时自动取消固定，避免小屏下遮挡内容区。
   */
  stickyFirstColumn?: boolean;
  /**
   * 是否处于加载状态；开启后表头保持显示，若表体暂无数据行则呈现占位骨架并在容器上标记 `aria-busy`，若已有数据行则保留原有内容。
   */
  isLoading?: boolean;
  /**
   * 空表体加载时绘制的占位骨架行数，建议传入上次数据行数或分页大小以贴近真实高度。
   * @default 3
   */
  loadingRowCount?: number;
  /**
   * 加载中提供给读屏的说明文字。
   * @default "正在加载"（英文界面 "Loading"）
   */
  loadingLabel?: string;
  /**
   * 是否开启鼠标框选；在 `selectionMode="multiple"` 时，可从表格下方空白区域或行内非交互区域拖拽矩形选中多行，按住 `Ctrl` / `⌘` / `Shift` 可追加选中。拖至边缘时自动滚动，按 `Esc` 取消。
   */
  allowsMarqueeSelection?: boolean;
}

/** TableBody 把 items 交给 Table（框选要知道全部行的顺序，虚拟滚动时 DOM 里只有一部分） */
const BodyItemsContext = createContext<{ current: Iterable<object> | undefined } | null>(null);

type ColumnSize = NonNullable<AriaColumnProps["width"]>;

/**
 * 列宽由 Table 自己保存（受控），每列从这里取 width 传给 React Aria。这样调整过程中可以一起改相邻的列（Shift），
 * 按 Esc 时把开始时的宽度整个换回去。React Aria 非受控时会把调整列左边的列冻结、并用自己的状态覆盖我们写的宽度，做不到这两件事。
 */
interface ResizeControl {
  /** 当前的列宽（还没调整过时是 null：各列用自己的 defaultWidth） */
  widths: Map<Key, ColumnSize> | null;
  /** 调整手柄登记列宽状态：调整开始的那一刻要从它取各列的像素宽度 */
  register: (layout: ResizeLayout) => void;
  /** 一次调整开始后，告诉 Table 是哪一列在调整 */
  begin: (key: Key) => void;
  /** 直接定下一组宽度并结束（双击自动调整） */
  apply: (widths: Map<Key, ColumnSize>) => void;
  /** 这一列的调整是从表头用键盘（Alt + ←/→）开始的：结束时要把焦点还给表头（见 ReturnFocus） */
  markFromHeader: (key: Key) => void;
  /** 结束时问一次：是不是从表头开始的（问完就清掉） */
  takeFromHeader: (key: Key) => boolean;
}

type ResizeLayout = NonNullable<React.ContextType<typeof TableColumnResizeStateContext>>;

const ResizeControlContext = createContext<ResizeControl | null>(null);

/**
 * 受控列宽和一次调整的过程：
 * - 按住 Shift（拖动时或键盘调整时）：只和右边相邻的列互相借宽度，其他列钉在开始时的宽度，总宽不变；邻列到最小 / 最大宽度就不再借
 * - Esc：取消，所有列回到开始时的宽度。键盘调整时 React Aria 收到 Esc 会结束调整；拖动时它不管 Esc，补一个 pointercancel 让拖动停下
 */
function useResizeControl(onEnd?: (widths: Map<Key, ColumnSize>) => void) {
  const [widths, setWidths] = useState<Map<Key, ColumnSize> | null>(null);
  const latest = useRef(widths);
  latest.current = widths;
  const session = useRef<{ key: Key | null; start: Map<Key, number>; cancelled: boolean } | null>(null);
  const layoutRef = useRef<ResizeLayout | null>(null);
  const shift = useRef(false);
  const pointerId = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      if (e.type !== "keydown" || e.key !== "Escape" || !session.current) return;
      session.current.cancelled = true;
      // 拖动中：让 React Aria 的拖动停下（键盘调整时它自己处理 Esc）
      if (pointerId.current !== null) {
        window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: pointerId.current, bubbles: true }));
        pointerId.current = null;
      }
    };
    const onPointer = (e: PointerEvent) => {
      shift.current = e.shiftKey;
      if (e.type === "pointerdown") pointerId.current = (e.target as Element | null)?.closest?.(".ui-table__resizer") ? e.pointerId : null;
      else if (e.type === "pointerup" || e.type === "pointercancel") pointerId.current = null;
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKey, true);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) window.addEventListener(type, onPointer as EventListener, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKey, true);
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) window.removeEventListener(type, onPointer as EventListener, true);
    };
  }, []);

  // 调整开始的那一刻（第一次移动之前）记下各列的像素宽度
  const onResizeStart = () => {
    const layout = layoutRef.current;
    session.current = { key: null, start: new Map(layout?.columnWidths ?? []), cancelled: false };
  };

  const onResize = (next: Map<Key, ColumnSize>) => {
    const s = session.current;
    if (!s || s.cancelled) return;
    const map = new Map(next);
    // 还不知道是哪一列时：宽度变了的那一列（左边的列 React Aria 钉在原来的宽度）
    s.key ??= [...next].find(([key, w]) => typeof w === "number" && Math.abs(w - (s.start.get(key) ?? w)) >= 0.5)?.[0] ?? null;
    const width = s.key === null ? undefined : next.get(s.key);
    const layout = layoutRef.current;
    if (shift.current && typeof width === "number" && s.key !== null && layout) {
      const keys = [...next.keys()];
      const neighbor = keys[keys.indexOf(s.key) + 1];
      if (neighbor !== undefined) {
        const startOwn = s.start.get(s.key)!;
        const startNeighbor = s.start.get(neighbor)!;
        const target = Math.min(Math.max(startNeighbor - (width - startOwn), layout.getColumnMinWidth(neighbor)), layout.getColumnMaxWidth(neighbor));
        // 其他列钉在开始时的宽度：只有这两列在变，总宽不变
        for (const [key, w] of s.start) map.set(key, w);
        map.set(neighbor, target);
        map.set(s.key, startOwn + (startNeighbor - target));
      }
    }
    setWidths(map);
  };

  const onResizeEnd = () => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    if (s.cancelled) {
      const restored = new Map<Key, ColumnSize>(s.start);
      setWidths(restored);
      onEnd?.(restored);
      return;
    }
    if (latest.current) onEnd?.(latest.current);
  };

  // 记在 Table 上而不是调整手柄里：调整过程中手柄可能被重新挂载，记在手柄的 ref 里会丢（焦点就不回表头了）
  const fromHeader = useRef<Key | null>(null);
  const control: ResizeControl = {
    widths,
    markFromHeader: (key) => {
      fromHeader.current = key;
    },
    takeFromHeader: (key) => {
      if (fromHeader.current !== key) return false;
      fromHeader.current = null;
      return true;
    },
    register: (layout) => {
      layoutRef.current = layout;
    },
    begin: (key) => {
      if (session.current) session.current.key = key;
    },
    apply: (next) => {
      setWidths(new Map(next));
      onEnd?.(next);
    },
  };
  return { control, onResizeStart, onResize, onResizeEnd };
}

/** Table 的加载状态，交给 TableBody 画占位行 */
const LoadingContext = createContext<{ phase: LoadingPhase; rows: number; label: string } | null>(null);

/**
 * 数据表格容器。组件基于 React Aria Table 渲染为 `grid` 角色，支持方向键在单元格间导航与列排序状态播报（`aria-sort`），使用时需传入 `aria-label` 或 `aria-labelledby`。
 *
 * @promote aria-label, sortDescriptor, onSortChange
 */
export function Table({
  size = "md",
  maxHeight,
  className,
  allowsColumnResizing = false,
  onColumnResizeEnd,
  stickyFirstColumn = false,
  isLoading = false,
  loadingRowCount = 3,
  loadingLabel: loadingLabelProp,
  allowsMarqueeSelection = false,
  ...props
}: TableProps) {
  const t = useStrings(tableStrings);
  const loadingLabel = loadingLabelProp === undefined ? t.loading : loadingLabelProp;
  const { phase } = useLoadingPhase(isLoading);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  containerRef.current = container;
  useStickyColumn(stickyFirstColumn ? container : null);
  const marquee = allowsMarqueeSelection && props.selectionMode === "multiple";
  const selection = useOwnedSelection(props, marquee);
  const bodyItems = useRef<Iterable<object> | undefined>(undefined);
  const disabled = props.disabledKeys ? new Set(props.disabledKeys) : null;
  useMarqueeSelection({
    ref: containerRef,
    element: container,
    enabled: marquee,
    itemSelector: ".ui-table__body [role=row][data-key]",
    mode: "rows",
    getKeys: () => (bodyItems.current ? [...bodyItems.current].map(keyOfItem).filter((key): key is Key => key !== undefined) : null),
    isDisabled: (key) => !!disabled?.has(key),
    getSelection: selection.get,
    setSelection: selection.set,
  });
  const containerProps = {
    ref: setContainer,
    className: "ui-table__container",
    "data-size": size,
    "data-sticky-header": maxHeight !== undefined || undefined,
    "data-sticky-column": stickyFirstColumn || undefined,
    style: maxHeight !== undefined ? { maxHeight } : undefined,
    // React Aria 的 Table 不往 DOM 上传 aria-busy：写在外层
    "aria-busy": isLoading || undefined,
  };
  const table = (
    <LoadingContext value={isLoading ? { phase, rows: loadingRowCount, label: loadingLabel } : null}>
      <BodyItemsContext value={bodyItems}>
        <AriaTable {...props} {...selection.props} className={withUiClass("ui-table", className)} />
      </BodyItemsContext>
    </LoadingContext>
  );
  const resize = useResizeControl(onColumnResizeEnd);
  if (!allowsColumnResizing) return <div {...containerProps}>{table}</div>;
  return (
    <ResizableTableContainer {...containerProps} data-resizable="" onResizeStart={resize.onResizeStart} onResize={resize.onResize} onResizeEnd={resize.onResizeEnd}>
      <ResizeControlContext value={resize.control}>{table}</ResizeControlContext>
    </ResizableTableContainer>
  );
}

/** 固定在左边的列：第一列；第一列是 DataTable 的勾选列时再加上后面一列 */
function frozenHeaders(container: HTMLElement) {
  const headers = [...container.querySelectorAll<HTMLElement>("[role=columnheader]")];
  return headers.slice(0, headers[0]?.classList.contains("ui-data-table__select") ? 2 : 1);
}

/**
 * 固定第一列：容器放得下"固定的列 + 96px"时才固定（data-sticky-column-active），不然手机上会被它占掉大半个屏幕；
 * 往后滚了（data-scrolled-start）固定列的边上画一条线。直接改属性，不触发重新渲染
 */
function useStickyColumn(container: HTMLDivElement | null) {
  useEffect(() => {
    if (!container) return;
    const update = () => {
      const frozen = frozenHeaders(container);
      const width = frozen.reduce((sum, h) => sum + h.getBoundingClientRect().width, 0);
      // 第二个固定列贴在第一个后面：写下第一个的宽度（DataTable 的勾选列）
      container.style.setProperty("--ui-table-frozen-first", `${frozen[0]?.getBoundingClientRect().width ?? 0}px`);
      container.toggleAttribute("data-sticky-column-active", frozen.length > 0 && container.clientWidth >= width + 96);
    };
    // RTL 时 scrollLeft 是 0 到负数：取绝对值就是离开头的距离
    const onScroll = () => container.toggleAttribute("data-scrolled-start", Math.abs(container.scrollLeft) > 1);
    update();
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    for (const h of frozenHeaders(container)) observer.observe(h);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
      container.removeAttribute("data-sticky-column-active");
    };
  }, [container]);
}

/** 列内容的自然宽度（不换行）：表头的文字和这一列已渲染的单元格里最宽的，加上左右内边距 */
function naturalWidth(header: HTMLElement): number {
  const grid = header.closest<HTMLElement>("[role=grid], [role=treegrid]");
  const label = header.querySelector<HTMLElement>(".ui-table__column-label");
  const pad = (el: HTMLElement) => {
    const s = getComputedStyle(el);
    return Number.parseFloat(s.paddingInlineStart) + Number.parseFloat(s.paddingInlineEnd);
  };
  let max = (label?.scrollWidth ?? 0) + pad(header);
  // 原生表格按列序号找单元格（跳过空状态那种跨列的行）；虚拟滚动（div）按 aria-colindex 找
  const colIndex = header.getAttribute("aria-colindex");
  const cells =
    header instanceof HTMLTableCellElement
      ? [...(header.closest("table")?.tBodies[0]?.rows ?? [])]
          .filter((r) => r.cells.length > header.cellIndex && r.cells[0]?.colSpan === 1)
          .map((r) => r.cells[header.cellIndex]!)
      : [...(grid?.querySelectorAll<HTMLElement>(`[role=row] [aria-colindex="${colIndex}"]:not([role=columnheader])`) ?? [])];
  const range = document.createRange();
  for (const cell of cells) {
    const prev = cell.style.whiteSpace;
    cell.style.whiteSpace = "nowrap";
    range.selectNodeContents(cell);
    max = Math.max(max, range.getBoundingClientRect().width + pad(cell));
    cell.style.whiteSpace = prev;
  }
  return Math.ceil(max) + 1;
}

export interface TableHeaderProps<T extends object> extends Omit<AriaTableHeaderProps<T>, "children"> {
  /** 表头列组件（`Column`），或配合 `columns` 属性使用的渲染函数。 */
  children?: ReactNode | ((column: T) => ReactNode);
}

/**
 * 表格头部行容器。
 */
export function TableHeader<T extends object>({ className, ...props }: TableHeaderProps<T>) {
  return <AriaTableHeader {...(props as AriaTableHeaderProps<T>)} className={withUiClass("ui-table__header", className)} />;
}

export interface ColumnProps extends Omit<AriaColumnProps, "children"> {
  /** 列标题内容。 */
  children?: ReactNode;
  /** 是否允许调整该列宽度（需同时在 `Table` 上开启 `allowsColumnResizing` 并为当前列传入 `id`）；可通过 `minWidth`、`maxWidth` 和 `defaultWidth` 控制宽度范围。 */
  allowsResizing?: boolean;
}

/**
 * 表格列定义。每个表格应指定一列 `isRowHeader`（通常为主名称列）供读屏在播报单元格时关联行标题；开启 `allowsSorting` 的列支持点击排序并展示方向箭头。
 *
 * @promote id, isRowHeader, allowsSorting, allowsResizing, defaultWidth, minWidth
 */
export function Column({ children, className, allowsResizing = false, ...props }: ColumnProps) {
  const resizable = allowsResizing && props.id != null;
  // 可调列宽的表格调整过以后，宽度由 Table 保存（见 ResizeControl）
  const control = useContext(ResizeControlContext);
  const controlled = props.id != null ? control?.widths?.get(props.id) : undefined;
  // 键盘调整结束后 React Aria 把焦点还给这个 ref 指向的表头；不传时焦点会留在手柄上
  const ref = useRef<HTMLTableCellElement>(null);
  return (
    <AriaColumn
      {...props}
      {...(controlled !== undefined ? { width: controlled } : null)}
      ref={ref}
      // 焦点停在表头本身（默认会跳到里面第一个可聚焦的元素，也就是调整手柄的隐藏输入框）
      focusMode={resizable ? "cell" : props.focusMode}
      data-resizable={resizable || undefined}
      className={withUiClass("ui-table__column", className)}
    >
      {({ allowsSorting, sortDirection, startResize }) => (
        <>
          <span className="ui-table__column-label">
            <span className="ui-table__column-text">{children}</span>
            {allowsSorting ? (
              <span className="ui-table__sort" aria-hidden="true" data-direction={sortDirection}>
                {sortDirection === "descending" ? <ChevronDownIcon /> : <ChevronUpIcon />}
              </span>
            ) : null}
          </span>
          {resizable ? <ResizeHandle id={props.id!} startResize={startResize} /> : null}
        </>
      )}
    </AriaColumn>
  );
}

/** 一次调整开始时（这一列成为正在调整的列）告诉 Table：记下开始时的列宽 */
function BeginResize({ isResizing, onBegin }: { isResizing: boolean; onBegin: () => void }) {
  const was = useRef(false);
  useLayoutEffect(() => {
    if (isResizing && !was.current) onBegin();
    was.current = isResizing;
  });
  return null;
}

/**
 * 键盘调整结束后把焦点还给表头。React Aria 本来会做，但它在一个依赖列对象的 effect 里记"开始时焦点是不是已经在手柄上"：
 * 列宽一变表格重新渲染、列对象跟着变，effect 重跑时焦点已经被它移到手柄上，于是以为"开始时就在手柄上"，结束后不还焦点。
 * 跑不跑到这一步取决于渲染和聚焦谁先发生，所以时好时坏（react-aria 3.53.1，useTableColumnResize）。
 * 这里在 isResizing 从 true 变成 false 时补一下。手柄在调整过程中也可能被重新挂载（React Aria 的新实例同样以为"开始时就在手柄上"），
 * 所以"是不是从表头开始的"记在 Table 的 ResizeControl 里，不记在手柄自己的 ref 里。
 */
function ReturnFocus({ isResizing, onEnd }: { isResizing: boolean; onEnd: () => void }) {
  const was = useRef(isResizing);
  const end = useRef(onEnd);
  useLayoutEffect(() => {
    end.current = onEnd;
  });
  useEffect(() => {
    if (was.current && !isResizing) end.current();
    was.current = isResizing;
  }, [isResizing]);
  return null;
}

/**
 * 调整手柄。React Aria 先在一棵看不见的树里收集列（拿不到 Table 的 context），真正渲染时才调用 Column 的 children：
 * 和列宽状态打交道的部分都放在这里。
 */
function ResizeHandle({ id, startResize }: { id: Key; startResize: () => void }) {
  const t = useStrings(tableStrings);
  const layout = useContext(TableColumnResizeStateContext);
  const control = useContext(ResizeControlContext);
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef(startResize);
  const controlRef = useRef(control);
  useLayoutEffect(() => {
    startRef.current = startResize;
    controlRef.current = control;
  });
  // 键盘：表头上按 Alt + ←/→ 进入调整模式（焦点移到手柄，方向键每次 10px，Enter / Esc / Tab 结束并回到表头）。
  // Enter 留给排序，所以另用一组键。Column 不转发键盘事件，表格的方向键导航又在捕获阶段处理（会拦住事件）：
  // 在 document 的捕获阶段监听，只处理焦点在这个表头上的
  const hasLayout = layout != null;
  useEffect(() => {
    const header = ref.current?.closest<HTMLElement>("[role=columnheader]");
    if (!header || !hasLayout) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target !== header || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      e.stopPropagation();
      controlRef.current?.markFromHeader(id);
      startRef.current();
    };
    // 读屏能读出快捷键（Column 不转发 aria-keyshortcuts，直接写到元素上）
    header.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      header.removeAttribute("aria-keyshortcuts");
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [hasLayout]);
  useLayoutEffect(() => {
    if (layout) control?.register(layout);
  });
  if (!layout) return null;
  // 双击手柄：按内容（表头和已渲染的单元格）自动调整宽度
  const autosize = () => {
    const header = ref.current?.closest<HTMLElement>("[role=columnheader]");
    if (!header) return;
    const width = Math.min(Math.max(naturalWidth(header), layout.getColumnMinWidth(id)), layout.getColumnMaxWidth(id));
    control?.apply(layout.updateResizedColumns(id, width));
  };
  return (
    <ColumnResizer ref={ref} className="ui-table__resizer" aria-label={t.resize} onDoubleClick={autosize}>
      {({ isHovered, isFocusVisible, isResizing }) => (
        <>
          <ResizerGrip id={id} isHovered={isHovered} isFocusVisible={isFocusVisible} isResizing={isResizing} />
          {/* ColumnResizer 的 isResizing 在键盘调整时不变：看列宽状态里正在调整的是不是这一列 */}
          <BeginResize
            isResizing={layout.resizingColumn === id}
            onBegin={() => control?.begin(id)}
          />
          <ReturnFocus
            isResizing={isResizing}
            onEnd={() => {
              if (!control?.takeFromHeader(id)) return;
              const header = ref.current?.closest<HTMLElement>("[role=columnheader]");
              const active = document.activeElement;
              // 焦点卡在手柄上（或掉到了 body）时还给表头；用户按 Tab 去了别处就不动
              if (header && (active === document.body || (active && ref.current?.contains(active)))) header.focus();
            }}
          />
        </>
      )}
    </ColumnResizer>
  );
}

/** 列宽把手的样子：到最小宽度时左边到头，最大宽度时右边到头（RTL 时反过来） */
function ResizerGrip({ id, isHovered, isFocusVisible, isResizing }: { id: Key; isHovered: boolean; isFocusVisible: boolean; isResizing: boolean }) {
  const layout = useContext(TableColumnResizeStateContext)!;
  const { direction: textDirection } = useLocale();
  const direction = useGripDirection(isResizing);
  const width = layout.getColumnWidth(id);
  const shrink = textDirection === "rtl" ? "end" : "start";
  const grow = textDirection === "rtl" ? "start" : "end";
  const limit = width <= layout.getColumnMinWidth(id) ? shrink : width >= layout.getColumnMaxWidth(id) ? grow : undefined;
  return <ResizeGrip isVisible={isHovered || isFocusVisible} isActive={isResizing} isFocusVisible={isFocusVisible} direction={direction} limit={limit} />;
}

export interface TableBodyProps<T extends object> extends AriaTableBodyProps<T> {}

/**
 * 表格主体容器；无数据时默认展示“没有数据”，可通过 `renderEmptyState` 自定义空状态内容。
 */
export function TableBody<T extends object>({ className, renderEmptyState, ...props }: TableBodyProps<T>) {
  const t = useStrings(tableStrings);
  const loading = useContext(LoadingContext);
  const bodyItems = useContext(BodyItemsContext);
  if (bodyItems) bodyItems.current = props.items;
  const empty = loading
    ? () => (
        // 等待阶段占住位置但看不见：很快就加载完时不闪一下
        <div className="ui-table__skeleton" data-waiting={loading.phase === "waiting" || undefined}>
          <VisuallyHidden>{loading.label}</VisuallyHidden>
          {Array.from({ length: loading.rows }, (_, i) => (
            <Skeleton key={i} width={i % 3 === 2 ? "60%" : undefined} />
          ))}
        </div>
      )
    : (renderEmptyState ?? (() => <div className="ui-table__empty">{t.empty}</div>));
  return (
    <AriaTableBody
      {...props}
      renderEmptyState={empty}
      className={withUiClass("ui-table__body", className)}
    />
  );
}

export interface RowProps<T extends object> extends AriaRowProps<T> {}

/**
 * 表格数据行；传入 `href` 或 `onAction` 时整行可点击触发操作或导航。
 */
export function Row<T extends object>({ className, ...props }: RowProps<T>) {
  return <AriaRow {...props} className={withUiClass("ui-table__row", className)} />;
}

export interface CellProps extends Omit<AriaCellProps, "children"> {
  /** 单元格内容。 */
  children?: ReactNode;
}

/**
 * 一个单元格。
 */
export function Cell({ className, ...props }: CellProps) {
  return <AriaCell {...props} className={withUiClass("ui-table__cell", className)} />;
}
