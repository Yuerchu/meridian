"use client";

import type { ReactNode, Ref } from "react";
import type { TagGroupProps as AriaTagGroupProps, TagListProps, TagProps as AriaTagProps } from "react-aria-components";
import { Button as AriaButton, Tag as AriaTag, TagGroup as AriaTagGroup, TagList, Text } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { CheckIcon, XIcon } from "../../lib/icons";
import { Label } from "../field/field";
import "./tag-group.css";

/**
 * 标签组：一组可以删除或选择的标签，例如已选的筛选条件、邮件的收件人、文章的标签。
 * 只展示状态、不能操作的用 Badge；从一组选项里选值用 Select / CheckboxGroup。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface TagGroupProps<T extends object> extends Omit<AriaTagGroupProps, "children"> {
  /** 整组的标签，例如"已选条件"。不显示时写 aria-label。 */
  label?: ReactNode;
  /** 整组的说明文字。 */
  description?: ReactNode;
  /** 标签数据，配合函数形式的 children。 */
  items?: Iterable<T>;
  /** 若干 Tag；或者配合 items 写成函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /** 没有标签时显示的内容。 */
  renderEmptyState?: TagListProps<T>["renderEmptyState"];
  /**
   * 尺寸。sm 用于表格、列表里；md 是默认。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 标签组。基于 React Aria TagGroup：整组一个 Tab 位置，方向键在标签间移动；
 * 写了 onRemove 时每个标签有删除按钮，聚焦标签按 Backspace / Delete 也能删；selectionMode 时可以选择（筛选标签）。
 *
 * @promote onRemove, selectionMode, selectedKeys, defaultSelectedKeys, onSelectionChange, disabledKeys
 */
export function TagGroup<T extends object>({
  label,
  description,
  items,
  children,
  renderEmptyState,
  size = "md",
  className,
  ...props
}: TagGroupProps<T>) {
  return (
    <AriaTagGroup {...props} className={className ? `ui-tag-group ${className}` : "ui-tag-group"} data-size={size}>
      {label ? <Label>{label}</Label> : null}
      <TagList items={items} renderEmptyState={renderEmptyState} className="ui-tag-group__list">
        {children}
      </TagList>
      {description ? (
        <Text slot="description" className="ui-description">
          {description}
        </Text>
      ) : null}
    </AriaTagGroup>
  );
}

export interface TagProps extends Omit<AriaTagProps, "children"> {
  /** 标签文字。不是纯字符串时写 textValue。 */
  children?: ReactNode;
}

/**
 * 一个标签。TagGroup 写了 onRemove 时自动带删除按钮（读屏名称"移除"，跟随语言）。
 */
export function Tag({ children, textValue, className, ...props }: TagProps) {
  return (
    <AriaTag
      {...props}
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={withUiClass("ui-tag", className)}
    >
      {({ allowsRemoving, isSelected, selectionMode }) => (
        <>
          {selectionMode !== "none" && isSelected ? (
            <span className="ui-tag__check" aria-hidden="true">
              <CheckIcon />
            </span>
          ) : null}
          <span className="ui-tag__label">{children}</span>
          {allowsRemoving ? (
            <AriaButton slot="remove" className="ui-tag__remove">
              <XIcon />
            </AriaButton>
          ) : null}
        </>
      )}
    </AriaTag>
  );
}
