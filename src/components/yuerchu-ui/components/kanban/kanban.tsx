"use client";

import type { ReactNode, Ref } from "react";
import { createContext, Fragment, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mergeRefs, useNumberFormatter, VisuallyHidden } from "react-aria";
import {
  Button as AriaButton, DropIndicator, DropZone, useDragAndDrop, type DropItem, type Key,
} from "react-aria-components";
import { announce } from "../../lib/announce";
import { useStrings } from "../../lib/i18n";
import { ChevronRightIcon, GripIcon } from "../../lib/icons";
import { Badge } from "../badge/badge";
import { Button } from "../button/button";
import { GridList, GridListItem } from "../grid-list/grid-list";
import { Menu, MenuItem, MenuTrigger } from "../menu/menu";
import { ScrollArea } from "../scroll-area/scroll-area";
import { claimFocus, focusKanbanCard, type FocusClaim } from "./kanban-focus";
import {
  matchesMove, proposeMove, validateColumns, type KanbanColumnData, type KanbanItem, type KanbanMove,
  type Landing, type Source,
} from "./kanban-order";
import { kanbanStrings } from "./kanban.strings";
import "./kanban.css";

export type { KanbanColumnData, KanbanItem, KanbanMove } from "./kanban-order";

/**
 * 看板按状态分列，既可以在列内调整卡片顺序，也可以把卡片移到另一列。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

/** 接受移动时不返回或返回 `true`；返回 `false` 静默拒绝；返回一句说明则拒绝并把这句话读出来。 */
export type KanbanMoveResult = void | boolean | string;

interface KanbanBaseProps<T extends KanbanItem> {
  /** 按显示顺序排列的列及其卡片。列和卡片都需要稳定的非空 id。列 id 在各列之间唯一，卡片 id 在整个看板内唯一。 */
  columns: readonly KanbanColumnData<T>[];
  /** 为每一列渲染 KanbanColumn。 */
  children: (column: KanbanColumnData<T>) => ReactNode;
  /** 看板滚动区域的无障碍名称，中文默认为“看板”。 */
  "aria-label"?: string;
  /** 看板滚动区域的类名。 */
  className?: string;
  /** 看板滚动区域的元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

export type KanbanProps<T extends KanbanItem> = KanbanBaseProps<T> & (
  | {
      /** 只展示列和卡片：不渲染拖动手柄、“移动”菜单和折叠列的落点。顺序由使用方更新 `columns`。 */
      isReadOnly: true;
      onMove?: undefined;
    }
  | {
      isReadOnly?: false;
      /** 每次有效移动调用一次。next 包含新的列和卡片顺序，move 标明卡片、原列、目标列和最终位置。返回 `false` 静默拒绝；返回一句说明则拒绝并读出。 */
      onMove: (next: KanbanColumnData<T>[], move: KanbanMove) => KanbanMoveResult;
    }
);

interface Board {
  columns: readonly KanbanColumnData<KanbanItem>[];
  readOnly: boolean;
  type: string;
  begin: (from: string, keys: Set<Key>) => void;
  end: (from: string, keys: Set<Key>, dropOperation: string) => void;
  drop: (to: string, landing: Landing, internal?: Source) => void;
  menuMove: (source: Source, to: string, landing: Landing) => void;
}
const BoardContext = createContext<Board | null>(null);
interface Lane {
  id: string;
  cards: readonly KanbanItem[];
  indices: ReadonlyMap<string, number>;
}
const ColumnContext = createContext<Lane | null>(null);
function useBoard() {
  const board = useContext(BoardContext);
  if (!board) throw new Error("KanbanColumn and KanbanCard must be rendered within Kanban");
  return board;
}

function onlyKey(keys: Set<Key>) {
  if (keys.size !== 1) return null;
  const [id] = keys;
  return typeof id === "string" ? id : null;
}
interface Pending<T extends KanbanItem> {
  before: readonly KanbanColumnData<T>[];
  expected: readonly KanbanColumnData<T>[];
  move: KanbanMove;
  focus: FocusClaim | null;
}

