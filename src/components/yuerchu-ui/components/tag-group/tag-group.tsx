"use client";

import type { ReactNode, Ref } from "react";
import type { TagGroupProps as AriaTagGroupProps, TagListProps, TagProps as AriaTagProps } from "react-aria-components";
import { Button as AriaButton, Tag as AriaTag, TagGroup as AriaTagGroup, TagList, Text } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { CheckIcon, XIcon } from "../../lib/icons";
import { Label } from "../field/field";
import "./tag-group.css";

/**
 * 展示一组可删除或可多选的标签，常用于已选筛选条件、接收人列表或内容分类。
 *
 * @packageDocumentation
 * @category 集合
 * @status 实验中
 */

export interface TagGroupProps<T extends object> extends Omit<AriaTagGroupProps, "children"> {
  /** 标签组的可见标题，例如“已选条件”；不显示标题时需传入 `aria-label`。 */
  label?: ReactNode;
  /** 标签组下方的补充说明文字。 */
  description?: ReactNode;
  /** 标签数据源，配合函数形式的 `children` 使用。 */
  items?: Iterable<T>;
  /** 若干 `Tag` 子元素，或配合 `items` 使用的渲染函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /** 没有标签时展示的空状态内容。 */
  renderEmptyState?: TagListProps<T>["renderEmptyState"];
  /**
   * 标签尺寸规格；`sm` 适用于表格或紧凑列表，`md` 为默认尺寸。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 标签集合容器。基于 React Aria TagGroup 实现，整组在页面中仅占用一个 `Tab` 焦点位，内部通过方向键移动；传入 `onRemove` 时支持点击删除按钮或按 `Backspace` / `Delete` 移除标签，传入 `selectionMode` 时支持作为筛选标签选择。
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
  /** 标签文字内容；非纯字符串内容时请同步传入 `textValue`。 */
  children?: ReactNode;
}

/**
 * 单个标签项；当所属 `TagGroup` 传入 `onRemove` 时自动附带可点击的删除按钮（读屏名称默认为“移除”）。
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
