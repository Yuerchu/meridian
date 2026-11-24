"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "react-aria";
import type { DropTarget, Key, TreeItemProps as AriaTreeItemProps, TreeProps as AriaTreeProps } from "react-aria-components";
import { Button as AriaButton, DropIndicator, Tree as AriaTree, TreeItem as AriaTreeItem, TreeItemContent, useDragAndDrop } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { ChevronRightIcon, GripIcon } from "../../lib/icons";
import { Checkbox } from "../checkbox/checkbox";
import { treeStrings } from "./tree.strings";
import "./tree.css";

/**
 * 可展开、折叠和选择的多层级树形列表，适用于文件目录、组织架构和分类管理。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface TreeProps<T extends object> extends Omit<AriaTreeProps<T>, "className" | "style"> {
  /**
   * 列表行高与缩进尺寸；`sm` 行高更紧凑、缩进更小，适用于侧边栏或弹层等窄容器。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 是否在各层级左侧显示垂直引导线，帮助在深层结构中辨认父子归属关系。 */
  showGuides?: boolean;
  /** 根元素上的类名。 */
  className?: string;
  /**
   * 拖拽排序回调；传入后每行前方会显示拖动手柄，支持鼠标或键盘调整同级顺序（`before` / `after`）或移入目标节点作为末位子项（`on`）。拖入自身或自身子孙节点时不会触发。
   */
  onMove?: (keys: Key[], target: { key: Key; position: "before" | "after" | "on" }) => void;
  /**
   * 判断节点是否允许作为拖入容器（`position` 为 `on`）；默认仅允许包含子项的节点接收拖入，如需支持拖入空文件夹可返回 `true`。
   */
  canDropInto?: (key: Key) => boolean;
}

/**
 * 多层级树形列表。基于 React Aria Tree 实现，整棵树仅占用一个 `Tab` 焦点位，支持方向键移动、展开与折叠；多选模式下行前自动呈现勾选框，无数据时默认显示“暂无内容”（可通过 `renderEmptyState` 自定义）。
 *
 * @promote items, selectionMode, selectedKeys, defaultSelectedKeys, onSelectionChange, expandedKeys, defaultExpandedKeys, onExpandedChange, onAction, disabledKeys, renderEmptyState
 */
export function Tree<T extends object>({ size = "md", showGuides = false, className, renderEmptyState, onMove, canDropInto, ...props }: TreeProps<T>) {
  const t = useStrings(treeStrings);
  const dragged = useRef<Set<Key>>(new Set());
  // 用 state 存元素：React Aria 先收集集合、之后才渲染出树，第一次 effect 时 ref 可能还是空的
  const [tree, setTree] = useState<HTMLDivElement | null>(null);
  const { direction } = useLocale();
  // →（RTL 时是 ←）在已经展开的行上：移到第一个可用的子项（WAI-ARIA 的树就是这样；React Aria 只负责展开没展开的，
  // 已展开时它在 React 的捕获阶段拦下这个键、什么也不做）。React 的事件挂在根上（Next.js 里根就是 document），
  // 比树元素早，而且 React 处理完时没展开的行已经同步展开了，看不出原来的状态：所以在 window 的捕获阶段
  // （比 document 早）处理，只管焦点在这棵树里的行
  useEffect(() => {
    if (!tree) return;
    const forward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== forward || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const row = e.target as HTMLElement;
      if (!tree.contains(row) || row.getAttribute("role") !== "row" || row.getAttribute("aria-expanded") !== "true") return;
      const level = Number(row.getAttribute("aria-level"));
      const rows = [...tree.querySelectorAll<HTMLElement>("[role=row][data-key]")];
      for (const next of rows.slice(rows.indexOf(row) + 1)) {
        if (Number(next.getAttribute("aria-level")) <= level) return;
        if (next.getAttribute("aria-disabled") !== "true") {
          e.preventDefault();
          e.stopPropagation();
          next.focus();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [direction, tree]);
  const rowOf = (key: Key) => tree?.querySelector<HTMLElement>(`[role=row][data-key="${CSS.escape(String(key))}"]`);
  /** key 是不是 ancestor 自己或它的子孙：往上找层级更小的行（折叠起来的子项不会是放下的目标，不用管） */
  const isWithin = (key: Key, ancestor: Key) => {
    let row = rowOf(key);
    let level = Number(row?.getAttribute("aria-level"));
    while (row) {
      if (row.dataset.key === String(ancestor)) return true;
      let prev = row.previousElementSibling as HTMLElement | null;
      while (prev && !(prev.getAttribute("role") === "row" && prev.dataset.key && Number(prev.getAttribute("aria-level")) < level)) prev = prev.previousElementSibling as HTMLElement | null;
      row = prev;
      level = Number(row?.getAttribute("aria-level"));
    }
    return false;
  };
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => {
      dragged.current = new Set(keys);
      return [...keys].map((key) => ({ "text/plain": rowOf(key)?.querySelector(".ui-tree-item__label")?.textContent || String(key) }));
    },
    getDropOperation: (target) => {
      if (target.type !== "item") return "move";
      // 不能放进自己或自己的子孙里
      if ([...dragged.current].some((k) => isWithin(target.key, k))) return "cancel";
      if (target.dropPosition === "on" && !(canDropInto ? canDropInto(target.key) : rowOf(target.key)?.hasAttribute("aria-expanded"))) return "cancel";
      return "move";
    },
    onMove(e) {
      const target = e.target as DropTarget & { key: Key; dropPosition: "before" | "after" | "on" };
      onMove?.([...e.keys], { key: target.key, position: target.dropPosition });
    },
    renderDragPreview: (items) => (
      <div className="ui-tree__drag-preview">
        <GripIcon />
        <span className="ui-tree__drag-preview-label">{items[0]?.["text/plain"]}</span>
        {items.length > 1 ? <span className="ui-tree__drag-preview-count">+{items.length - 1}</span> : null}
      </div>
    ),
    // 放在两行之间：一条线，缩进到放下后的层级
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className="ui-tree__drop-indicator"
        // React Aria 把放下后的层级写在 --tree-item-level 上：转成本组件的变量
        style={({ defaultStyle }) => ({ ...defaultStyle, "--ui-tree-level": (defaultStyle as Record<string, unknown>)["--tree-item-level"] }) as CSSProperties}
      />
    ),
  });
  return (
    <AriaTree
      {...props}
      // React Aria 只在有 dragAndDropHooks 时调用拖放的 hooks：开关拖动时重新挂载，否则 hooks 顺序会乱
      key={onMove ? "move" : "plain"}
      dragAndDropHooks={onMove ? dragAndDropHooks : props.dragAndDropHooks}
      ref={setTree}
      className={className ? `ui-tree ${className}` : "ui-tree"}
      data-size={size}
      data-guides={showGuides || undefined}
      renderEmptyState={renderEmptyState ?? (() => <div className="ui-tree__empty">{t.empty}</div>)}
    />
  );
}

