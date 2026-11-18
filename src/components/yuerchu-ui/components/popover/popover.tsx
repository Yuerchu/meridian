"use client";

import type { ReactNode, Ref } from "react";
import type { PopoverProps as AriaPopoverProps } from "react-aria-components";
import { Popover as AriaPopover } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./popover.css";

/**
 * 弹层外壳：定位、进退场动画、圆角和阴影。Select、Menu、ComboBox 的下拉部分都用它。
 * 一般不直接使用；需要点击后弹出一块自定义内容时，配合 DialogTrigger 使用。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface PopoverProps extends Omit<AriaPopoverProps, "children"> {
  /** 弹层内容。 */
  children?: ReactNode;
  /** 指向弹层的 div 元素。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 弹层。基于 React Aria Popover：自动定位和翻转、点外面或按 Esc 关闭、关闭后焦点回到触发器。
 * 进场从触发器方向淡入并移动 --enter-distance，退场更快（--dur-fast）。
 *
 * @promote placement, offset, isOpen, onOpenChange, triggerRef
 */
export function Popover({ className, ...props }: PopoverProps) {
  // offset 不设默认值：子菜单的弹层位置由 React Aria 通过上下文给出，这里写死会覆盖它
  return <AriaPopover {...props} className={withUiClass("ui-popover", className)} />;
}
