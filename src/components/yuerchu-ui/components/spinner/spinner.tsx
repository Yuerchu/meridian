"use client";

import { ProgressBar } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { SpinnerIcon } from "../../lib/icons";
import { spinnerStrings } from "./spinner.strings";
import "./spinner.css";

/**
 * 用于表示耗时未知的加载过程，例如拉取列表数据或等待异步操作响应。
 * 已知进度时请改用 ProgressBar，按钮内的提交等待请使用 Button 的 `isPending`。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface SpinnerProps {
  /**
   * 加载图标尺寸，提供小、中、大三种规格。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * 屏幕阅读器播报的说明文本，建议写明正在加载的具体内容（例如“正在加载干线运单”）。
   * @default "加载中"（英文界面 "Loading"）
   */
  "aria-label"?: string;
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 渲染不确定进度的 `progressbar` 加载指示器，并向读屏播报 `aria-label`。
 * 在减弱动效模式下会放慢旋转速度而不停止，以持续标示任务正在进行。
 */
export function Spinner({ size = "md", "aria-label": ariaLabel, className }: SpinnerProps) {
  const t = useStrings(spinnerStrings);
  return (
    <ProgressBar isIndeterminate aria-label={ariaLabel ?? t.loading} className={className ? `ui-spinner ${className}` : "ui-spinner"} data-size={size}>
      <SpinnerIcon className="ui-spinner__icon" />
    </ProgressBar>
  );
}
