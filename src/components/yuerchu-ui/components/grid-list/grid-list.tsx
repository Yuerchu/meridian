"use client";

import type { ReactNode, RefObject } from "react";
import { animate } from "motion/react";
import { useEffect, useRef } from "react";
import type { DropTarget, GridListItemProps as AriaGridListItemProps, GridListItemRenderProps, GridListProps as AriaGridListProps, Key } from "react-aria-components";
import {
  Button as AriaButton,
  DropIndicator,
  GridList as AriaGridList,
  GridListItem as AriaGridListItem,
  Text,
  useDragAndDrop,
} from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { CheckIcon, GripIcon, MoreIcon } from "../../lib/icons";
import { keyOfItem, useMarqueeSelection, useOwnedSelection } from "../../lib/marquee-selection";
import { currentMotionTokens } from "../../lib/motion";
import { setInteractionModality, VisuallyHidden } from "react-aria";
import { Button } from "../button/button";
import { Checkbox } from "../checkbox/checkbox";
import { Menu, MenuItem, MenuTrigger } from "../menu/menu";
import { useLoadingPhase } from "../reveal/reveal";
import { Skeleton } from "../skeleton/skeleton";
import { type SwipeActionsConfig, SwipeRow } from "./grid-list-swipe";
export type { SwipeAction, SwipeActionsConfig } from "./grid-list-swipe";
import { gridListStrings } from "./grid-list.strings";
import "./grid-list.css";

/**
 * 用于展示支持行选择、激活及行内操作的交互式列表或卡片网格。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface GridListProps<T extends object> extends Omit<AriaGridListProps<T>, "className" | "style"> {
  /**
   * 排列方式。`stack` 为纵向单列列表；`grid` 为自适应卡片网格（每项至少 200px 宽）。
   * @default "stack"
   */
  layout?: "stack" | "grid";
  /** 自定义类名。 */
  className?: string;
  /**
   * 拖动排序回调；传入后每行左侧显示拖动手柄，放下时提供被拖动的行键与目标位置（可配合 `useListData` 的 `moveBefore` / `moveAfter` 更新顺序）。
   */
  onReorder?: (keys: Key[], target: { key: Key; position: "before" | "after" }) => void;
  /**
   * 是否处于加载中状态；尚无数据时显示骨架占位，已有数据时保留现有项并向读屏标记 `aria-busy`。
   */
  isLoading?: boolean;
  /**
   * 加载中渲染的骨架占位项数量，建议与上次条目数或分页大小保持一致。
   * @default 3
   */
  loadingItemCount?: number;
  /**
   * 加载中向读屏播报的提示文本。
   * @default "正在加载"（英文界面 "Loading"）
   */
  loadingLabel?: string;
  /**
   * 是否启用框选；在 `selectionMode="multiple"` 下允许鼠标从空白区域拖出矩形选中多行（开启 `onReorder` 时需从空白区域起拖）。
   */
  allowsMarqueeSelection?: boolean;
}

/**
 * 交互式列表组件，支持方向键导航、多选框选、滑动快捷操作及拖动排序；列表为空时默认显示“暂无内容”，可通过 `renderEmptyState` 自定义。
 *
 * @promote items, selectionMode, selectedKeys, defaultSelectedKeys, onSelectionChange, onAction, disabledKeys, renderEmptyState
 */
