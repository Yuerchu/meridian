"use client";

import type { ProgressBarProps as AriaProgressBarProps } from "react-aria-components";
import { ProgressBar as AriaProgressBar } from "react-aria-components";
import "./progress-circle.css";

/**
 * 在空间紧凑的位置展示环形进度，适合文件列表行内上传状态、按钮旁或侧边栏用量提示。
 * 若空间足够放置文字标签，优先使用 ProgressBar；耗时未知时可改用 Spinner 或开启 `isIndeterminate`。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface ProgressCircleProps extends Omit<AriaProgressBarProps, "children" | "className" | "style" | "aria-label"> {
  /** 读屏名称，例如“正在上传 2026年度运营周报.pdf”。进度环旁没有可见标签，因此为必填项。 */
  "aria-label": string;
  /**
   * 圆环尺寸：`sm`（16px）适合行内文字旁，`md`（24px）适合列表项与按钮旁，`lg`（48px）支持在圆环中心显示数值。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * 是否在圆环中心显示进度数值（默认百分比），仅在 `lg` 尺寸下生效。
   * @default false
   */
  showValueLabel?: boolean;
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 基于 React Aria `ProgressBar` 的环形进度指示器，向辅助技术暴露 `role="progressbar"` 与当前数值。
 * 填充弧采用强调色；开启 `isIndeterminate` 时渲染为持续旋转的圆弧。
 *
 * @promote value, minValue, maxValue, isIndeterminate, valueLabel, formatOptions, size, showValueLabel
 */
export function ProgressCircle({ size = "md", showValueLabel = false, className, ...props }: ProgressCircleProps) {
  return (
    <AriaProgressBar {...props} className={className ? `ui-progress-circle ${className}` : "ui-progress-circle"} data-size={size}>
      {({ percentage, valueText, isIndeterminate }) => (
        <>
          <svg className="ui-progress-circle__svg" aria-hidden="true" data-indeterminate={isIndeterminate || undefined}>
            <circle className="ui-progress-circle__track" cx="50%" cy="50%" />
            {/* pathLength=100：描边长度按百分比算，dashoffset 就是没完成的部分 */}
            <circle
              className="ui-progress-circle__fill"
              cx="50%"
              cy="50%"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={isIndeterminate ? 75 : 100 - (percentage ?? 0)}
            />
          </svg>
          {showValueLabel && size === "lg" && !isIndeterminate ? (
            <span className="ui-progress-circle__value" aria-hidden="true">
              {valueText}
            </span>
          ) : null}
        </>
      )}
    </AriaProgressBar>
  );
}
