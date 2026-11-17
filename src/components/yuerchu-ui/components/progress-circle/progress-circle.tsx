"use client";

import type { ProgressBarProps as AriaProgressBarProps } from "react-aria-components";
import { ProgressBar as AriaProgressBar } from "react-aria-components";
import "./progress-circle.css";

/**
 * 进度环：地方小、放不下进度条时显示进度，例如文件列表里每个文件的上传进度、按钮里、上下文用量。
 * 有地方写标签时用 ProgressBar；不知道进度用 Spinner（或 isIndeterminate）。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface ProgressCircleProps extends Omit<AriaProgressBarProps, "children" | "className" | "style" | "aria-label"> {
  /** 读屏名称，例如"正在上传 report.pdf"。进度环旁边没有可见的标签，所以必须写。 */
  "aria-label": string;
  /**
   * 尺寸。sm 16px：放在一行文字里；md 24px：列表项、按钮旁；lg 48px：可以在中间显示数值。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * 在环中间显示数值（默认是百分比）。只有 lg 放得下，其他尺寸忽略。
   * @default false
   */
  showValueLabel?: boolean;
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 进度环。基于 React Aria ProgressBar：role="progressbar"，读屏读出名称和数值。
 * 颜色和 ProgressBar 一样用 accent；isIndeterminate 时是一段转圈的弧。
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
