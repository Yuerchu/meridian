"use client";

import type { FieldErrorProps as AriaFieldErrorProps, LabelProps as AriaLabelProps, TextProps } from "react-aria-components";
import { FieldError as AriaFieldError, Label as AriaLabel, Text } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { withUiClass } from "../../lib/class-name";
import { fieldStrings } from "./field.strings";
import "./field.css";

/**
 * 表单字段的公共部件：标签、说明文字、错误信息。
 * 放在 TextField、Select 等字段组件内部使用，React Aria 会自动把它们和输入框关联起来。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface LabelProps extends AriaLabelProps {}

/**
 * 字段标签。每个输入框都必须有可见标签；不要用 placeholder 代替。
 */
export function Label({ className, ...props }: LabelProps) {
  return <AriaLabel {...props} className={className ? `ui-label ${className}` : "ui-label"} />;
}

export interface DescriptionProps extends Omit<TextProps, "slot" | "elementType"> {}

/**
 * 字段说明文字，显示在输入框下方，读屏会在聚焦输入框时一并读出。
 */
export function Description({ className, ...props }: DescriptionProps) {
  return <Text {...props} slot="description" className={className ? `ui-description ${className}` : "ui-description"} />;
}

export interface FieldErrorProps extends AriaFieldErrorProps {}

/**
 * 浏览器自带的校验文案跟随浏览器界面语言，不是页面语言（英文浏览器打开中文页面会显示"Please fill out this field."）。
 * 按校验结果换成页面语言（UIProvider）的文案；自定义 validate 和服务端错误（customError）原样显示。
 */
const BUILTIN_CHECKS = ["valueMissing", "typeMismatch", "patternMismatch", "tooShort", "tooLong", "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput"] as const;

/**
 * 字段错误信息。只在字段校验失败时渲染；浏览器自带的校验气泡已由 React Aria 屏蔽。
 * 不传内容时显示校验结果：浏览器自带的文案换成页面语言（UIProvider）的。
 */
export function FieldError({ className, children, ...props }: FieldErrorProps) {
  const t = useStrings(fieldStrings);
  return (
    <AriaFieldError {...props} className={withUiClass("ui-field-error", className)}>
      {children ??
        (({ validationErrors, validationDetails }) => {
          const builtin = !validationDetails.customError && BUILTIN_CHECKS.find((key) => validationDetails[key]);
          return builtin ? t[builtin] : validationErrors.join(" ");
        })}
    </AriaFieldError>
  );
}
