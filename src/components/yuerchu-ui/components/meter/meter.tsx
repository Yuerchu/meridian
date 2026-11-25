"use client";

import type { ReactNode } from "react";
import type { MeterProps as AriaMeterProps } from "react-aria-components";
import { Label, Meter as AriaMeter } from "react-aria-components";
import "./meter.css";

/**
 * 用于展示当前数值在已知上限中所占比例的计量条，适合存储空间或资源配额等场景。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface MeterProps extends Omit<AriaMeterProps, "children" | "className" | "style"> {
  /** 可见标签，例如“存储空间”；未传可见标签时需通过 `aria-label` 指定无障碍名称。 */
  label?: ReactNode;
  /**
   * 是否在标签右侧展示格式化后的数值；默认展示百分比，也可通过 `formatOptions` 或 `valueLabel` 自定义为“18.4 GB / 20 GB”。
   * @default true
   */
  showValueLabel?: boolean;
  /** 占比达到该阈值（0–1）时切换为警告态，例如 `0.8`。 */
  warningAt?: number;
  /** 占比达到该阈值（0–1）时切换为危险态，例如 `0.95`。 */
  dangerAt?: number;
  /** 自定义根元素类名。 */
  className?: string;
}

/**
 * 计量条组件，基于 React Aria Meter 实现 `role="meter"` 语义，并支持通过 `warningAt` 与 `dangerAt` 在阈值处同步切换填充条与数值的语义状态。
 *
 * @promote value, minValue, maxValue, valueLabel, formatOptions
 */
export function Meter({ label, showValueLabel = true, warningAt, dangerAt, className, ...props }: MeterProps) {
  return (
    <AriaMeter {...props} className={className ? `ui-meter ${className}` : "ui-meter"}>
      {({ percentage, valueText }) => {
        const ratio = percentage / 100;
        const tone = dangerAt !== undefined && ratio >= dangerAt ? "danger" : warningAt !== undefined && ratio >= warningAt ? "warning" : undefined;
        return (
          <>
            {label || showValueLabel ? (
              <div className="ui-meter__header">
                {label ? <Label className="ui-meter__label">{label}</Label> : <span />}
                {showValueLabel ? (
                  <span className="ui-meter__value" data-tone={tone}>
                    {valueText}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="ui-meter__track">
              <div className="ui-meter__fill" data-tone={tone} style={{ width: `${percentage}%` }} />
            </div>
          </>
        );
      }}
    </AriaMeter>
  );
}
