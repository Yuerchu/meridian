"use client";

import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { ReactNode, Ref } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Toolbar } from "react-aria-components";
import { announce } from "../../lib/announce";
import { useStrings } from "../../lib/i18n";
import { useMotionTokens } from "../../lib/motion";
import { Button } from "../button/button";
import { selectionBarStrings } from "./selection-bar.strings";
import "./selection-bar.css";

/**
 * 配合列表、网格或数据表格使用的多选批量操作栏，选中项目后显示已选数量、批量操作按钮与清除按钮，清空后自动收起。DataTable 的 bulkActions 已内置复用该组件。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface SelectionBarProps {
  /** 当前选中的项目数量，大于 0 时显示操作栏，归零后收起。 */
  selectedCount: number;
  /** 批量操作按钮，通常搭配小号 Button（size="sm"）。 */
  children: ReactNode;
  /** 点击“清除选择”按钮时的回调，用于清空已选项并将 selectedCount 归零。 */
  onClear: () => void;
  /**
   * 布局位置。bottom 为集合下方的局部吸底浮栏，inline 为占据原位高度的常规工具栏。
   * @default "bottom"
   */
  placement?: "bottom" | "inline";
  /**
   * 工具栏的无障碍名称。
   * @default "批量操作"（英文界面 "Bulk actions"）
   */
  "aria-label"?: string;
  /** 操作栏收起且焦点仍在栏内时，用于返回需要恢复焦点的集合元素。 */
  getFocusTarget?: () => HTMLElement | null;
  /** 根元素附加类名。 */
  className?: string;
  /** 指向根元素的引用；bottom 布局下根元素保留实际文档流高度，避免遮挡集合最后一项。 */
  ref?: Ref<HTMLDivElement>;
}

/** 基于 React Aria Toolbar 实现的多选操作栏，整条工具栏占用一个 Tab 停靠点，按左右方向键在操作间切换。 */
export function SelectionBar({
  selectedCount,
  children,
  onClear,
  placement = "bottom",
  "aria-label": ariaLabelProp,
  getFocusTarget,
  className,
  ref,
}: SelectionBarProps) {
  const t = useStrings(selectionBarStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const selectedLabel = t.selected({ count: selectedCount });
  const visible = selectedCount > 0;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(selectedCount);
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (previousCount.current === selectedCount) return;
    previousCount.current = selectedCount;
    announce(selectedCount > 0 ? selectedLabel : t.selectionCleared);
  }, [selectedCount, selectedLabel, t.selectionCleared]);

  useLayoutEffect(() => {
    if (wasVisible.current && !visible) {
      const active = document.activeElement;
      if (active && toolbarRef.current?.contains(active)) getFocusTarget?.()?.focus({ preventScroll: true });
    }
    wasVisible.current = visible;
  }, [visible, getFocusTarget]);

  return (
    <div
      ref={ref}
      className={className ? `ui-selection-bar ${className}` : "ui-selection-bar"}
      data-placement={placement}
    >
      <AnimatePresence initial={false}>
        {visible ? (
          <SelectionBarPanel
            key="selection"
            ref={toolbarRef}
            ariaLabel={ariaLabel}
            countLabel={selectedLabel}
            clearLabel={t.clearSelection}
            onClear={onClear}
          >
            {children}
          </SelectionBarPanel>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface SelectionBarPanelProps {
  ariaLabel: string;
  countLabel: string;
  clearLabel: string;
  onClear: () => void;
  children: ReactNode;
  ref: Ref<HTMLDivElement>;
}

function SelectionBarPanel({ ariaLabel, countLabel, clearLabel, onClear, children, ref }: SelectionBarPanelProps) {
  const m = useMotionTokens();
  const isPresent = useIsPresent();
  return (
    <motion.div
      className="ui-selection-bar__surface"
      initial={{ opacity: 0, y: m.enterDistance }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: m.enterDistance, transition: { duration: m.duration.fast, ease: m.ease.exit } }}
      transition={{ duration: m.duration.standard, ease: m.ease.enter }}
      aria-hidden={!isPresent}
      data-exiting={isPresent ? null : ""}
      inert={!isPresent}
    >
      <Toolbar ref={ref} aria-label={ariaLabel} className="ui-selection-bar__toolbar">
        <span className="ui-selection-bar__count">{countLabel}</span>
        <div className="ui-selection-bar__actions">{children}</div>
        <Button variant="ghost" size="sm" onPress={onClear}>
          {clearLabel}
        </Button>
      </Toolbar>
    </motion.div>
  );
}