/** 按传入的顺序显示各列。容器宽度不足时，可以横向滚动看板查看其余列。 */
export function Kanban<T extends KanbanItem>({
  columns, onMove, isReadOnly = false, children, "aria-label": label, className, ref,
}: KanbanProps<T>) {
  const t = useStrings(kanbanStrings);
  const fmt = useNumberFormatter();
  const type = `application/x-yuerchu-kanban-${useId().replace(/[^\w-]/g, "").toLowerCase()}`;
  const root = useRef<HTMLDivElement>(null);
  const keyboard = useRef(true);
  const drag = useRef<(Source & { keyboard: boolean }) | null>(null);
  const pending = useRef<Pending<T> | null>(null);
  const focus = useRef<FocusClaim | null>(null);
  const latest = useRef({ columns, onMove });
  const model = useMemo(() => { validateColumns(columns); return columns; }, [columns]);

  useLayoutEffect(() => {
    latest.current = { columns, onMove };
    const request = pending.current;
    if (!request || request.before === columns) return;
    if (!matchesMove(columns, request.expected, request.move)) {
      // 备注或第三列更新，不代表宿主已提交或拒绝这次移动。
      if (matchesMove(columns, request.before, request.move)) return;
      pending.current = null;
      request.focus?.controller.abort();
      return;
    }
    pending.current = null;
    const dest = columns.find((c) => c.id === request.move.toColumnId)!;
    announce(t.moved({ column: dest.heading, position: fmt.format(request.move.index + 1) }));
    if (request.focus && root.current) focusKanbanCard(root.current, dest.id, request.move.cardId, request.focus);
  }, [columns, onMove, t, fmt]);
  useLayoutEffect(() => () => { focus.current?.controller.abort(); pending.current = null; drag.current = null; }, []);

  function propose(source: Source, to: string, landing: Landing, refocus: boolean) {
    const { columns: before, onMove: notify } = latest.current;
    if (!notify) return;
    const next = proposeMove(before, source, to, landing);
    if (!next) return;
    focus.current?.controller.abort();
    const claim = refocus && root.current ? claimFocus(root.current) : null;
    focus.current = claim;
    const request = { before, expected: next.columns, move: next.move, focus: claim };
    pending.current = request;
    try {
      const result = notify(next.columns, next.move);
      if (result !== false && typeof result !== "string") return;
      if (typeof result === "string" && result.trim()) announce(result.trim());
    } catch (error) {
      if (pending.current === request) pending.current = null;
      claim?.controller.abort();
      throw error;
    }
    if (pending.current === request) pending.current = null;
    claim?.controller.abort();
  }
  const board: Board = {
    columns: model, readOnly: isReadOnly, type,
    begin(from, keys) {
      focus.current?.controller.abort();
      pending.current = null;
      const id = onlyKey(keys);
      drag.current = id === null ? null : { fromColumnId: from, cardId: id, keyboard: keyboard.current };
    },
    end(from, keys, dropOperation) {
      const source = drag.current;
      if (!source || source.fromColumnId !== from || !keys.has(source.cardId)) return;
      drag.current = null;
      const boardRoot = root.current;
      if (dropOperation !== "cancel" || !source.keyboard || !boardRoot) return;
      const doc = boardRoot.ownerDocument;
      if (doc.activeElement !== doc.body && !boardRoot.contains(doc.activeElement)) return;
      // RAC 移除插入指示器后焦点可能落到 body；取消只回原拖柄，不移动卡片或播报成功。
      const claim = claimFocus(boardRoot);
      focus.current = claim;
      focusKanbanCard(boardRoot, from, source.cardId, claim);
    },
    drop(to, landing, internal) {
      const source = drag.current;
      if (!source) return;
      if (internal && (internal.fromColumnId !== source.fromColumnId || internal.cardId !== source.cardId)) return;
      drag.current = null;
      propose({ cardId: source.cardId, fromColumnId: source.fromColumnId }, to, landing, source.keyboard);
    },
    menuMove(source, to, landing) { propose(source, to, landing, true); },
  };
  return (
    <BoardContext.Provider value={board}>
      <ScrollArea ref={mergeRefs(root, ref ?? null)} orientation="horizontal" aria-label={label ?? t.board}
        className={className ? `ui-kanban ${className}` : "ui-kanban"}>
        <div className="ui-kanban__columns" onKeyDownCapture={() => { keyboard.current = true; }}
          onPointerDownCapture={() => { keyboard.current = false; }}>
          {model.map((column) => <Fragment key={column.id}>{children(column)}</Fragment>)}
        </div>
      </ScrollArea>
    </BoardContext.Provider>
  );
}

