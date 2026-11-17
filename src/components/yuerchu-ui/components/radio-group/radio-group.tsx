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
 * 单选组：从两到五个互斥选项里选一个，选项需要一眼看全，例如"计费周期""通知频率"。
 * 选项多时用 Select；立即生效的视图切换用 SegmentedControl。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "children"> {
  /** 整组的标签，例如"计费周期"。 */
  label?: ReactNode;
  /** 整组的说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息，例如"请选择计费周期"。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 若干 Radio。 */
  children?: ReactNode;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 单选组。基于 React Aria RadioGroup：整组只占一个 Tab 位置，方向键在选项之间移动并选中；底层是原生 radio。
 * orientation 决定排列方向（默认纵向）。
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
  /** 选项文字。整行都可以点击。 */
  children?: ReactNode;
  /** 选项下方的补充说明，读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /**
   * 外观。card：整张卡片（带边框，可以点）、控件在右边，用于套餐、方案、设置这类每项都有说明的选择；选中时边框加深。
   * image：图在上、名字在下（主题、布局、模板），选中时描边加角上一个勾；一组都写 image 时排成网格。
   * @default "default"
   */
  variant?: "default" | "card" | "image";
  /** variant="image" 时选项上方的图（主题预览、布局缩略图、模板封面）。图只做装饰，选项的名称写在 children。 */
  image?: ReactNode;
}

/**
 * 一个选项。value 是这个选项的值。
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