export interface TreeItemProps extends Omit<AriaTreeItemProps, "children" | "className" | "style" | "textValue"> {
  /** 节点展示内容。 */
  label: ReactNode;
  /** 用于键盘首字母跳转与读屏播报的纯文本；`label` 为纯字符串时可省略。 */
  textValue?: string;
  /** 节点前方的图标（如 `FileIcon`），也支持传入函数按 `isExpanded` 返回展开或收起状态图标。 */
  icon?: ReactNode | ((state: { isExpanded: boolean }) => ReactNode);
  /** 节点末尾的辅助操作区，例如“更多”菜单按钮。 */
  actions?: ReactNode;
  /** 子级 `TreeItem` 列表，或配合数据驱动使用的 React Aria `Collection`。 */
  children?: ReactNode;
}

/**
 * 树形列表节点行。存在子节点时行前展示展开按钮，叶子节点保留等宽占位以保持图标对齐。
 */
export function TreeItem({ label, textValue, icon, actions, children, ...props }: TreeItemProps) {
  return (
    <AriaTreeItem
      {...props}
      textValue={textValue ?? (typeof label === "string" ? label : "")}
      className="ui-tree-item"
      style={({ level }) => ({ "--ui-tree-level": level }) as CSSProperties}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded, selectionMode, selectionBehavior, allowsDragging }) => (
          <>
            {allowsDragging ? (
              // 拖动手柄：鼠标按住拖；键盘聚焦后 Enter 开始拖动，方向键选位置，Enter 放下（React Aria 提供，读屏有说明）
              <AriaButton slot="drag" className="ui-tree-item__drag">
                <GripIcon />
              </AriaButton>
            ) : null}
            {selectionMode === "multiple" && selectionBehavior === "toggle" ? <Checkbox slot="selection" /> : null}
            {hasChildItems ? (
              <AriaButton slot="chevron" className="ui-tree-item__chevron">
                <ChevronRightIcon />
              </AriaButton>
            ) : (
              <span className="ui-tree-item__chevron" aria-hidden="true" />
            )}
            {icon ? (
              <span className="ui-tree-item__icon" aria-hidden="true">
                {typeof icon === "function" ? icon({ isExpanded }) : icon}
              </span>
            ) : null}
            <span className="ui-tree-item__label">{label}</span>
            {actions ? <span className="ui-tree-item__actions">{actions}</span> : null}
          </>
        )}
      </TreeItemContent>
      {children}
    </AriaTreeItem>
  );
}
