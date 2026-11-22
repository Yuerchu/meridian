"use client";

import type { DOMAttributes, ReactElement } from "react";
import { cloneElement } from "react";
import { MenuTrigger, Pressable } from "react-aria-components";
import "./context-menu.css";

/**
 * 在目标元素上通过鼠标右键、触屏长按或键盘快捷键打开操作菜单。
 * 菜单外观与交互沿用 `Menu`，界面中仍需为关键操作保留显式的按钮或常规菜单入口。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface ContextMenuTriggerProps {
  /**
   * 传入两个子元素：第一个为可聚焦的交互目标（如 Button 或 Link），第二个为 Menu 组件。
   */
  children: [ReactElement<{ className?: string }>, ReactElement];
  /** 是否打开菜单（受控）。 */
  isOpen?: boolean;
  /** 菜单打开或关闭状态变化时的回调。 */
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * 右键菜单触发器，支持鼠标右键、Mac 下的 Control + 点击、触屏长按以及聚焦后按 Shift + F10（Mac 为 Control + Enter）。
 * 菜单打开后在菜单外部再次点击右键，会自动关闭当前菜单以还原浏览器默认右键行为。
 */
export function ContextMenuTrigger({ children, isOpen, onOpenChange }: ContextMenuTriggerProps) {
  const [target, menu] = children;
  // 目标元素加上类名：长按时不选中文字、不弹系统菜单（见 CSS）
  const className = [target.props.className, "ui-context-menu-target"].filter(Boolean).join(" ");
  return (
    <MenuTrigger trigger="contextMenu" isOpen={isOpen} onOpenChange={onOpenChange}>
      {/* Pressable 的类型只接受原生元素；Button、Link 这类组件同样会把属性和 ref 传到原生元素上 */}
      <Pressable>{cloneElement(target, { className }) as ReactElement<DOMAttributes<Element>, string>}</Pressable>
      {menu}
    </MenuTrigger>
  );
}
