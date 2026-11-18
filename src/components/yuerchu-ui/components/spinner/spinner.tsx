"use client";

import { ProgressBar } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { SpinnerIcon } from "../../lib/icons";
import { spinnerStrings } from "./spinner.strings";
import "./spinner.css";

/**
 * 加载图标：不知道要等多久的加载，例如加载列表、提交表单。
 * 知道进度时用 ProgressBar；按钮里的等待状态用 Button 的 isPending。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface SpinnerProps {
  /**
   * 尺寸，对应图标尺寸 --icon-sm / --icon-md / --icon-lg 的 1～2 倍。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * 读屏读出的说明，写清在加载什么，例如"正在加载项目"。
   * @default "加载中"（英文界面 "Loading"）
   */
  "aria-label"?: string;
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 加载图标。是一个不确定进度的 progressbar，读屏读出 aria-label；
 * 转动在减弱动效模式下放慢但不停（它表示"还在进行"，属于必要的动效）。
 */
export function Spinner({ size = "md", "aria-label": ariaLabel, className }: SpinnerProps) {
  const t = useStrings(spinnerStrings);
  return (
    <ProgressBar isIndeterminate aria-label={ariaLabel ?? t.loading} className={className ? `ui-spinner ${className}` : "ui-spinner"} data-size={size}>
      <SpinnerIcon className="ui-spinner__icon" />
    </ProgressBar>
  );
}
