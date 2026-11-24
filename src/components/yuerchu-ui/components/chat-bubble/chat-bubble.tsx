"use client";

import type { ComponentProps, ReactElement, ReactNode, Ref } from "react";
import { useCallback, useState } from "react";
import { mergeProps, useFocusWithin, useHover } from "react-aria";
import type { ButtonProps as AriaButtonProps } from "react-aria-components";
import { Button as AriaButton } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./chat-bubble.css";

/**
 * 即时通讯与对话场景的气泡分组与多块气泡原语，支持连续消息的发信侧圆角收紧、吸附底部头像、多块共享底色以及折叠徽标。
 *
 * @packageDocumentation
 * @category AI
 * @status 实验中
 */

export type BubblePosition = "single" | "first" | "middle" | "last";
export type BubbleVariant = "user" | "assistant" | "muted" | "outline" | "ghost" | "destructive";
export type BubbleAlign = "start" | "end";
export type BubbleBlockState =
  | "input-streaming"
  | "input-available"
  | "queued"
  | "output-available"
  | "output-error"
  | "requires-action"
  | "navigate";

/** 同一发信人连续消息与多块气泡内部的统一间距类名（2px）。 */
export const BUBBLE_RUN_GAP = "ui-chat-bubble__run-gap";

/** 气泡内直系块的通用底色与圆角类名，需配合 `data-bubble-block=""` 放在 `Bubble` 直系子级。 */
export const BUBBLE_BLOCK = "ui-chat-bubble__block";

/** 气泡块内部可交互控件（如折叠触发行）使用的悬停浅底类名。 */
export const BUBBLE_BLOCK_HOVER = "ui-chat-bubble__block-hover";

const reportedBuriedBlocks = new Set<string>();

function isProduction(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  return proc?.env?.NODE_ENV === "production";
}

function warnAboutBuriedBlocks(bubble: HTMLElement | null) {
  if (isProduction()) return;
  if (!bubble) return;
  for (const block of bubble.querySelectorAll("[data-bubble-block]")) {
    if (block.parentElement === bubble) continue;
    if (block.closest('[data-slot="bubble"]') !== bubble) continue;
    const slot = block.getAttribute("data-slot") ?? block.tagName.toLowerCase();
    if (reportedBuriedBlocks.has(slot)) continue;
    reportedBuriedBlocks.add(slot);
    console.warn(
      `[chat-bubble] "${slot}" carries data-bubble-block but is not a direct child of its Bubble, ` +
        "so the corner rules cannot reach it. Render it as a sibling of the other blocks.",
    );
  }
}

function joinClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export interface BubbleGroupProps extends ComponentProps<"div"> {
  /** 组内气泡列表。 */
  children?: ReactNode;
  /** 自定义根元素类名。 */
  className?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 承载一组独立气泡的纵向容器。 */
export function BubbleGroup({ className, ref, ...props }: BubbleGroupProps) {
  return <div ref={ref} data-slot="bubble-group" className={joinClass("ui-bubble-group", className)} {...props} />;
}

export interface BubbleProps extends ComponentProps<"div"> {
  /**
   * 气泡视觉变体；决定内部所有块继承的底色、前景色与边框。
   * @default "user"
   */
  variant?: BubbleVariant;
  /**
   * 气泡对齐方向；`start` 靠左，`end` 靠右，发信侧连续块会自动收紧圆角。
   * @default "start"
   */
  align?: BubbleAlign;
  /**
   * 气泡在同一发信人连续消息中的位置，控制顶部与底部发信侧圆角是否收紧。
   * @default "single"
   */
  position?: BubblePosition;
  /** 气泡内的一个或多个直系块（如 `BubbleContent`、工具调用块等）。 */
  children?: ReactNode;
  /** 自定义根元素类名。 */
  className?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 单条消息的气泡容器，支持包含正文、工具调用与输出面板等多个直系块，自动共享底色并在发信侧收紧相邻圆角。
 */
export function Bubble({
  variant = "user",
  align = "start",
  position = "single",
  className,
  ref,
  ...props
}: BubbleProps) {
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      warnAboutBuriedBlocks(node);
      if (typeof ref === "function") ref(node);
      else if (ref && "current" in ref) ref.current = node;
    },
    [ref],
  );
  return (
    <div
      ref={setRef}
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      data-position={position}
      className={joinClass(`ui-chat-bubble ${BUBBLE_RUN_GAP}`, className)}
      {...props}
    />
  );
}

