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
 * 选项列表：Select、ComboBox 的下拉部分，也可以单独用作一列可选择的选项。
 * 一组操作用 Menu；导航用 Link。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface ListBoxProps<T extends object> extends Omit<AriaListBoxProps<T>, "children"> {
  /** 选项：静态写 ListBoxItem / ListBoxSection；或者配合 items 写成函数，按每一项渲染。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /** 指向底层的 div 元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 选项列表。基于 React Aria ListBox：方向键移动、输入首字母跳转、Home / End、多选时 Shift 连选。
 * 没有选项时显示"没有选项"，可以用 renderEmptyState 替换。
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
  /** 选项文字。 */
  children?: ReactNode;
  /** 选项下方的补充说明。 */
  description?: ReactNode;
  /** 文字前的图标，只做装饰。 */
  icon?: ReactNode;
}

/**
 * 一个选项。文字不是纯字符串时要写 textValue，用于输入首字母跳转和读屏。
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
  /** 分组标题。（不叫 title：避免和会弹出浏览器原生提示的 title 属性混淆） */
  header?: ReactNode;
  /** 组里的选项：静态写 ListBoxItem；或者配合 items 写成函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
}

/**
 * 一组选项，带分组标题。读屏会读出分组名。
 */
export function ListBoxSection<T extends object>({ header, children, items, className, ...props }: ListBoxSectionProps<T>) {
  return (
    <AriaListBoxSection {...props} className={className ? `ui-listbox-section ${className}` : "ui-listbox-section"}>
      {header ? <Header className="ui-listbox-section__header">{header}</Header> : null}
      <Collection items={items}>{children as (item: T) => ReactNode}</Collection>
    </AriaListBoxSection>
  );
}
