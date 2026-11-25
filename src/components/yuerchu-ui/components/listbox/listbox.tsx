"use client";

import type { ReactNode, Ref } from "react";
import type {
  ListBoxItemProps as AriaListBoxItemProps,
  ListBoxProps as AriaListBoxProps,
  ListBoxSectionProps as AriaListBoxSectionProps,
} from "react-aria-components";
import {
  Collection,
  Header,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  ListBoxSection as AriaListBoxSection,
  Text,
} from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { withUiClass } from "../../lib/class-name";
import { CheckIcon } from "../../lib/icons";
import { listboxStrings } from "./listbox.strings";
import "./listbox.css";

/**
 * 展示一列可供单选或多选的选项，既可单独放置在面板中，也用作 Select 和 ComboBox 的下拉列表。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface ListBoxProps<T extends object> extends Omit<AriaListBoxProps<T>, "children"> {
  /** 列表项，可静态传入 ListBoxItem / ListBoxSection，或配合 `items` 传入渲染函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /** 指向底层 div 元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 支持键盘方向键移动、首字母跳转、Home / End 及多选 Shift 连选的选项列表。
 * 列表为空时默认显示“暂无选项”，可通过 `renderEmptyState` 自定义。
 *
 * @promote items, selectionMode, selectedKeys, defaultSelectedKeys, onSelectionChange, disabledKeys, renderEmptyState
 */
export function ListBox<T extends object>({ className, renderEmptyState, ...props }: ListBoxProps<T>) {
  const t = useStrings(listboxStrings);
  return (
    <AriaListBox
      {...(props as AriaListBoxProps<T>)}
      renderEmptyState={renderEmptyState ?? (() => <div className="ui-listbox__empty">{t.empty}</div>)}
      className={withUiClass("ui-listbox", className)}
    />
  );
}

export interface ListBoxItemProps<T extends object = object> extends Omit<AriaListBoxItemProps<T>, "children"> {
  /** 选项显示内容。 */
  children?: ReactNode;
  /** 选项下方的补充说明。 */
  description?: ReactNode;
  /** 选项文字前的装饰性图标。 */
  icon?: ReactNode;
}

/**
 * 单个选项；内容不是纯字符串时请传入 `textValue` 供首字母跳转和读屏朗读。
 */
export function ListBoxItem<T extends object = object>({ children, description, icon, textValue, className, ...props }: ListBoxItemProps<T>) {
  return (
    <AriaListBoxItem
      {...props}
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={withUiClass("ui-listbox-item", className)}
    >
      {({ isSelected, selectionMode }) => (
        <>
          {icon ? (
            <span className="ui-listbox-item__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="ui-listbox-item__text">
            <Text slot="label" className="ui-listbox-item__label">
              {children}
            </Text>
            {description ? (
              <Text slot="description" className="ui-listbox-item__description">
                {description}
              </Text>
            ) : null}
          </span>
          {selectionMode !== "none" ? (
            <span className="ui-listbox-item__check" aria-hidden="true">
              {isSelected ? <CheckIcon /> : null}
            </span>
          ) : null}
        </>
      )}
    </AriaListBoxItem>
  );
}

export interface ListBoxSectionProps<T extends object> extends Omit<AriaListBoxSectionProps<T>, "children"> {
  /** 分组标题，避免使用会触发浏览器原生悬浮提示的 title 属性。 */
  header?: ReactNode;
  /** 组内选项，可静态传入 ListBoxItem 或配合 `items` 传入渲染函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
}

/**
 * 带分组标题的一组选项，读屏器会关联朗读分组名称。
 */
export function ListBoxSection<T extends object>({ header, children, items, className, ...props }: ListBoxSectionProps<T>) {
  return (
    <AriaListBoxSection {...props} className={className ? `ui-listbox-section ${className}` : "ui-listbox-section"}>
      {header ? <Header className="ui-listbox-section__header">{header}</Header> : null}
      <Collection items={items}>{children as (item: T) => ReactNode}</Collection>
    </AriaListBoxSection>
  );
}
