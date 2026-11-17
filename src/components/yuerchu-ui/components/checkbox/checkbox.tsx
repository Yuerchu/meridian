"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type {
  CheckboxGroupProps as AriaCheckboxGroupProps,
  CheckboxProps as AriaCheckboxProps,
  ValidationResult,
} from "react-aria-components";
import { Checkbox as AriaCheckbox, CheckboxGroup as AriaCheckboxGroup } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { Description, FieldError, Label } from "../field/field";
import "./checkbox.css";

/**
 * 勾选框：独立的是 / 否选项（"记住我""同意条款"），或者一组可以多选的选项（CheckboxGroup）。
 * 立即生效的开关用 Switch；只能选一个用 RadioGroup。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface CheckboxProps extends Omit<AriaCheckboxProps, "children"> {
  /** 选项文字。整行（方框 + 文字）都可以点击。 */
  children?: ReactNode;
  /** 选项下方的补充说明，读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /**
   * 外观。card：整张卡片（带边框，可以点）、控件在右边，用于套餐、方案、设置这类每项都有说明的选择；选中时边框加深。
   * @default "default"
   */
  variant?: "default" | "card";
  /** 指向底层的 label 元素。 */
  ref?: Ref<HTMLLabelElement>;
}

/**
 * 勾选框。基于 React Aria Checkbox：底层是原生 checkbox，空格键切换，表单提交和重置都按原生行为工作。
 * 半选（isIndeterminate）用于"全选"这类代表一组选项的勾选框。
 *
 * @promote isSelected, defaultSelected, onChange, isIndeterminate, isDisabled, isInvalid, isRequired, value, name
 */
export function Checkbox({ children, description, variant = "default", className, ...props }: CheckboxProps) {
  const descriptionId = useId();
  const labelId = useId();
  return (
    <AriaCheckbox
      {...props}
      aria-describedby={[props["aria-describedby"], description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined}
      // 说明文字也在 <label> 里，不指定的话它会被算进名称，读屏读两遍；有说明时名称只取选项文字
      aria-labelledby={props["aria-labelledby"] ?? (description && children ? labelId : undefined)}
      className={withUiClass("ui-checkbox", className)}
      data-variant={variant}
    >
      {({ isIndeterminate }) => (
        <>
          <span className="ui-checkbox__box" aria-hidden="true">
            <svg className="ui-checkbox__mark" viewBox="0 0 16 16" aria-hidden="true">
              {isIndeterminate ? <path d="M4 8h8" pathLength={1} /> : <path d="M3.5 8.5l3 3 6-7" pathLength={1} />}
            </svg>
          </span>
          {children || description ? (
            <span className="ui-checkbox__text">
              {children ? (
            <span id={labelId} className="ui-checkbox__label">
              {children}
            </span>
          ) : null}
              {description ? (
                <span id={descriptionId} className="ui-checkbox__description">
                  {description}
                </span>
              ) : null}
            </span>
          ) : null}
        </>
      )}
    </AriaCheckbox>
  );
}

export interface CheckboxGroupProps extends Omit<AriaCheckboxGroupProps, "children"> {
  /** 整组的标签，例如"通知方式"。 */
  label?: ReactNode;
  /** 整组的说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息，例如"至少选择一项"。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /**
   * 排列方向。选项文字较长或超过 3 个时用纵向。
   * @default "vertical"
   */
  orientation?: "vertical" | "horizontal";
  /** 组里的 Checkbox。 */
  children?: ReactNode;
  /** 指向底层的 div 元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 一组可以多选的勾选框，整组共用一个标签和错误信息。value 是选中项的 value 数组。
 *
 * @promote value, defaultValue, onChange, isRequired, isInvalid, isDisabled, isReadOnly, validate, name
 */
export function CheckboxGroup({
  label,
  description,
  errorMessage,
  orientation = "vertical",
  children,
  className,
  ...props
}: CheckboxGroupProps) {
  return (
    <AriaCheckboxGroup {...props} className={withUiClass("ui-checkbox-group", className)} data-orientation={orientation}>
      {label ? <Label>{label}</Label> : null}
      <div className="ui-checkbox-group__items">{children}</div>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaCheckboxGroup>
  );
}