export function GridList<T extends object>({
  layout = "stack",
  className,
  renderEmptyState,
  onReorder,
  isLoading = false,
  loadingItemCount = 3,
  loadingLabel: loadingLabelProp,
  allowsMarqueeSelection = false,
  ...props
}: GridListProps<T>) {
  const t = useStrings(gridListStrings);
  const loadingLabel = loadingLabelProp === undefined ? t.loading : loadingLabelProp;
  const listRef = useRef<HTMLDivElement>(null);
  const marquee = allowsMarqueeSelection && props.selectionMode === "multiple";
  const selection = useOwnedSelection(props, marquee);
  const disabled = props.disabledKeys ? new Set(props.disabledKeys) : null;
  useMarqueeSelection({
    ref: listRef,
    enabled: marquee,
    itemSelector: "[role=row][data-key]",
    mode: layout === "grid" ? "rects" : "rows",
    getKeys: () => (props.items ? [...props.items].map(keyOfItem).filter((key): key is Key => key !== undefined) : null),
    isDisabled: (key) => !!disabled?.has(key),
    getSelection: selection.get,
    setSelection: selection.set,
  });
  const { phase } = useLoadingPhase(isLoading);
  // React Aria 的 GridList 不往 DOM 上传 aria-busy：直接写在列表元素上
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (isLoading) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  }, [isLoading, onReorder]);
  // 列表在开关拖动排序时重新挂载（见下面的 key）：跟着重新挂监听
  useRowFollowsChildFocus(listRef, !!onReorder);
  const rowOf =(key: Key) => listRef.current?.querySelector<HTMLElement>(`[role=row][data-key="${CSS.escape(String(key))}"]`);
  const { dragAndDropHooks } = useDragAndDrop({
    // 只在列表内部排序：拖出去时带上行的文字
    getItems: (keys) => [...keys].map((key) => ({ "text/plain": rowOf(key)?.querySelector(".ui-grid-list-item__label")?.textContent || String(key) })),
    onReorder(e) {
      const target = e.target as DropTarget & { key: Key; dropPosition: "before" | "after" | "on" };
      if (target.dropPosition === "on") return;
      if (listRef.current) slideRows(listRef.current, e.keys);
      onReorder?.([...e.keys], { key: target.key, position: target.dropPosition });
    },
    // 拖动时跟着指针的是一张小卡片：第一行的文字，拖多行时加上"+N"
    renderDragPreview: (items) => (
      <div className="ui-grid-list__drag-preview">
        <GripIcon />
        <span className="ui-grid-list__drag-preview-label">{items[0]?.["text/plain"]}</span>
        {items.length > 1 ? <span className="ui-grid-list__drag-preview-count">+{items.length - 1}</span> : null}
      </div>
    ),
    // 放下的位置：行之间让出一道缝，中间一条线（见 CSS）
    renderDropIndicator: (target) => <DropIndicator target={target} className="ui-grid-list__drop-indicator" />,
  });
  return (
    <AriaGridList
      {...props}
      {...selection.props}
      ref={listRef}
      // React Aria 只在有 dragAndDropHooks 时调用拖放的 hooks：开关拖动排序（例如"编辑顺序"模式）时要重新挂载，否则 hooks 顺序会乱
      key={onReorder ? "reorder" : "plain"}
      dragAndDropHooks={onReorder ? dragAndDropHooks : props.dragAndDropHooks}
      layout={layout}
      className={className ? `ui-grid-list ${className}` : "ui-grid-list"}
      renderEmptyState={
        isLoading
          ? () => (
              // 等待阶段占住位置但看不见：很快就加载完时不闪一下
              <div className="ui-grid-list__skeleton" data-waiting={phase === "waiting" || undefined}>
                <VisuallyHidden>{loadingLabel}</VisuallyHidden>
                {Array.from({ length: loadingItemCount }, (_, i) =>
                  layout === "grid" ? (
                    <Skeleton key={i} shape="rect" height={72} />
                  ) : (
                    // 一行名称 + 一行说明，和带 description 的行差不多高
                    <div key={i} className="ui-grid-list__skeleton-item">
                      <Skeleton width={i % 3 === 2 ? "40%" : "60%"} />
                      <Skeleton className="ui-grid-list__skeleton-meta" width="30%" />
                    </div>
                  ),
                )}
              </div>
            )
          : (renderEmptyState ?? (() => <div className="ui-grid-list__empty">{t.empty}</div>))
      }
    />
  );
}

