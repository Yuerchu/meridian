"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import { useFocusRing } from "react-aria";
import "./scroll-area.css";

/**
 * 提供固定高度或宽度的局部滚动容器，并以统一的细滚动条呈现溢出内容。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface ScrollAreaProps {
  /** 需要包裹在滚动区域内的内容。 */
  children?: ReactNode;
  /** 滚动区域的读屏名称；传入后区域可被键盘聚焦并用方向键滚动，内容不含可聚焦元素时必须提供。 */
  "aria-label"?: string;
  /**
   * 滚动方向。
   * @default "vertical"
   */
  orientation?: "vertical" | "horizontal" | "both";
  /** 容器最大高度，支持像素数值或 CSS 长度字符串（例如 `320` 或 `"50dvh"`）。 */
  maxHeight?: number | string;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 带细滚动条与边界防穿透处理的局部滚动容器；传入 `aria-label` 时渲染为可聚焦的 `region` 区域，保障键盘滚动访问。
 */
export function ScrollArea({ children, "aria-label": ariaLabel, orientation = "vertical", maxHeight, className, ref }: ScrollAreaProps) {
  const { focusProps, isFocusVisible } = useFocusRing();
  const style = maxHeight === undefined ? undefined : ({ maxHeight } as CSSProperties);
  const cls = className ? `ui-scroll-area ${className}` : "ui-scroll-area";
  if (!ariaLabel) {
    return (
      <div ref={ref} className={cls} data-orientation={orientation} style={style}>
        {children}
      </div>
    );
  }
  return (
    <div
      {...focusProps}
      ref={ref}
      className={cls}
      data-orientation={orientation}
      data-focus-visible={isFocusVisible || undefined}
      style={style}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
