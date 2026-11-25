"use client";

import type { ReactNode, Ref } from "react";
import type { SearchFieldProps as AriaSearchFieldProps, ValidationResult } from "react-aria-components";
import { Button as AriaButton, SearchField as AriaSearchField } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { SearchIcon, XIcon } from "../../lib/icons";
import { Description, FieldError, Label } from "../field/field";
import { Input } from "../text-field/text-field";
import "./search-field.css";

/**
 * 用于在当前页面、列表或表格中进行关键字搜索与筛选，左侧带搜索图标，输入内容后自动显示清除按钮。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, "children"> {
  /** 可见标签。搜索框常省略可见标签，此时必须传入 `aria-label`（如“搜索就诊科室”）。 */
  label?: ReactNode;
  /** 输入框下方的补充说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字，如“输入科室名称”。 */
  placeholder?: string;
  /**
   * 控件尺寸。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 指向底层 `input` 元素的引用。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 搜索输入框，基于 React Aria SearchField。采用 `type="search"`，支持按 `Esc` 清空与 `Enter` 触发 `onSubmit`；
 * 清除按钮不参与 `Tab` 顺序，点击后焦点回到输入框。
 *
 * @promote value, defaultValue, onChange, onSubmit, onClear, isDisabled, isReadOnly, name, autoComplete
 */
export function SearchField({ label, description, errorMessage, placeholder, size = "md", ref, className, ...props }: SearchFieldProps) {
  return (
    <AriaSearchField {...props} className={withUiClass("ui-text-field ui-search-field", className)} data-size={size}>
      {label ? <Label>{label}</Label> : null}
      <div className="ui-text-field__control" data-has-icon>
        <span className="ui-text-field__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <Input ref={ref} placeholder={placeholder} />
        <AriaButton className="ui-search-field__clear">
          <XIcon />
        </AriaButton>
      </div>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaSearchField>
  );
}
