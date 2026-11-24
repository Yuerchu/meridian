"use client";

import type { ReactNode, Ref } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { mergeProps, mergeRefs, useFocusRing, useHover, useKeyboard, useMove, usePress } from "react-aria";
import type { GripDirection } from "./resize-grip";
import { ResizeGrip, useGripDirection } from "./resize-grip";
import { useStrings } from "../../lib/i18n";
import { resizablePanelsStrings } from "./resizable-panels.strings";
import "./resizable-panels.css";

/**
 * 支持通过拖拽或键盘调节两块相邻区域尺寸比例的分栏容器，适用于左右双栏或上下分栏布局。
 *
 * @packageDocumentation
 * @category 布局
 * @status 实验中
 */

/** 键盘每按一下调整多少（百分比） */
const STEP = 5;
/** 拖过头多少像素时，分隔条走到上限的一半（上限是 CSS 的 --ui-resizable-stretch） */
const OVERDRAG_HALF = 40;

export interface ResizablePanelsProps {
  /** 需要分栏展示的两块内容，按顺序对应左/右或上/下两块面板。 */
  children: [ReactNode, ReactNode];
  /**
   * 分栏排列方向；`horizontal` 为左右并排，`vertical` 为上下排列。
   * @default "horizontal"
   */
  orientation?: "horizontal" | "vertical";
  /**
   * 第一块面板的初始比例（百分比），双击分隔条会重置为该值。
   * @default 50
   */
  defaultSize?: number;
  /** 第一块面板的受控比例（百分比）。 */
  size?: number;
  /** 面板比例变化时触发的回调函数。 */
  onSizeChange?: (size: number) => void;
  /**
   * 第一块面板允许缩小的最小比例（百分比）。
   * @default 15
   */
  minSize?: number;
  /**
   * 第一块面板允许扩展的最大比例（百分比）。
   * @default 85
   */
  maxSize?: number;
  /** 用于持久化面板比例的 `localStorage` 键名，传入后会在本地保存并在下次打开时自动恢复。 */
  storageKey?: string;
  /**
   * 分隔条的无障碍名称，用于说明当前调节的目标区域。
   * @default "调整大小"（英文界面 "Resize"）
   */
  "aria-label"?: string;
  /** 自定义类名。 */
  className?: string;
  /** 指向根容器元素的 ref。 */
  ref?: Ref<HTMLDivElement>;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function readStored(key: string | undefined): number | undefined {
  if (!key) return undefined;
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 包含两块可调节面板的容器组件，支持指针拖拽、键盘微调（每次 5%）、Home/End 跳至极值、Enter 折叠恢复以及双击重置为默认比例。
 */
export function ResizablePanels({
  children,
  orientation = "horizontal",
  defaultSize = 50,
  size,
  onSizeChange,
  minSize = 15,
  maxSize = 85,
  storageKey,
  "aria-label": ariaLabelProp,
  className,
  ref,
}: ResizablePanelsProps) {
  const t = useStrings(resizablePanelsStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const [own, setOwn] = useState(defaultSize);
  const current = clamp(size ?? own, minSize, maxSize);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstId = useId();
  const beforeCollapse = useRef<number | null>(null);
  const horizontal = orientation === "horizontal";

  // 挂载后再读存下的大小：服务端不知道，先用默认值渲染，避免水合不一致
  useEffect(() => {
    const stored = readStored(storageKey);
    if (stored !== undefined && size === undefined) setOwn(clamp(stored, minSize, maxSize));
  }, [storageKey, size, minSize, maxSize]);

  const set = (next: number) => {
    const v = Math.round(clamp(next, minSize, maxSize) * 10) / 10;
    if (size === undefined) setOwn(v);
    onSizeChange?.(v);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(v));
      } catch {
        // 存不了（隐私模式等）就算了
      }
    }
  };