export interface KanbanColumnProps<T extends KanbanItem> {
  /** Kanban 传给渲染函数的当前列。 */
  column: KanbanColumnData<T>;
  /** 为列中的每张卡片渲染 KanbanCard。 */
  children: (card: T) => ReactNode;
  /** 控制列是否折叠。 */
  isCollapsed?: boolean;
  /** 首次渲染时是否折叠，默认展开。 */
  defaultCollapsed?: boolean;
  /** 请求展开或折叠列时调用，参数为 true 表示折叠。 */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** 空列展开时显示的内容。 */
  emptyState?: ReactNode;
  /** 列标题的层级，默认为三级标题。 */
  headingLevel?: 2 | 3 | 4;
  /** 列的类名。 */
  className?: string;
  /** 列区域的元素引用。 */
  ref?: Ref<HTMLElement>;
}

function accepts(items: DropItem[], type: string) {
  return items.length === 1 && items[0]?.kind === "text" && items[0].types.has(type);
}

/** 列标题显示卡片数量。折叠后仍可把卡片移到列末，不必先展开。 */
export function KanbanColumn<T extends KanbanItem>({
  column, children, isCollapsed, defaultCollapsed = false, onCollapsedChange, emptyState,
  headingLevel = 3, className, ref,
}: KanbanColumnProps<T>) {
  const board = useBoard();
  const t = useStrings(kanbanStrings);
  const fmt = useNumberFormatter();
  const [own, setOwn] = useState(defaultCollapsed);
  const collapsed = isCollapsed ?? own;
  const titleId = useId(), countId = useId(), panelId = useId();
  const Heading = `h${headingLevel}` as "h3";
  const header = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const { id, cards, heading } = column;
  const indices = useMemo(() => new Map(cards.map((card, index) => [card.id, index] as const)), [cards]);
  useLayoutEffect(() => {
    const doc = body.current?.ownerDocument;
    if (!collapsed) return;
    if (hadFocus.current && doc && doc.activeElement === doc.body) header.current?.focus({ preventScroll: true });
    hadFocus.current = false;
  }, [collapsed]);
  const operation = (types: { has: (type: string) => boolean }, allowed: readonly string[]) =>
    types.has(board.type) && allowed.includes("move") ? "move" as const : "cancel" as const;
  const { dragAndDropHooks } = useDragAndDrop<T>({
    getItems: (keys) => {
      const key = onlyKey(keys);
      return key === null ? [] : [{ [board.type]: key }];
    },
    getAllowedDropOperations: () => ["move"],
    acceptedDragTypes: [board.type],
    getDropOperation: (target, types, allowed) => {
      if (target.type === "root" ? cards.length > 0 : target.dropPosition === "on") return "cancel";
      return operation(types, allowed);
    },
    onDragStart: (e) => board.begin(id, e.keys),
    onDragEnd: (e) => board.end(id, e.keys, e.dropOperation),
    onReorder(e) {
      const key = onlyKey(e.keys);
      const { key: anchor, dropPosition } = e.target;
      if (key === null || e.dropOperation !== "move" || dropPosition === "on" || typeof anchor !== "string") return;
      board.drop(id, { position: dropPosition, key: anchor }, { cardId: key, fromColumnId: id });
    },
    onInsert(e) {
      if (e.dropOperation !== "move" || !accepts(e.items, board.type) || e.target.dropPosition === "on") return;
      if (typeof e.target.key === "string") board.drop(id, { position: e.target.dropPosition, key: e.target.key });
    },
    onRootDrop(e) {
      if (e.dropOperation === "move" && accepts(e.items, board.type)) board.drop(id, { position: "empty" });
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="ui-grid-list__drop-indicator" />,
    renderDragPreview: (items) => (
      <div className="ui-grid-list__drag-preview"><GripIcon />
        <span className="ui-grid-list__drag-preview-label">
          {cards.find((c) => c.id === items[0]?.[board.type])?.textValue}
        </span>
      </div>
    ),
  });
  return (
    <section ref={ref} aria-labelledby={titleId} data-kanban-column={id} data-collapsed={collapsed || null}
      className={className ? `ui-kanban-column ${className}` : "ui-kanban-column"}>
      <Heading className="ui-kanban-column__heading">
        <AriaButton ref={header} className="ui-kanban-column__toggle" aria-expanded={!collapsed} aria-controls={panelId}
          aria-labelledby={`${titleId} ${countId}`} onPress={() => {
            if (isCollapsed == null) setOwn(!collapsed);
            onCollapsedChange?.(!collapsed);
          }}>
          <span className="ui-kanban-column__label" id={titleId}>{heading}</span>
          <Badge size="sm" aria-hidden="true">{fmt.format(cards.length)}</Badge>
          <ChevronRightIcon className="ui-kanban-column__chevron" />
        </AriaButton>
      </Heading>
      <VisuallyHidden id={countId}>{t.count({ count: cards.length, number: fmt.format(cards.length) })}</VisuallyHidden>
      <div id={panelId} ref={body} hidden={collapsed} onFocusCapture={() => { hadFocus.current = true; }}
        onBlurCapture={(e) => {
          if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) hadFocus.current = false;
        }}>
        {!collapsed ? <ColumnContext.Provider value={{ id, cards, indices }}>
          <GridList<T> aria-label={heading} className="ui-kanban-column__list" selectionMode="none" items={cards}
            keyboardNavigationBehavior="tab" dragAndDropHooks={board.readOnly ? undefined : dragAndDropHooks} dependencies={[children]}
            renderEmptyState={() => <div className="ui-kanban-column__empty">{emptyState ?? (board.readOnly ? t.emptyReadOnly : t.empty)}</div>}>
            {children}
          </GridList>
        </ColumnContext.Provider> : null}
      </div>
      {collapsed && !board.readOnly ? <DropZone aria-label={t.append({ column: heading })} className="ui-kanban-column__append"
        getDropOperation={operation} onDrop={(e) => {
          if (e.dropOperation === "move" && accepts(e.items, board.type)) board.drop(id, { position: "end" });
        }}>{t.folded}</DropZone> : null}
    </section>
  );
}

