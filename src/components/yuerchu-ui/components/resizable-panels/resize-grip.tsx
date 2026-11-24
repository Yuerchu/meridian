"use client";

/*
 * 拖动调整大小的把手（ResizablePanels 的分隔条、Table 的列宽）：
 * - 悬停 / 键盘聚焦：分隔线中间出现一个小白条
 * - 拖动：白条变宽，里面是指向拖动方向的箭头
 * - 拖到最小 / 最大还往外拖：白条不变，里面的箭头合拢成一条竖线，表示到头了
 * 只负责样子（aria-hidden，不接收指针）；拖动和键盘由外面的元素处理。
 */
import { useEffect, useState } from "react";

/** 拖动方向：start 是左（上），end 是右（下）。按屏幕方向，和文字方向无关 */
export type GripDirection = "start" | "end";

/** 拖动期间记下最近一次移动的方向（指针移动或方向键），不拖时为 undefined */
export function useGripDirection(active: boolean, orientation: "horizontal" | "vertical" = "horizontal"): GripDirection | undefined {
  const [direction, setDirection] = useState<GripDirection>();
  useEffect(() => {
    if (!active) {
      setDirection(undefined);
      return;
    }
    const horizontal = orientation === "horizontal";
    const onMove = (e: PointerEvent) => {
      const d = horizontal ? e.movementX : e.movementY;
      if (d) setDirection(d < 0 ? "start" : "end");
    };
    const onKey = (e: KeyboardEvent) => {
      const back = horizontal ? "ArrowLeft" : "ArrowUp";
      const forward = horizontal ? "ArrowRight" : "ArrowDown";
      if (e.key === back) setDirection("start");
      else if (e.key === forward) setDirection("end");
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, orientation]);
  return direction;
}

export interface ResizeGripProps {
  /** 显示白条（悬停、聚焦时）。 */
  isVisible?: boolean;
  /** 正在拖动（或键盘调整中）。 */
  isActive?: boolean;
  /** 键盘焦点在把手上：白条画焦点环。 */
  isFocusVisible?: boolean;
  /** 最近一次拖动的方向。 */
  direction?: GripDirection;
  /** 已经到头的那一边：往这边拖时箭头合拢成竖线。 */
  limit?: GripDirection;
  orientation?: "horizontal" | "vertical";
}

export function ResizeGrip({ isVisible, isActive, isFocusVisible, direction, limit, orientation = "horizontal" }: ResizeGripProps) {
  const blocked = isActive && direction != null && direction === limit;
  return (
    <span
      aria-hidden
      className="ui-resize-grip"
      data-orientation={orientation}
      data-visible={isVisible || isActive || undefined}
      data-active={(isActive && direction != null) || undefined}
      data-direction={direction}
      data-blocked={blocked || undefined}
      data-focus-visible={isFocusVisible || undefined}
    >
      <span className="ui-resize-grip__arrow">
        <span />
        <span />
      </span>
    </span>
  );
}
