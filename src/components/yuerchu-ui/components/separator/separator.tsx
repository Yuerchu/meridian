"use client";

import type { ReactNode } from "react";
import type { SeparatorProps as AriaSeparatorProps } from "react-aria-components";
import { Separator as AriaSeparator } from "react-aria-components";
import "./separator.css";

/**
 * 分隔线：把一组内容和另一组隔开，例如设置页的不同区块、工具栏里的按钮组。
 * 菜单里用 MenuSeparator；只是想留白时用间距，不要用分隔线。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface SeparatorProps extends Omit<AriaSeparatorProps, "className"> {
  /**
   * 方向。horizontal 是横线（渲染成 hr）；vertical 是竖线，用在一行里（例如工具栏）。
   * @default "horizontal"
   */
  orientation?: "horizontal" | "vertical";
  /** 线中间的文字，例如登录页里的"或"。只用于横线；有文字时两边的线是装饰，读屏只读文字。 */
  label?: ReactNode;
  /**
   * 文字的位置。start 靠左（用作区块的小标题），center 居中，end 靠右。
   * @default "center"
   */
  labelAlign?: "start" | "center" | "end";
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 分隔线。读屏读成"分隔符"；纯装饰、不代表内容分组时，在外面直接用边框，不要用这个组件。
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
