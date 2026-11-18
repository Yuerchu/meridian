"use client";

import type { ReactNode, Ref } from "react";
import type { TooltipProps as AriaTooltipProps, TooltipTriggerComponentProps } from "react-aria-components";
import { Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./tooltip.css";

/**
 * 提示：悬停或键盘聚焦时，在元素旁边显示一句简短说明，例如图标按钮的名称、快捷键。
 * 代替浏览器原生的 title 提示（组件库禁止 title 属性）。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface TooltipTriggerProps extends TooltipTriggerComponentProps {
  /**
   * 悬停多久后显示（毫秒）。显示过一次后，短时间内移到别的触发器上会立即显示。
   * @default 600
   */
  delay?: number;
  /**
   * 指针离开后多久关闭（毫秒）。这段时间内把指针移到提示上，提示保持打开（WCAG 1.4.13 可悬停）。
   * @default 300
   */
  closeDelay?: number;
}

/**
 * 包住触发元素和 Tooltip。触发元素必须能聚焦（Button、Link 等），键盘用户聚焦时也会显示。
 *
 * @promote isOpen, defaultOpen, onOpenChange, isDisabled, trigger
 */
export function TooltipTrigger({ delay = 600, closeDelay = 300, ...props }: TooltipTriggerProps) {
  return <AriaTooltipTrigger {...props} delay={delay} closeDelay={closeDelay} />;
}

export interface TooltipProps extends Omit<AriaTooltipProps, "children"> {
  /** 提示文字。一句话，不放链接、按钮这类可交互内容。 */
  children?: ReactNode;
  /** 指向提示的 div 元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 提示。基于 React Aria Tooltip：显示时通过 aria-describedby 关联到触发元素；Esc 关闭；
 * 指针可以移到提示上而不消失；触屏上不显示。
 *
 * @promote placement, offset
 */
export function Tooltip({ className, offset = 6, ...props }: TooltipProps) {
  return <AriaTooltip {...props} offset={offset} className={withUiClass("ui-tooltip", className)} />;
}
