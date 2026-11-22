"use client";

import type { ReactNode } from "react";
import type { SeparatorProps as AriaSeparatorProps } from "react-aria-components";
import { Separator as AriaSeparator } from "react-aria-components";
import "./separator.css";

/**
 * 用于在页面区块或工具栏中分隔不同内容组，支持横向带文字标签与竖向行内分隔模式。
 * 菜单内部请使用 MenuSeparator；仅作留白时优先采用间距而非画线。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface SeparatorProps extends Omit<AriaSeparatorProps, "className"> {
  /**
   * 分隔方向：`horizontal` 渲染为横向分隔线（`<hr>`），`vertical` 用于工具栏等横向排列的容器内。
   * @default "horizontal"
   */
  orientation?: "horizontal" | "vertical";
  /** 显示在横向分隔线中间的文字（如登录方式之间的“或”）；存在文字时两侧线条仅作装饰，读屏只读出文字。 */
  label?: ReactNode;
  /**
   * 文字标签的水平对齐位置：`start` 靠左（可作为区块小标题），`center` 居中，`end` 靠右。
   * @default "center"
   */
  labelAlign?: "start" | "center" | "end";
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 语义化分隔线，屏幕阅读器会将其播报为“分隔符”；若仅作纯视觉修饰而无内容分组含义，建议直接使用容器边框。
 */
export function Separator({ orientation = "horizontal", label, labelAlign = "center", className, ...props }: SeparatorProps) {
  if (label != null && orientation === "horizontal") {
    // hr 里不能放文字：换成一行，两边的线用伪元素画（装饰），中间的文字读屏正常读
    return (
      <div className={className ? `ui-separator ${className}` : "ui-separator"} data-orientation="horizontal" data-labeled="" data-label-align={labelAlign}>
        <span className="ui-separator__label">{label}</span>
      </div>
    );
  }
  return (
    <AriaSeparator
      {...props}
      orientation={orientation}
      className={className ? `ui-separator ${className}` : "ui-separator"}
      data-orientation={orientation}
    />
  );
}
