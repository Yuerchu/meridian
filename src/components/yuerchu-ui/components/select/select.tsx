"use client";

import type { ReactNode, Ref, RefObject } from "react";
import { useContext, useRef } from "react";
import type { ButtonProps as AriaButtonProps, SelectProps as AriaSelectProps, ValidationResult } from "react-aria-components";
import { Button as AriaButton, ButtonContext, Select as AriaSelect, SelectStateContext, SelectValue } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { withUiClass } from "../../lib/class-name";
import { ChevronDownIcon, XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { Description, FieldError, Label } from "../field/field";
import { ListBox } from "../listbox/listbox";
import { Popover } from "../popover/popover";
import { selectStrings } from "./select.strings";
import "./select.css";

/**
 * 下拉选择：从一组固定选项里选一个（或几个）。选项用 ListBoxItem / ListBoxSection。
 * 选项少于 5 个且需要一眼看全时用 RadioGroup；需要输入搜索时用 ComboBox。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

/** Select 只支持单选和多选（没有 "none"） */
type SelectMode = "single" | "multiple";

export interface SelectProps<T extends object, M extends SelectMode = "single">
  extends Omit<AriaSelectProps<T, M>, "children" | "items"> {
  /** 可见标签。每个下拉框都必须有标签；确实不显示标签时，改写 aria-label。 */
  label?: ReactNode;
  /** 下拉框下方的说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /**
   * 尺寸，对应控件高度 --control-sm / --control-md / --control-lg。触屏设备上会自动加高。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 选项数据。配合函数形式的 children 使用；静态选项直接写 ListBoxItem，不需要 items。 */
  items?: Iterable<T>;
  /** 选项：静态写 ListBoxItem / ListBoxSection；或者配合 items 写成函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /**
   * 有值时在右侧显示清除按钮。清除按钮不在 Tab 顺序里：键盘在触发器上按 Delete / Backspace 清除。
   * @default false
   */
  isClearable?: boolean;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 下拉选择。基于 React Aria Select：底层带一个隐藏的原生 select，表单提交、自动填充都能用；
 * 触发器聚焦时可以直接输入首字母选择，不用先打开。selectionMode="multiple" 时可以多选。
 *
 * @promote selectedKey, defaultSelectedKey, onSelectionChange, selectionMode, placeholder, isRequired, isInvalid, isDisabled, disabledKeys, name, autoComplete
 */
export function Select<T extends object, M extends SelectMode = "single">({
  label,
  description,
  errorMessage,
  size = "md",
  items,
  children,
  isClearable = false,
  className,
  ...props
}: SelectProps<T, M>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <AriaSelect<T, M> {...props} className={withUiClass("ui-select", className)} data-size={size}>
      {label ? <Label>{label}</Label> : null}
      <div className="ui-select__control">
        <SelectTrigger triggerRef={triggerRef} isClearable={isClearable} />
        {isClearable && !props.isDisabled ? <SelectClear triggerRef={triggerRef} /> : null}
      </div>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover className="ui-select__popover">
        <ListBox items={items}>{children}</ListBox>
      </Popover>
    </AriaSelect>
  );
}

function hasValue(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : value != null;
}

function clear(state: { value: unknown; setValue(value: null | readonly never[]): void }, message: string) {
  state.setValue(Array.isArray(state.value) ? [] : null);
  announce(message);
}

function SelectTrigger({ triggerRef, isClearable }: { triggerRef: RefObject<HTMLButtonElement | null>; isClearable: boolean }) {
  const t = useStrings(selectStrings);
  const state = useContext(SelectStateContext);
  const clearable = isClearable && state !== null && hasValue(state.value);
  return (
    <AriaButton
      ref={triggerRef}
      className="ui-select__trigger"
      data-clearable={clearable || undefined}
      onKeyDown={(e) => {
        if (clearable && (e.key === "Delete" || e.key === "Backspace")) clear(state, t.cleared);
        else e.continuePropagation();
      }}
    >
      <SelectValue className="ui-select__value" />
      <span className="ui-select__chevron" aria-hidden="true">
        <ChevronDownIcon />
      </span>
    </AriaButton>
  );
}

/** 清除按钮：放在触发器外面（按钮里不能套按钮），叠在箭头左边 */
function SelectClear({ triggerRef }: { triggerRef: RefObject<HTMLButtonElement | null> }) {
  const t = useStrings(selectStrings);
  const state = useContext(SelectStateContext);
  if (!state || !hasValue(state.value)) return null;
  return (
    // 换掉 Select 给触发器准备的 ButtonContext，并像 SearchField 的清除按钮一样不进 Tab 顺序
    <ButtonContext.Provider value={{ excludeFromTabOrder: true } as AriaButtonProps}>
      <Button
        className="ui-select__clear"
        variant="ghost"
        size="sm"
        icon={<XIcon />}
        aria-label={t.clear}
        onPress={() => {
          clear(state, t.cleared);
          triggerRef.current?.focus();
        }}
      />
    </ButtonContext.Provider>
  );
}
