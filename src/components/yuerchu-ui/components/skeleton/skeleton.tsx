"use client";

import type { CSSProperties, Ref } from "react";
import { useLayoutEffect, useRef } from "react";
import { mergeRefs } from "react-aria";
import { duration, stagger } from "../../lib/motion-tokens";
import "./skeleton.css";

const SHIMMER_MS = duration.shimmer;

/**
 * 骨架屏：内容加载出来之前，按内容的大致形状显示的灰色占位块。让页面布局不跳动，也让用户知道这里马上会有内容。
 * 一个按钮、一小块区域在加载：用 Spinner；知道进度：用 ProgressBar。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface SkeletonProps {
  /**
   * 形状。text 是一行或几行文字（高度跟着字号），rect 是图片、图表这类块，circle 是头像。
   * @default "text"
   */
  shape?: "text" | "rect" | "circle";
  /**
   * 文字的行数（shape="text" 时）。多行时最后一行短一些，看起来像一段话。
   * @default 1
   */
  lines?: number;
  /** 宽度，例如 120、"60%"。text 默认占满，circle 默认 40px。 */
  width?: number | string;
  /** 高度（rect、circle）。circle 不写时等于宽度。 */
  height?: number | string;
  /** 圆角（rect），例如 Reveal 量出来的按钮圆角。不写用 --radius-item。 */
  radius?: string;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 骨架屏占位块。对读屏隐藏（aria-hidden）：加载状态由外层容器的 aria-busy 和一段读屏文字说明，见文档。
 * 闪光动画在减弱动效模式下停止。页面上所有骨架的闪光对齐到同一个时间起点：不管什么时候出现，扫过的位置都一致。
 */
export function Skeleton({ shape = "text", lines = 1, width, height, radius, className, ref }: SkeletonProps) {
  const own = useRef<HTMLSpanElement>(null);
  useSharedShimmer(own);
  const mergedRef = mergeRefs(own, ref ?? null);
  const style = { "--ui-skeleton-width": toCss(width), "--ui-skeleton-height": toCss(height), "--ui-skeleton-radius": radius } as CSSProperties;
  const cls = className ? `ui-skeleton ${className}` : "ui-skeleton";
  if (shape === "text" && lines > 1) {
    return (
      <span ref={mergedRef} className={cls} data-shape="text" data-lines="" style={style} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          // 一行比一行晚一点（相位差），闪光读起来像一道往下走的波；超过一个周期的行从头再来
          <span key={i} className="ui-skeleton__line" style={{ "--ui-skeleton-lag": `${(i * stagger.line) % SHIMMER_MS}ms` } as CSSProperties} />
        ))}
      </span>
    );
  }
  return <span ref={mergedRef} className={cls} data-shape={shape} style={style} aria-hidden="true" />;
}

/**
 * 闪光按页面时间对齐：每个骨架出现时，把动画往前拨到"页面时间 mod 周期"的位置（--ui-skeleton-phase）。
 * 在挂载后写，不写进服务端渲染的 style，水合时不会不一致。
 */
function useSharedShimmer(ref: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    ref.current?.style.setProperty("--ui-skeleton-phase", `${Math.round(performance.now() % SHIMMER_MS)}ms`);
  }, [ref]);
}

function toCss(value: number | string | undefined) {
  return typeof value === "number" ? `${value}px` : value;
}
