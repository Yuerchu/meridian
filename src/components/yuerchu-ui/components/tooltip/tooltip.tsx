"use client";

import type { ReactNode, Ref } from "react";
import type { TooltipProps as AriaTooltipProps, TooltipTriggerComponentProps } from "react-aria-components";
import { Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./tooltip.css";

/**
 * 指针悬停或键盘聚焦时在触发元素旁展示的简短文字提示，用于补充图标按钮名称或快捷键说明。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface TooltipTriggerProps extends TooltipTriggerComponentProps {
  /**
   * 指针悬停后延迟显示提示的时间（毫秒）；刚显示过一次后短时间内移至其他触发器会立即显示。
   * @default 600
   */
  delay?: number;
  /**
   * 指针离开触发元素后保持打开的缓冲时间（毫秒），便于指针移入提示框（满足 WCAG 1.4.13）。
   * @default 300
   */
  closeDelay?: number;
}

/**
 * 包裹触发元素与 Tooltip，要求触发元素本身可聚焦。
 *
 * @promote isOpen, defaultOpen, onOpenChange, isDisabled, trigger
 */
export function TooltipTrigger({ delay = 600, closeDelay = 300, ...props }: TooltipTriggerProps) {
  return <AriaTooltipTrigger {...props} delay={delay} closeDelay={closeDelay} />;
}

export interface TooltipProps extends Omit<AriaTooltipProps, "children"> {
  /** 简短的纯文本提示内容，不要在其中放置链接或按钮等可交互元素。 */
  children?: ReactNode;
  /** 指向提示框根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 基于 React Aria Tooltip 封装，显示时通过 aria-describedby 关联触发元素，支持 Esc 关闭与指针移入保持，触屏设备不显示。
 *
 * @promote placement, offset
 */
export function Tooltip({ className, offset = 6, ...props }: TooltipProps) {
  return <AriaTooltip {...props} offset={offset} className={withUiClass("ui-tooltip", className)} />;
}
