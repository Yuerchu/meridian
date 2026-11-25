"use client";

import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { mergeProps, useFocusWithin, useHover } from "react-aria";
import type { PopoverProps as AriaPopoverProps } from "react-aria-components";
import { Popover as AriaPopover } from "react-aria-components";
import "../popover/popover.css";
import "./hover-card.css";

/**
 * 悬停或键盘聚焦触发元素时弹出的非模态预览卡片，用于展示成员资料、链接摘要或来源信息。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

/** 页面上同一时间只开一张卡片；开着一张、或者刚关上时，移到下一个触发元素几乎立刻打开（不再等） */
const WARM_WINDOW = 300;
/** 卡片已经开着时也稍等一下：鼠标经过别的触发元素去够卡片时，不会把卡片抢走 */
const INTENT = 80;

let current: string | null = null;
let closedAt = -Infinity;
const listeners = new Set<() => void>();
const cards = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  get: () => current,
  server: () => null,
  warm: () => current !== null || performance.now() - closedAt < WARM_WINDOW,
  open(id: string) {
    if (current === id) return;
    current = id;
    for (const fn of listeners) fn();
  },
  close(id: string) {
    if (current !== id) return;
    current = null;
    closedAt = performance.now();
    for (const fn of listeners) fn();
  },
};

export interface HoverCardProps {
  /** 触发卡片的可聚焦元素（如 `Link` 或 `Button`）；卡片打开时会自动为其添加 `aria-describedby` 关联。 */
  children: ReactElement<{ "aria-describedby"?: string }>;
  /** 卡片内部展示的只读预览内容；由于焦点不会进入卡片，请勿放入需要键盘操作的链接或按钮。 */
  content: ReactNode;
  /**
   * 卡片相对于触发元素的弹出位置，可用空间不足时会自动翻转到对侧。
   * @default "bottom start"
   */
  placement?: AriaPopoverProps["placement"];
  /**
   * 鼠标悬停后等待打开的延迟时间（毫秒）；同一页面刚开过其他卡片时会缩短等待时间。
   * @default 500
   */
  openDelay?: number;
  /**
   * 鼠标移出后延迟关闭的时间（毫秒），用于留出指针从触发元素移动到卡片上的缓冲时间。
   * @default 150
   */
  closeDelay?: number;
  /** 附加到卡片根元素的自定义类名。 */
  className?: string;
}

/**
 * 非模态悬停预览卡片，不会抢占焦点或遮挡页面其他区域。
 * 鼠标移入卡片内容区时保持打开，按 Esc 或移出后延迟关闭；触屏设备不会触发悬停打开，请勿将关键信息仅放在卡片中。
 */
export function HoverCard({ children, content, placement = "bottom start", openDelay = 500, closeDelay = 150, className }: HoverCardProps) {
  const id = useId();
  const cardId = `${id}-card`;
  const isOpen = useSyncExternalStore(cards.subscribe, cards.get, cards.server) === id;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timers = useRef({ open: 0, close: 0 });
  const inside = useRef({ trigger: false, card: false, focus: false });
  // 按 Esc 关掉后，鼠标还停在触发元素上也不要马上又打开
  const dismissed = useRef(false);

  const clearTimers = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  };
  const scheduleOpen = () => {
    window.clearTimeout(timers.current.close);
    if (dismissed.current || cards.get() === id) return;
    window.clearTimeout(timers.current.open);
    timers.current.open = window.setTimeout(() => cards.open(id), cards.warm() ? INTENT : openDelay);
  };
  const scheduleClose = () => {
    window.clearTimeout(timers.current.open);
    const { trigger, card, focus } = inside.current;
    if (trigger || card || focus) return;
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => cards.close(id), closeDelay);
  };

  useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.open);
      window.clearTimeout(pending.close);
      cards.close(id);
    };
  }, [id]);

  // 焦点不在卡片里（非模态），Esc 由这里处理
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dismissed.current = true;
      clearTimers();
      cards.close(id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, id]);

  // useHover 只响应鼠标和触控笔：触屏上不打开
  const { hoverProps: triggerHover } = useHover({
    onHoverStart: () => {
      inside.current.trigger = true;
      scheduleOpen();
    },
    onHoverEnd: () => {
      inside.current.trigger = false;
      dismissed.current = false;
      scheduleClose();
    },
  });
  const { focusWithinProps } = useFocusWithin({
    onFocusWithinChange: (focused) => {
      // 只响应键盘聚焦：鼠标点链接时不弹卡片
      const target = triggerRef.current?.querySelector(":focus-visible");
      if (focused && target) {
        inside.current.focus = true;
        dismissed.current = false;
        clearTimers();
        cards.open(id);
      } else if (!focused) {
        inside.current.focus = false;
        scheduleClose();
      }
    },
  });
  const { hoverProps: cardHover } = useHover({
    onHoverStart: () => {
      inside.current.card = true;
      window.clearTimeout(timers.current.close);
    },
    onHoverEnd: () => {
      inside.current.card = false;
      scheduleClose();
    },
  });

  const describedBy = [children.props["aria-describedby"], isOpen ? cardId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <span ref={triggerRef} className="ui-hover-card__trigger" {...mergeProps(triggerHover, focusWithinProps)}>
        {isValidElement(children) ? cloneElement(children, { "aria-describedby": describedBy }) : children}
      </span>
      <AriaPopover
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) cards.close(id);
        }}
        isNonModal
        placement={placement}
        offset={8}
        className={className ? `ui-popover ui-hover-card ${className}` : "ui-popover ui-hover-card"}
      >
        <div id={cardId} role="tooltip" className="ui-hover-card__content" {...cardHover}>
          {content}
        </div>
      </AriaPopover>
    </>
  );
}
