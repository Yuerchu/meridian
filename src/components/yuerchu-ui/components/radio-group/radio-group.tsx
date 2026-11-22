"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { RadioGroupProps as AriaRadioGroupProps, RadioProps as AriaRadioProps, ValidationResult } from "react-aria-components";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { CheckIcon } from "../../lib/icons";
import { Description, FieldError, Label } from "../field/field";
import "./radio-group.css";

/**
 * 在两到五个互斥选项中进行单选的表单控件，支持默认单选、卡片对比与图片缩略图三种形态。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "children"> {
  /** 整组的可见标签，例如“发票类型”。 */
  label?: ReactNode;
  /** 整组的补充说明。 */
  description?: ReactNode;
  /** 校验失败时显示的错误提示，例如“请选择发票类型”。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 组内包含的 Radio 选项。 */
  children?: ReactNode;
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 基于 React Aria RadioGroup 封装，底层使用原生 radio，整组仅占用一个 Tab 焦点位并以方向键切换选项。
 *
 * @promote value, defaultValue, onChange, orientation, isRequired, isInvalid, isDisabled, isReadOnly, validate, name
 */
export function RadioGroup({ label, description, errorMessage, children, className, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup {...props} className={withUiClass("ui-radio-group", className)}>
      {label ? <Label>{label}</Label> : null}
      <div className="ui-radio-group__items">{children}</div>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaRadioGroup>
  );
}

export interface RadioProps extends Omit<AriaRadioProps, "children"> {
  /** 选项显示文字，整行区域均可点击。 */
  children?: ReactNode;
  /** 选项下方的补充说明，聚焦时随选项一并由读屏软件读出。 */
  description?: ReactNode;
  /**
   * 选项展示形态。card 将整行渲染为可点击卡片并把单选圆圈置于右侧；image 在上方展示缩略图并在选中时显示描边与角标。
   * @default "default"
   */
  variant?: "default" | "card" | "image";
  /** 在 variant="image" 时展示的缩略图；图片仅作视觉装饰，选项名称仍需写在 children 中。 */
  image?: ReactNode;
}

/**
 * 单选组内的单个选项，通过 value 指定提交值。
 */
export function Radio({ children, description, variant = "default", image, className, ...props }: RadioProps) {
  const descriptionId = useId();
  const labelId = useId();
  return (
    <AriaRadio
      {...props}
      aria-describedby={[props["aria-describedby"], description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined}
      // 说明文字也在 <label> 里，不指定的话它会被算进名称，读屏读两遍；有说明时名称只取选项文字
      aria-labelledby={props["aria-labelledby"] ?? (description && children ? labelId : undefined)}
      className={withUiClass("ui-radio", className)}
      data-variant={variant}
    >
      {variant === "image" ? (
        <span className="ui-radio__image" aria-hidden="true">
          {image}
          <span className="ui-radio__check">
            <CheckIcon />
          </span>
        </span>
      ) : (
        <span className="ui-radio__circle" aria-hidden="true" />
      )}
      {children || description ? (
        <span className="ui-radio__text">
          {children ? (
            <span id={labelId} className="ui-radio__label">
              {children}
            </span>
          ) : null}
          {description ? (
            <span id={descriptionId} className="ui-radio__description">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </AriaRadio>
  );
}
