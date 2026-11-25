"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { InputProps as AriaInputProps, TextFieldProps as AriaTextFieldProps, ValidationResult } from "react-aria-components";
import { Input as AriaInput, TextField as AriaTextField } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { Description, FieldError, Label } from "../field/field";
import "./text-field.css";

/**
 * 带标签、格式提示与校验反馈的单行文本输入框，支持前缀、后缀与装饰图标。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface TextFieldProps extends Omit<AriaTextFieldProps, "children" | "type"> {
  /** 可见标签。若不显示可见标签，需传入 `aria-label`，不要用 `placeholder` 代替标签。 */
  label?: ReactNode;
  /** 输入框下方的补充说明文字（如格式要求），读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息，可传入固定文案或根据校验结果动态返回。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字，仅用于输入示例（如“name@company.cn”），不能替代标签或说明文字。 */
  placeholder?: string;
  /**
   * 输入内容类型，影响移动端软键盘类型与浏览器自动填充行为；密码输入请使用 PasswordField。
   * @default "text"
   */
  type?: "text" | "email" | "url" | "tel";
  /**
   * 控件尺寸。触屏设备上会自动适配最小触控高度与 16px 字号，避免 iOS 聚焦时放大页面。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 输入框左侧的装饰性图标，对读屏隐藏。 */
  icon?: ReactNode;
  /** 输入框左侧的固定前缀文字（如“https://”“¥”），不计入输入值，读屏会作为补充说明读出；与 `icon` 二选一使用。 */
  prefix?: ReactNode;
  /** 输入框右侧的固定后缀文字（如“.yxqi.cn”“元”“%”），不计入输入值，读屏会作为补充说明读出。 */
  suffix?: ReactNode;
  /** 指向底层 `input` 元素的引用。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 单行文本输入框，基于 React Aria TextField，自动完成标签、说明文字与错误提示的无障碍关联。
 *
 * @promote value, defaultValue, onChange, isRequired, isInvalid, isDisabled, isReadOnly, validate, name, autoComplete
 */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  type = "text",
  size = "md",
  icon,
  prefix,
  suffix,
  ref,
  className,
  ...props
}: TextFieldProps) {
  const affix = useAffixes(prefix, suffix, props);
  return (
    <AriaTextField
      {...props}
      id={affix.id}
      aria-describedby={affix.describedBy}
      type={type}
      className={withUiClass("ui-text-field", className)}
      data-size={size}
    >
      {label ? <Label>{label}</Label> : null}
      <div
        className="ui-text-field__control"
        data-has-icon={icon ? true : undefined}
        data-has-affix={affix.has || undefined}
      >
        {icon ? (
          <span className="ui-text-field__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {affix.prefix}
        <Input ref={ref} placeholder={placeholder} />
        {affix.suffix}
      </div>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  );
}

export interface InputProps extends AriaInputProps {
  /** 指向底层 `input` 元素的引用。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 统一样式的原生输入框，用于在自定义字段组件中组合标签与校验逻辑；常规场景直接使用 TextField 即可。
 */
export function Input({ className, ...props }: InputProps) {
  return <AriaInput {...props} className={withUiClass("ui-input", className)} />;
}

/**
 * 输入框的前后缀（TextField、NumberField 共用）：
 * - 有前后缀时，边框画在外层（.ui-text-field__control），输入框本身透明，前后缀和输入框排成一行；
 * - 前后缀通过 aria-describedby 关联给读屏（不进名称：名称是字段名，前后缀是格式说明）；
 * - 前后缀是指向输入框的 <label>，点它会聚焦输入框，不用 JS。输入框的名称由 aria-labelledby（字段标签）或 aria-label 决定，
 *   两者都优先于 <label>，所以名称不会变成“网站 https://”。
 */
export function useAffixes(prefix: ReactNode, suffix: ReactNode, props: { id?: string; "aria-describedby"?: string }) {
  const id = useId();
  const has = prefix != null || suffix != null;
  const inputId = props.id ?? `${id}-input`;
  const ids = [prefix != null ? `${id}-prefix` : null, suffix != null ? `${id}-suffix` : null, props["aria-describedby"]].filter(Boolean);
  const affix = (side: "start" | "end", content: ReactNode) =>
    content != null ? (
      <label id={`${id}-${side === "start" ? "prefix" : "suffix"}`} htmlFor={inputId} className="ui-text-field__affix" data-side={side}>
        {content}
      </label>
    ) : null;
  return {
    has,
    /** 只在有前后缀时指定输入框的 id（label 要指向它），否则交给 React Aria 生成 */
    id: has ? inputId : props.id,
    describedBy: ids.length ? ids.join(" ") : undefined,
    prefix: affix("start", prefix),
    suffix: affix("end", suffix),
  };
}
