"use client";

import type { ReactNode, Ref } from "react";
import { useRef } from "react";
import type { Key, ToggleButtonGroupProps, ToggleButtonProps } from "react-aria-components";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { useRevealSelected, useScrollEdges } from "../../lib/scroll-edges";
import { useSlidingIndicator } from "../../lib/sliding-indicator";
import "./segmented-control.css";

/**
 * 分段控件：在两到五个互斥的选项里选一个，立即生效，例如"列表 / 看板""亮色 / 暗色 / 跟随系统"。
 * 切换的是带独立面板的内容时用 Tabs；选项多或者需要放进表单时用 RadioGroup 或 Select。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface SegmentedControlProps
  extends Omit<
    ToggleButtonGroupProps,
    "children" | "selectionMode" | "selectedKeys" | "defaultSelectedKeys" | "onSelectionChange" | "disallowEmptySelection"
  > {
  /** 若干 Segment。 */
  children?: ReactNode;
  /** 当前选中项的 id（受控）。 */
  selectedKey?: Key;
  /** 默认选中项的 id（非受控）。 */
  defaultSelectedKey?: Key;
  /** 选中项变化时调用。 */
  onSelectionChange?: (key: Key) => void;
  /**
   * 尺寸，对应控件高度 --control-sm / --control-md。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 分段控件。基于 React Aria ToggleButtonGroup（单选、不能取消）：读屏读成一组单选按钮，
 * 方向键在选项之间移动。选中项是灰色底槽上浮起的白块（同 Tabs pill）。必须写 aria-label。
 *
 * @promote aria-label, isDisabled, orientation
 */
export function SegmentedControl({
  selectedKey,
  defaultSelectedKey,
  onSelectionChange,
  size = "md",
  className,
  children,
  ...props
}: SegmentedControlProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(containerRef, indicatorRef, {
    itemSelector: ".ui-segment",
    selectedSelector: ".ui-segment[data-selected]",
    selectedAttribute: "data-selected",
  });
  // 放不下时（容器太窄、选项太多或太长）在控件里横向滚动，不撑出容器：两端渐隐，选中的、聚焦的选项滚进来
  useScrollEdges(containerRef);
  useRevealSelected(containerRef, { item: ".ui-segment", selected: ".ui-segment[data-selected]", attribute: "data-selected", margin: FADE });

  return (
    <ToggleButtonGroup
      {...props}
      ref={containerRef}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={selectedKey === undefined ? undefined : [selectedKey]}
      defaultSelectedKeys={defaultSelectedKey === undefined ? undefined : [defaultSelectedKey]}
      onSelectionChange={(keys) => {
        const [key] = keys;
        if (key !== undefined) onSelectionChange?.(key);
      }}
      className={withUiClass("ui-segmented-control", className)}
      data-size={size}
    >
      <span ref={indicatorRef} className="ui-segmented-control__indicator" aria-hidden="true" hidden />
      {children}
    </ToggleButtonGroup>
  );
}

/** 渐隐区域的宽度（和 segmented-control.css 里的 --ui-segmented-fade 一致） */
const FADE = 24;

export interface SegmentProps extends Omit<ToggleButtonProps, "children" | "isSelected" | "defaultSelected" | "onChange"> {
  /** 选项的 id，和 SegmentedControl 的 selectedKey 对应。 */
  id: Key;
  /** 选项文字。只有图标时写 aria-label。 */
  children?: ReactNode;
  /** 文字前的图标，只做装饰。 */
  icon?: ReactNode;
}

/**
 * 一个选项。
 */
export function Segment({ children, icon, className, ...props }: SegmentProps) {
  return (
    <ToggleButton {...props} className={withUiClass("ui-segment", className)}>
      {icon ? (
        <span className="ui-segment__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children ? <span className="ui-segment__label">{children}</span> : null}
    </ToggleButton>
  );
}
