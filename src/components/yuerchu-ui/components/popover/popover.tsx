"use client";

import type { ReactNode, Ref } from "react";
import type { PopoverProps as AriaPopoverProps } from "react-aria-components";
import { Popover as AriaPopover } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./popover.css";

/**
 * 为触发元素提供自动定位、边界翻转与进退场过渡的弹出层容器，用于承载快捷面板或作为下拉组件外壳。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface PopoverProps extends Omit<AriaPopoverProps, "children"> {
  /** 弹层内部展示的内容。 */
  children?: ReactNode;
  /** 指向弹层根元素的引用。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 基于 React Aria Popover 封装，支持自动定位翻转、点击外部或按 Esc 关闭并将焦点归还触发器。
 *
 * @promote placement, offset, isOpen, onOpenChange, triggerRef
 */
export function Popover({ className, ...props }: PopoverProps) {
  // offset 不设默认值：子菜单的弹层位置由 React Aria 通过上下文给出，这里写死会覆盖它
  return <AriaPopover {...props} className={withUiClass("ui-popover", className)} />;
}