/*
 * 焦点不经过键盘、指针，直接从列表外面落到某一行里的按钮上（读屏虚拟光标、关掉对话框后恢复焦点、代码里 ref.focus()）时，
 * React Aria 不把“当前行”设成这一行（它只在 !isFocusVisible()，即指针操作时这样做），列表的 onFocus 看到当前行是空的，
 * 就设成第一个选中的行或第一行，那一行随后把焦点抢过去（#489）。
 * React Aria 不公开 selectionManager（行里的 ListStateContext 被置空），也不公开读取交互方式的函数。这里在原生 focusin
 * 到达列表时（早于 React 在根上处理 onFocus）把交互方式临时设成 pointer，行的 onFocus 就会把当前行设成这一行；
 * React 提交完以后再恢复成 virtual 或 keyboard，焦点环照常显示。
 * 这次聚焦之前有没有按键 / 指针按下，按 React Aria 的同一个规则自己记（模块级，所有列表共用）。
 */
let inputBeforeFocus: "keyboard" | "pointer" | null = null;
let inputTracking = false;
function trackInputBeforeFocus() {
  if (inputTracking || typeof document === "undefined") return;
  inputTracking = true;
  const onKey = (e: KeyboardEvent) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key !== "Control" && e.key !== "Shift" && e.key !== "Meta") inputBeforeFocus = "keyboard";
  };
  const onPointer = () => (inputBeforeFocus = "pointer");
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("mousedown", onPointer, true);
  // 每次聚焦之后清掉：冒泡阶段在 document 上，晚于列表的 focusin 处理
  document.addEventListener("focusin", () => (inputBeforeFocus = null));
}

function useRowFollowsChildFocus(listRef: RefObject<HTMLDivElement | null>, remount: boolean) {
  useEffect(() => {
    trackInputBeforeFocus();
    const list = listRef.current;
    if (!list) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest<HTMLElement>("[role=row]");
      if (!row || row === target || row.closest("[role=grid]") !== list) return;
      // 焦点在列表里面移动：列表已经有当前行
      if (e.relatedTarget instanceof Node && list.contains(e.relatedTarget)) return;
      const before = inputBeforeFocus;
      if (before === "pointer") return;
      setInteractionModality("pointer");
      // 等 React 提交完再恢复：按钮的焦点环只在它渲染成“已聚焦”之后才听交互方式的变化，同一个事件里恢复它听不到。
      // 这中间又有按键 / 指针按下时 React Aria 已经记了新的交互方式，不覆盖
      setTimeout(() => {
        if (inputBeforeFocus === null) setInteractionModality(before ?? "virtual");
      });
    };
    list.addEventListener("focusin", onFocusIn);
    return () => list.removeEventListener("focusin", onFocusIn);
  }, [listRef, remount]);
}

const rowsOf = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("[role=row][data-key]")];

/**
 * 放下后让行从旧位置滑到新位置（FLIP）。先记下每一行的位置；React Aria 在之后的某次渲染里才把行移到新顺序，
 * 用 MutationObserver 等到顺序真的变了（在浏览器绘制之前）再算位移、放动画
 */
function slideRows(list: HTMLElement, dragged: Set<Key>) {
  // 减弱动效时这个弹簧的时长为 0：行直接出现在新位置
  const { spring } = currentMotionTokens();
  const rows = rowsOf(list);
  const order = rows.map((row) => row.dataset.key).join("\n");
  const before = new Map(rows.map((row) => [row.dataset.key!, row.getBoundingClientRect()]));
  // 被拖的行从放下的位置（那道缝）出现，不是从原来的位置滑过去
  const drop = list.querySelector(".ui-grid-list__drop-indicator[data-drop-target]")?.getBoundingClientRect();
  const draggedIds = new Set([...dragged].map(String));
  const observer = new MutationObserver(() => {
    const now = rowsOf(list);
    if (now.map((row) => row.dataset.key).join("\n") === order) return;
    observer.disconnect();
    for (const row of now) {
      const from = before.get(row.dataset.key!);
      if (!from) continue;
      const to = row.getBoundingClientRect();
      const fromDrop = drop && draggedIds.has(row.dataset.key!);
      const dx = fromDrop ? 0 : from.left - to.left;
      const dy = fromDrop ? drop.top + drop.height / 2 - to.height / 2 - to.top : from.top - to.top;
      if (!dx && !dy) continue;
      void animate(row, { translate: [`${dx}px ${dy}px`, "0px 0px"] }, spring);
    }
  });
  observer.observe(list, { childList: true, subtree: true });
  // 使用方没有更新数据（顺序没变）：别一直挂着
  setTimeout(() => observer.disconnect(), 1000);
}

