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
 * 提供独立的是/否勾选项（例如同意服务条款或启用配置），也可配合 CheckboxGroup 组成多选分组。
 * 切换后立即生效的设置请使用 Switch，单选场景请使用 RadioGroup。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface CheckboxProps extends Omit<AriaCheckboxProps, "children"> {
  /** 选项标题，点击整行区域（包含方框与文字）均可切换选中状态。 */
  children?: ReactNode;
  /** 选项下方的补充说明，读屏器会在聚焦时一并播报。 */
  description?: ReactNode;
  /**
   * 外观样式。设为 card 时渲染为可点击卡片，勾选框位于右侧并在选中时加深边框，适合每项都有说明的配置选择。
   * @default "default"
   */
  variant?: "default" | "card";
  /** 指向底层的 label 元素。 */
  ref?: Ref<HTMLLabelElement>;
}

/**
 * 基于 React Aria Checkbox 实现，底层为原生 checkbox，支持空格键切换以及表单原生提交与重置。
 * 半选态（isIndeterminate）适用于代表一组子选项的“全选”控制框。
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
  /** 整组的标题，例如“通知方式”。 */
  label?: ReactNode;
  /** 整组的补充说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误提示，例如“至少选择一项”。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /**
   * 选项排列方向。选项文字较长或数量超过 3 个时建议使用纵向排列。
   * @default "vertical"
   */
  orientation?: "vertical" | "horizontal";
  /** 组内的 Checkbox 选项。 */
  children?: ReactNode;
  /** 指向底层的 div 元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 组织多个可多选的勾选框并共用标签与错误提示，value 为所有已选项的 value 数组。
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
