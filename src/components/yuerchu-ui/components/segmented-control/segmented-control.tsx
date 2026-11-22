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
 * 用于在两到五个互斥选项之间切换并立即生效的分段选择控件，例如视图切换或界面主题选择。
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
  /** 包含若干 Segment 选项。 */
  children?: ReactNode;
  /** 当前选中项的 id（受控）。 */
  selectedKey?: Key;
  /** 默认选中项的 id（非受控）。 */
  defaultSelectedKey?: Key;
  /** 选中项变化时触发的回调。 */
  onSelectionChange?: (key: Key) => void;
  /**
   * 控件尺寸，对应标准小号与中号控件高度。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 基于单选且不可取消的 ToggleButtonGroup 封装，提供滑动指示器与溢出横向滚动支持，使用时需传入 aria-label。
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
  /** 选项唯一标识，与 SegmentedControl 的 selectedKey 对应。 */
  id: Key;
  /** 选项显示文字；若仅展示图标，则必须传入 aria-label。 */
  children?: ReactNode;
  /** 文字前置的装饰图标。 */
  icon?: ReactNode;
}

/**
 * 分段控件内的单个选项。
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