export interface GridListItemProps extends Omit<AriaGridListItemProps, "children" | "className" | "style"> {
  /** 行的主要内容；内容不是纯字符串时请同时传入 `textValue` 供读屏与首字母跳转使用。 */
  children: ReactNode;
  /** 第二行的补充说明（如文件大小与更新时间）；读屏会将其拼进当前行名称一并朗读，请保持简短。 */
  description?: ReactNode;
  /** 行末尾的操作控件（如“更多”菜单按钮）；点击时不会触发行的选中或打开。 */
  actions?: ReactNode;
  /**
   * 触屏或手写笔横向滑动该行时露出的快捷操作配置，同时会自动添加到行末的“更多操作”菜单中供键盘、鼠标与读屏使用。
   */
  swipeActions?: SwipeActionsConfig;
}

/**
 * 列表中的单行项目；多选模式下行首显示勾选框，单选模式下选中项行末显示勾选图标。
 */
export function GridListItem({ children, description, actions, swipeActions, textValue, ...props }: GridListItemProps) {
  const t = useStrings(gridListStrings);
  const name = textValue ?? (typeof children === "string" ? children : undefined);
  const swipeList = swipeActions ? [...(swipeActions.leading ?? []), ...(swipeActions.trailing ?? [])] : [];
  const menu =
    swipeList.length > 0 ? (
      <MenuTrigger>
        <Button size="sm" variant="ghost" icon={<MoreIcon />} aria-label={name ? t.moreFor({ name }) : t.more} />
        <Menu onAction={(id) => swipeList.find((a) => a.id === id)?.onAction()}>
          {swipeList.map((a) => (
            <MenuItem key={a.id} id={a.id} tone={a.tone === "danger" ? "danger" : "default"}>
              {a.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    ) : null;
  return (
    <AriaGridListItem {...props} textValue={name} className="ui-grid-list-item" data-swipe={swipeList.length > 0 || undefined}>
      {(renderProps) => (swipeActions && swipeList.length > 0 ? <SwipeRow config={swipeActions}>{row(renderProps)}</SwipeRow> : row(renderProps))}
    </AriaGridListItem>
  );

  function row({ selectionMode, selectionBehavior, isSelected, allowsDragging }: GridListItemRenderProps) {
    return (
        <>
          {allowsDragging ? (
            // 拖动手柄：鼠标按住拖；键盘聚焦后 Enter 开始拖动，方向键选位置，Enter 放下（React Aria 提供，读屏有说明）
            <AriaButton slot="drag" className="ui-grid-list-item__drag">
              <GripIcon />
            </AriaButton>
          ) : null}
          {selectionMode === "multiple" && selectionBehavior === "toggle" ? <Checkbox slot="selection" /> : null}
          <div className="ui-grid-list-item__content">
            <div className="ui-grid-list-item__label">{children}</div>
            {description ? (
              <Text slot="description" className="ui-grid-list-item__description">
                {description}
              </Text>
            ) : null}
          </div>
          {actions || menu ? (
            <div className="ui-grid-list-item__actions">
              {actions}
              {menu}
            </div>
          ) : null}
          {selectionMode === "single" && isSelected ? (
            <span className="ui-grid-list-item__check" aria-hidden="true">
              <CheckIcon />
            </span>
          ) : null}
        </>
    );
  }
}
