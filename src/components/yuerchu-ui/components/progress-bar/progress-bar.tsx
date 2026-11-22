"use client";

import type { ReactNode } from "react";
import type { ProgressBarProps as AriaProgressBarProps } from "react-aria-components";
import { Label, ProgressBar as AriaProgressBar } from "react-aria-components";
import "./progress-bar.css";

/**
 * 用于展示已知进度的任务或资源占用，例如文件上传、数据导入和存储空间用量。
 * 若任务时长未知且区域较小，可改用 Spinner，或开启 `isIndeterminate`。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface ProgressBarProps extends Omit<AriaProgressBarProps, "children" | "className" | "style"> {
  /** 可见标签，例如“正在上传 2026年度运营周报.pdf”。隐藏标签时请传入 `aria-label`。 */
  label?: ReactNode;
  /**
   * 是否在标签右侧展示当前进度数值，默认格式化为百分比，也可通过 `formatOptions` 或 `valueLabel` 自定义。
   * @default true
   */
  showValueLabel?: boolean;
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 基于 React Aria `ProgressBar` 封装，向辅助技术暴露 `role="progressbar"` 及进度数值。
 * 填充条采用强调色标示进行中的状态；开启 `isIndeterminate` 时改为往复滑动的加载条。
 *
 * @promote value, minValue, maxValue, isIndeterminate, valueLabel, formatOptions
 */
export function ProgressBar({ label, showValueLabel = true, className, ...props }: ProgressBarProps) {
  return (
    <AriaProgressBar {...props} className={className ? `ui-progress-bar ${className}` : "ui-progress-bar"}>
      {({ percentage, valueText, isIndeterminate }) => (
        <>
          {label || (showValueLabel && !isIndeterminate) ? (
            <div className="ui-progress-bar__header">
              {label ? <Label className="ui-progress-bar__label">{label}</Label> : <span />}
              {showValueLabel && !isIndeterminate ? <span className="ui-progress-bar__value">{valueText}</span> : null}
            </div>
          ) : null}
          <div className="ui-progress-bar__track">
            <div
              className="ui-progress-bar__fill"
              data-indeterminate={isIndeterminate || undefined}
              style={isIndeterminate ? undefined : { width: `${percentage ?? 0}%` }}
            />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}
