"use client";

import type { CSSProperties, Ref } from "react";
import { useLayoutEffect, useRef } from "react";
import { mergeRefs } from "react-aria";
import { duration, stagger } from "../../lib/motion-tokens";
import "./skeleton.css";

const SHIMMER_MS = duration.shimmer;

/**
 * 在内容尚未就绪时按照大致结构渲染灰色占位块，用于稳定页面排版并传达加载预期。
 * 局部图标加载或明确进度的任务可分别改用 Spinner 与 ProgressBar。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface SkeletonProps {
  /**
   * 占位形状：`text` 表示单行或多行文字（高度对齐文字行高），`rect` 用于图片与图表区块，`circle` 用于圆形头像。
   * @default "text"
   */
  shape?: "text" | "rect" | "circle";
  /**
   * 当 `shape="text"` 时渲染的文本行数；多行模式下最后一行会自动缩短以贴近真实段落。
   * @default 1
   */
  lines?: number;
  /** 占位宽度，支持像素数值或 CSS 长度字符串（如 `120`、`"60%"`）；`text` 默认撑满父容器，`circle` 默认 `40px`。 */
  width?: number | string;
  /** 占位高度（适用于 `rect` 和 `circle`）；圆形未传入时默认与宽度相等。 */
  height?: number | string;
  /** 矩形占位的圆角大小（如使用测量布局提取的按钮圆角）；未传入时默认采用 `--radius-item`。 */
  radius?: string;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 渲染对屏幕阅读器隐藏（`aria-hidden`）的占位骨架块，外层容器应配合 `aria-busy` 与隐藏提示文本播报加载状态。
 * 同一页面内所有骨架的扫光动画均对齐到统一时间起点，在减弱动效模式下自动停止。
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
 * 闪光按页面时间对齐：每个骨架出现时，把动画拨到“页面时间 mod 周期”的位置（`--ui-skeleton-phase`）。
 * 仅在客户端挂载后设置，避免服务端渲染 `style` 与水合结果不一致。
 */
function useSharedShimmer(ref: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    ref.current?.style.setProperty("--ui-skeleton-phase", `${Math.round(performance.now() % SHIMMER_MS)}ms`);
  }, [ref]);
}

function toCss(value: number | string | undefined) {
  return typeof value === "number" ? `${value}px` : value;
}
