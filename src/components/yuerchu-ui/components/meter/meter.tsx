"use client";

import type { ReactNode } from "react";
import type { MeterProps as AriaMeterProps } from "react-aria-components";
import { Label, Meter as AriaMeter } from "react-aria-components";
import "./meter.css";

/**
 * 计量条：一个量在已知范围里占了多少，例如存储用量、API 配额、座位数。
 * 任务的进度（上传、导入）用 ProgressBar：它表示"在变化、会完成"，这个表示"现在是多少"。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface MeterProps extends Omit<AriaMeterProps, "children" | "className" | "style"> {
  /** 可见标签，例如"存储空间"。不显示标签时写 aria-label。 */
  label?: ReactNode;
  /**
   * 是否在标签右边显示数值（默认是百分比，可以用 formatOptions / valueLabel 改，例如"18.4 GB / 20 GB"）。
   * @default true
   */
  showValueLabel?: boolean;
  /** 占比达到这个值（0–1）时变成警告色，例如 0.8。 */
  warningAt?: number;
  /** 占比达到这个值（0–1）时变成危险色，例如 0.95。 */
  dangerAt?: number;
  /** 根元素上的类名。 */
  className?: string;
}

/**
 * 计量条。基于 React Aria Meter：role="meter"，读屏读出标签和数值。
 * 默认用 Ink 填充；写了 warningAt / dangerAt 时，超过阈值换成警告 / 危险色，数值文字也跟着变色（数值一直显示，不只靠颜色）。
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