export interface BubbleContentProps extends ComponentProps<"div"> {
  /** 气泡正文内容。 */
  children?: ReactNode;
  /** 自定义渲染函数，用于将气泡块样式应用到链接、语义容器等自定义元素。 */
  render?: (props: ComponentProps<"div"> & { "data-slot": string; "data-bubble-block": string }) => ReactElement;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 气泡内的正文内容块。作为 `Bubble` 直系子级渲染时自动继承变体色并参与圆角收紧。 */
export function BubbleContent({ className, render, ref, ...props }: BubbleContentProps) {
  const domProps = {
    ref,
    "data-slot": "bubble-content",
    "data-bubble-block": "",
    className: joinClass(`${BUBBLE_BLOCK} ui-chat-bubble__content`, className),
    ...props,
  };
  if (render) return render(domProps);
  return <div {...domProps} />;
}

export interface BubbleTimeProps extends ComponentProps<"time"> {
  /** 格式化后的时间文案，例如“10:24”。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLTimeElement>;
}

/** 气泡内右下角的发送时间标记，不可选中以免拖选正文时带入时间。 */
export function BubbleTime({ className, ref, ...props }: BubbleTimeProps) {
  return <time ref={ref} data-slot="bubble-time" className={joinClass("ui-chat-bubble__time", className)} {...props} />;
}

export interface BubbleBlockButtonProps extends Omit<AriaButtonProps, "className" | "children"> {
  /**
   * 按钮块的状态；`requires-action` 与 `navigate` 会占满列宽并带醒目描边。
   * @default "input-available"
   */
  state?: BubbleBlockState;
  /** 按钮内容。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 按钮元素引用。 */
  ref?: Ref<HTMLButtonElement>;
}

/** 气泡内的可点击动作块（如跳转到计划审阅页），与正文和工具块共享同一套底色与圆角规则。 */
export function BubbleBlockButton({ state = "input-available", className, children, ref, ...props }: BubbleBlockButtonProps) {
  return (
    <AriaButton
      ref={ref}
      data-slot="bubble-block-button"
      data-bubble-block=""
      data-state={state}
      className={withUiClass(`${BUBBLE_BLOCK} ui-chat-bubble__block-button`, className)}
      {...props}
    >
      {children}
    </AriaButton>
  );
}

export interface BubbleFoldBadgeProps extends Omit<AriaButtonProps, "className" | "children"> {
  /** 当前折叠内容是否已展开，写入 `aria-expanded` 并同步视觉高亮态。 */
  expanded: boolean;
  /** 徽标文字与图标，例如“已查看 4 个文件”。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 按钮元素引用。 */
  ref?: Ref<HTMLButtonElement>;
}

/** 气泡底部的胶囊状折叠切换徽标，用于展开或收起思考过程、工具摘要或命令输出。 */
export function BubbleFoldBadge({ expanded, className, children, ref, ...props }: BubbleFoldBadgeProps) {
  return (
    <AriaButton
      ref={ref}
      data-slot="bubble-fold-badge"
      aria-expanded={expanded}
      className={withUiClass("ui-chat-bubble__fold-badge", className)}
      {...props}
    >
      {children}
    </AriaButton>
  );
}

export interface MessageGroupProps extends ComponentProps<"div"> {
  /** 连续消息分组内容。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 右对齐的用户连续消息分组，无头像，子气泡以 2px 紧贴排列。 */
export function MessageGroupUser({ className, ref, ...props }: MessageGroupProps) {
  const { hoverProps, isHovered } = useHover({});
  const [isFocusWithin, setFocusWithin] = useState(false);
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusWithin });
  return (
    <div
      {...mergeProps(hoverProps, focusWithinProps, props)}
      ref={ref}
      data-slot="message-group"
      data-align="end"
      data-hovered={isHovered || undefined}
      data-focus-within={isFocusWithin || undefined}
      className={joinClass(`ui-message-group ${BUBBLE_RUN_GAP}`, className)}
    />
  );
}

/** 左对齐的对方 / 助手连续消息分组，与底端吸附的头像并排。 */
export function MessageGroupAssistant({ className, ref, ...props }: MessageGroupProps) {
  const { hoverProps, isHovered } = useHover({});
  const [isFocusWithin, setFocusWithin] = useState(false);
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusWithin });
  return (
    <div
      {...mergeProps(hoverProps, focusWithinProps, props)}
      ref={ref}
      data-slot="message-group"
      data-align="start"
      data-hovered={isHovered || undefined}
      data-focus-within={isFocusWithin || undefined}
      className={joinClass("ui-message-group", className)}
    />
  );
}

/** 连续消息组的单一头像容器，作为 `MessageGroupAssistant` 的直系子级，随长消息吸附在视口底部。 */
export function MessageGroupAvatar({ className, ref, ...props }: MessageGroupProps) {
  return (
    <div
      ref={ref}
      data-slot="message-group-avatar"
      className={joinClass("ui-message-group__avatar", className)}
      {...props}
    />
  );
}

/** 连续消息组内纵向堆叠的气泡列，保持 2px 组内间距。 */
export function MessageGroupBubbles({ className, ref, ...props }: MessageGroupProps) {
  return (
    <div
      ref={ref}
      data-slot="message-group-bubbles"
      className={joinClass(`ui-message-group__bubbles ${BUBBLE_RUN_GAP}`, className)}
      {...props}
    />
  );
}

/** 连续消息首条气泡内的发信人标识（如模型名称或群聊昵称）。 */
export function MessageGroupHeader({ className, ref, ...props }: MessageGroupProps) {
  return (
    <div
      ref={ref}
      data-slot="message-group-header"
      className={joinClass("ui-message-group__header", className)}
      {...props}
    />
  );
}

/** 连续消息组底部的操作栏，桌面端悬停或聚焦时显现，触屏设备常显。 */
export function MessageGroupFooter({ className, ref, ...props }: MessageGroupProps) {
  return (
    <div
      ref={ref}
      data-slot="message-group-footer"
      className={joinClass("ui-message-group__footer", className)}
      {...props}
    />
  );
}