export interface KanbanCardProps {
  /** KanbanColumn 传给渲染函数的当前卡片。 */
  card: KanbanItem;
  /** 卡片正文，可以包含文字、徽标或表单控件，默认显示卡片的 textValue。 */
  children?: ReactNode;
  /** 显示在“移动”按钮旁的其他操作，例如查看任务详情。 */
  actions?: ReactNode;
}

/** 显示卡片内容，并提供拖动手柄和“移动”菜单。 */
export function KanbanCard({ card, children, actions }: KanbanCardProps) {
  const board = useBoard();
  const lane = useContext(ColumnContext);
  if (lane === null) throw new Error("KanbanCard must be rendered within KanbanColumn");
  const t = useStrings(kanbanStrings);
  const columnId = lane.id;
  const cards = lane.cards;
  const index = lane.indices.get(card.id) ?? -1;
  const previous = cards[index - 1], next = cards[index + 1];
  const source = { fromColumnId: columnId, cardId: card.id };
  const name = t.moveCard({ card: card.textValue });
  return (
    <GridListItem id={card.id} textValue={card.textValue} actions={
      <>
        {actions}
        {board.readOnly ? null : (
        <MenuTrigger>
          <Button variant="ghost" size="sm" aria-label={name}>{t.move}</Button>
          <Menu aria-label={name} placement="bottom end">
            <MenuItem id="up" isDisabled={!previous} onAction={() => {
              if (previous) board.menuMove(source, columnId, { position: "before", key: previous.id });
            }}>{t.up}</MenuItem>
            <MenuItem id="down" isDisabled={!next} onAction={() => {
              if (next) board.menuMove(source, columnId, { position: "after", key: next.id });
            }}>{t.down}</MenuItem>
            {board.columns.filter((c) => c.id !== columnId).map((c) => (
              <MenuItem key={c.id} id={`column:${c.id}`}
                onAction={() => board.menuMove(source, c.id, { position: "end" })}>{t.to({ column: c.heading })}</MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        )}
      </>
    }>
      <div className="ui-kanban-card__body">{children ?? card.textValue}</div>
    </GridListItem>
  );
}
