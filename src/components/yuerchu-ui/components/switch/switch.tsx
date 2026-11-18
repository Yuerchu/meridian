"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { SwitchProps as AriaSwitchProps } from "react-aria-components";
import { Switch as AriaSwitch } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./switch.css";

/**
 * 开关：切换后立即生效的设置，例如"开启通知""深色模式"。
 * 需要点"保存"才生效的选项用 Checkbox。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface SwitchProps extends Omit<AriaSwitchProps, "children"> {
  /** 设置项的名称。整行（开关 + 文字）都可以点击。写名词短语（"邮件通知"），不要写成"开启邮件通知"这种带动作的句子。 */
  children?: ReactNode;
  /** 名称下方的补充说明，读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /**
   * 外观。card：整张卡片（带边框，可以点）、控件在右边，用于套餐、方案、设置这类每项都有说明的选择；选中时边框加深。
   * @default "default"
   */
  variant?: "default" | "card";
  /**
   * 尺寸。md 用于表单和设置页；sm 用于表格行、工具栏这类紧凑位置。触屏设备上会自动加大。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 指向底层的 label 元素。 */
  ref?: Ref<HTMLLabelElement>;
}

/**
 * 开关。基于 React Aria Switch：底层是带 role="switch" 的原生 checkbox，空格键切换，读屏读出"开 / 关"。
 * 开启态默认用 Ink；在开关或外层区域写 data-control="accent" 换成蓝色。
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
