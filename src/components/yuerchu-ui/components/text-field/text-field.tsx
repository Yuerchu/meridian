"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { InputProps as AriaInputProps, TextFieldProps as AriaTextFieldProps, ValidationResult } from "react-aria-components";
import { Input as AriaInput, TextField as AriaTextField } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { Description, FieldError, Label } from "../field/field";
import "./text-field.css";

/**
 * 单行文本输入框：名称、邮箱、网址、电话等。
 * 密码用 PasswordField，验证码用 OTPField，多行文字用 TextArea，搜索用 SearchField。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface TextFieldProps extends Omit<AriaTextFieldProps, "children" | "type"> {
  /** 可见标签。每个输入框都必须有标签；确实不显示标签时，改写 aria-label。不要用 placeholder 代替标签。 */
  label?: ReactNode;
  /** 输入框下方的说明文字，例如格式要求。读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。可以是固定文字，也可以根据校验结果返回文字。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字，只用来举例（例如"name@example.com"），不能代替标签或说明。 */
  placeholder?: string;
  /**
   * 输入内容的类型，决定手机上弹出的键盘和浏览器的自动填充。
   * 密码不在这里：用 PasswordField。
   * @default "text"
   */
  type?: "text" | "email" | "url" | "tel";
  /**
   * 尺寸，对应控件高度 --control-sm / --control-md / --control-lg。触屏设备上会自动加高，字号也会变成 16px，避免 iOS 聚焦时放大页面。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 输入框左侧的图标，只做装饰（对读屏隐藏）。 */
  icon?: ReactNode;
  /** 输入框里左侧的固定文字，例如 "https://"、"¥"。不算进值里；读屏作为说明读出。和 icon 二选一。 */
  prefix?: ReactNode;
  /** 输入框里右侧的固定文字，例如 ".yxqi.cn"、"元"、"%"。不算进值里；读屏作为说明读出。 */
  suffix?: ReactNode;
  /** 指向底层的 input 元素。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 带标签、说明和错误信息的输入框。基于 React Aria TextField：标签、说明、错误信息会自动和输入框关联。
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
  /** 指向底层的 input 元素。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 加了样式的输入框本体。需要自己组合字段（例如在 React Aria 的其他字段组件里）时使用；一般情况直接用 TextField。
 */
export function Input({ className, ...props }: InputProps) {
  return <AriaInput {...props} className={withUiClass("ui-input", className)} />;
}

/**
 * 输入框的前后缀（TextField、NumberField 共用）：
 * - 有前后缀时，边框画在外层（.ui-text-field__control），输入框本身透明，前后缀和输入框排成一行；
 * - 前后缀通过 aria-describedby 关联给读屏（不进名称：名称是字段名，前后缀是格式说明）；
 * - 前后缀是指向输入框的 <label>，点它会聚焦输入框，不用 JS。输入框的名称由 aria-labelledby（字段标签）或 aria-label 决定，
 *   两者都优先于 <label>，所以名称不会变成"网站 https://"。
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
