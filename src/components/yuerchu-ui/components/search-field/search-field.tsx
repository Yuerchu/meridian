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
 * 搜索框：在当前页面或列表里搜索、筛选。左边是搜索图标，有内容时右边出现清除按钮。
 * 全站搜索用 CommandPalette；从选项里边输入边选用 ComboBox。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, "children"> {
  /** 可见标签。搜索框常常不显示标签，这时必须写 aria-label（例如"搜索项目"）。 */
  label?: ReactNode;
  /** 输入框下方的说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字，例如"搜索项目名称或负责人"。 */
  placeholder?: string;
  /**
   * 尺寸，对应控件高度 --control-sm / --control-md / --control-lg。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 指向底层的 input 元素。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 搜索框。基于 React Aria SearchField：type="search"，Esc 清空，Enter 触发 onSubmit；
 * 清除按钮不在 Tab 顺序里（键盘用 Esc），点了以后焦点回到输入框。
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