  // 拖动：useMove 给出像素的位移，按容器大小换算成百分比；键盘方向键也走这里（每次 STEP）
  const start = useRef(current);
  const moved = useRef(0);
  // 双击（两次按下没有移动、间隔不到 300 毫秒）回到默认大小
  const lastTap = useRef(0);
  const [isDragging, setDragging] = useState(false);
  // 拖到最小 / 最大还往外拖：分隔条不是原地停住，而是带着阻力多走一小段，拖得越远越走不动，松手弹回。
  // 越界量写进 --ui-resizable-over（-1~1，正的是往右 / 往下），走多远由 CSS 按 --ui-resizable-stretch 算，减弱动效时不动。
  // 直接改根元素的属性，不触发重新渲染（拖动时每帧都在变）；往哪边越界记在 overSide 里，只在变的时候渲染
  const [overSide, setOverSide] = useState<GripDirection>();
  const stretch = (px: number) => {
    const el = containerRef.current;
    if (!el) return;
    if (px === 0) el.style.removeProperty("--ui-resizable-over");
    else el.style.setProperty("--ui-resizable-over", (Math.sign(px) * (1 - 1 / (Math.abs(px) / OVERDRAG_HALF + 1))).toFixed(3));
    setOverSide(px === 0 ? undefined : px < 0 ? "start" : "end");
  };
  const { moveProps } = useMove({
    onMoveStart(e) {
      start.current = current;
      moved.current = 0;
      containerRef.current?.removeAttribute("data-settling");
      if (e.pointerType !== "keyboard") setDragging(true);
    },
    onMoveEnd() {
      setDragging(false);
      const el = containerRef.current;
      if (!el?.style.getPropertyValue("--ui-resizable-over")) return;
      // 弹回：只在这一下给大小加过渡（data-settling），过渡结束后去掉；平时改大小（键盘、双击、读到存下的大小）不加过渡。
      // 要先加上再清越界量，所以直接改属性，不走渲染
      el.setAttribute("data-settling", "");
      stretch(0);
      // 减弱动效时没有过渡（不会有 transitionend）：直接去掉
      if (!parseFloat(getComputedStyle(el).transitionDuration)) el.removeAttribute("data-settling");
    },

    onMove(e) {
      const el = containerRef.current;
      if (!el) return;
      const delta = horizontal ? e.deltaX : e.deltaY;
      if (e.pointerType === "keyboard") {
        // 只认这个方向的方向键（左右分栏时上下键不管用）
        if (delta === 0) return;
        set(current + Math.sign(delta) * STEP);
        return;
      }
      moved.current += delta;
      const total = horizontal ? el.clientWidth : el.clientHeight;
      if (total <= 0) return;
      const wanted = start.current + (moved.current / total) * 100;
      set(wanted);
      stretch(((wanted - clamp(wanted, minSize, maxSize)) / 100) * total);
    },
  });
  const { keyboardProps } = useKeyboard({
    onKeyDown(e) {
      if (e.key === "Home") set(minSize);
      else if (e.key === "End") set(maxSize);
      else if (e.key === "Enter") {
        // 折叠到最小；再按一次恢复
        if (beforeCollapse.current !== null && current === minSize) {
          set(beforeCollapse.current);
          beforeCollapse.current = null;
        } else {
          beforeCollapse.current = current;
          set(minSize);
        }
      } else e.continuePropagation();
    },
  });
  const { focusProps, isFocusVisible } = useFocusRing();
  // 键盘调整时也显示箭头：聚焦期间按方向键算作在拖
  // 拖过头期间方向就是越界的那一边：手抖着往回挪一两个像素，指针还在界外，不算掉头
  const moving = useGripDirection(isDragging || isFocusVisible, orientation);
  const direction = overSide ?? moving;
  const limit = current <= minSize ? "start" : current >= maxSize ? "end" : undefined;
  const { hoverProps, isHovered } = useHover({});
  // 只按下、没拖动的点击（useMove 不会触发）
  const { pressProps } = usePress({
    onPress(e) {
      if (e.pointerType === "keyboard") return;
      const now = performance.now();
      if (now - lastTap.current < 300) {
        set(defaultSize);
        lastTap.current = 0;
      } else lastTap.current = now;
    },
  });

  // 第一块的大小：百分比，加上拖过头时多走的那一段
  const first = `calc(${current}% + var(--ui-resizable-over, 0) * var(--ui-resizable-stretch))`;
  return (
    <div
      ref={mergeRefs(ref, containerRef)}
      className={className ? `ui-resizable ${className}` : "ui-resizable"}
      data-orientation={orientation}
      style={{ gridTemplateColumns: horizontal ? `${first} auto minmax(0, 1fr)` : undefined, gridTemplateRows: horizontal ? undefined : `${first} auto minmax(0, 1fr)` }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.removeAttribute("data-settling");
      }}
    >
      <div id={firstId} className="ui-resizable__panel">
        {children[0]}
      </div>
      <div
        {...mergeProps(moveProps, pressProps, keyboardProps, focusProps, hoverProps)}
        role="separator"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-controls={firstId}
        aria-valuenow={Math.round(current)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        className="ui-resizable__handle"
        data-focus-visible={isFocusVisible || undefined}
        data-hovered={isHovered || undefined}
      >
        <ResizeGrip isVisible={isHovered || isFocusVisible} isActive={isDragging || isFocusVisible} direction={direction} limit={limit} orientation={orientation} />
      </div>
      <div className="ui-resizable__panel">{children[1]}</div>
    </div>
  );
}
