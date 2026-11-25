"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { SwitchProps as AriaSwitchProps } from "react-aria-components";
import { Switch as AriaSwitch } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./switch.css";

/**
 * 用于切换后立即生效设置的开关控件，例如桌面通知或自动更新。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface SwitchProps extends Omit<AriaSwitchProps, "children"> {
  /** 设置项名称，整行均可点击；建议使用“邮件通知”等名词短语，避免使用带动词的句子。 */
  children?: ReactNode;
  /** 名称下方的补充说明，聚焦时随名称一并由读屏软件读出。 */
  description?: ReactNode;
  /**
   * 展示形态。card 将整行渲染为带边框的可点击卡片并将开关置于右侧，开启时卡片边框保持不变。
   * @default "default"
   */
  variant?: "default" | "card";
  /**
   * 控件尺寸。md 适用于常规表单与设置页，sm 适用于表格行或工具栏等紧凑场景，触屏设备上会自动放大。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 指向底层 label 元素的引用。 */
  ref?: Ref<HTMLLabelElement>;
}

/**
 * 基于 React Aria Switch 封装，底层渲染带 role="switch" 的原生 checkbox；可通过设置 data-control="accent" 启用蓝色开启态。
 *
 * @promote isSelected, defaultSelected, onChange, isDisabled, isReadOnly, value, name
 */
export function Switch({ children, description, size = "md", variant = "default", className, ...props }: SwitchProps) {
  const descriptionId = useId();
  const labelId = useId();
  return (
    <AriaSwitch
      {...props}
      aria-describedby={[props["aria-describedby"], description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined}
      // 说明文字也在 <label> 里，不指定的话它会被算进名称，读屏读两遍；有说明时名称只取选项文字
      aria-labelledby={props["aria-labelledby"] ?? (description && children ? labelId : undefined)}
      className={withUiClass("ui-switch", className)}
      data-size={size}
      data-variant={variant}
    >
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      {children || description ? (
        <span className="ui-switch__text">
          {children ? (
            <span id={labelId} className="ui-switch__label">
              {children}
            </span>
          ) : null}
          {description ? (
            <span id={descriptionId} className="ui-switch__description">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </AriaSwitch>
  );
}
