"use client";

import type { ReactNode, Ref } from "react";
import type {
  MenuItemProps as AriaMenuItemProps,
  MenuProps as AriaMenuProps,
  MenuSectionProps as AriaMenuSectionProps,
  PopoverProps as AriaPopoverProps,
} from "react-aria-components";
import {
  Collection,
  Header,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  Separator,
  Text,
} from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { CheckIcon, ChevronRightIcon } from "../../lib/icons";
import { Popover } from "../popover/popover";
import "./menu.css";

export { MenuTrigger, SubmenuTrigger } from "react-aria-components";

/**
 * 点击按钮后弹出的操作菜单，适用于“更多”操作、行内菜单及带分组或子菜单的功能列表。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface MenuProps<T extends object> extends Omit<AriaMenuProps<T>, "children"> {
  /** 菜单项内容，可静态传入 MenuItem、MenuSection、MenuSeparator，或配合 items 使用渲染函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /**
   * 弹出方向，视口空间不足时会自动翻转。默认由 React Aria 根据触发上下文决定，主菜单向下左对齐，子菜单向右展开。
   */
  placement?: AriaPopoverProps["placement"];
  /** 指向菜单根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 放置在 MenuTrigger 或 SubmenuTrigger 内并紧随触发按钮之后，内置 Popover 弹层定位与键盘导航支持。
 *
 * @promote onAction, items, selectionMode, selectedKeys, onSelectionChange, disabledKeys, onClose
 */
export function Menu<T extends object>({ placement, className, ...props }: MenuProps<T>) {
  return (
    // placement 不设默认值：MenuTrigger / SubmenuTrigger 会通过上下文给出各自的方向，这里写死会覆盖子菜单的方向
    <Popover {...(placement ? { placement } : null)} className="ui-menu__popover">
      <AriaMenu {...(props as AriaMenuProps<T>)} className={withUiClass("ui-menu", className)} />
    </Popover>
  );
}

export interface MenuItemProps<T extends object = object> extends Omit<AriaMenuItemProps<T>, "children"> {
  /** 菜单项显示文字，建议用动宾短语说明操作结果，例如“复制链接”。 */
  children?: ReactNode;
  /** 文字下方的补充说明。 */
  description?: ReactNode;
  /** 文字前置的装饰图标；同一菜单内建议保持图标有无一致。 */
  icon?: ReactNode;
  /** 快捷键提示文案，例如“⌘C”，实际快捷键事件需由页面自行监听。 */
  shortcut?: string;
  /**
   * 仅用于 CommandPalette 检索的额外关键词（如拼音、英文或别名），例如为“设置”补充 ["shezhi", "settings", "preferences"]，界面中不展示也不读出。
   */
  keywords?: string[];
  /**
   * 语义语气；将不可撤销的危险操作设为 danger 并置于菜单末尾。
   * @default "default"
   */
  tone?: "default" | "danger";
}

/**
 * 菜单中的单个条目，点击或按 Enter 触发 onAction；传入 href 时渲染为链接，内容非纯字符串时需补充 textValue。
 */
export function MenuItem<T extends object = object>({
  children,
  description,
  icon,
  shortcut,
  tone = "default",
  textValue,
  className,
  ...props
}: MenuItemProps<T>) {
  return (
    <AriaMenuItem
      {...props}
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={withUiClass("ui-menu-item", className)}
      data-tone={tone}
    >
      {({ isSelected, selectionMode, hasSubmenu }) => (
        <>
          {selectionMode !== "none" ? (
            <span className="ui-menu-item__check" aria-hidden="true">
              {isSelected ? <CheckIcon /> : null}
            </span>
          ) : null}
          {icon ? (
            <span className="ui-menu-item__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="ui-menu-item__text">
            <Text slot="label" className="ui-menu-item__label">
              {children}
            </Text>
            {description ? (
              <Text slot="description" className="ui-menu-item__description">
                {description}
              </Text>
            ) : null}
          </span>
          {shortcut ? <Keyboard className="ui-menu-item__shortcut">{shortcut}</Keyboard> : null}
          {hasSubmenu ? (
            <span className="ui-menu-item__submenu" aria-hidden="true">
              <ChevronRightIcon />
            </span>
          ) : null}
        </>
      )}
    </AriaMenuItem>
  );
}

export interface MenuSectionProps<T extends object> extends Omit<AriaMenuSectionProps<T>, "children"> {
  /** 分组标题（命名为 header 以避免与原生 title 属性混淆）。 */
  header?: ReactNode;
  /** 组内菜单项，可静态传入 MenuItem 或配合 items 使用渲染函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
}

/**
 * 带分组标题的一组菜单项，可在组内单独配置 selectionMode（如“排序方式”单选组）。
 */
export function MenuSection<T extends object>({ header, children, items, className, ...props }: MenuSectionProps<T>) {
  return (
    <AriaMenuSection {...props} className={className ? `ui-menu-section ${className}` : "ui-menu-section"}>
      {header ? <Header className="ui-menu-section__header">{header}</Header> : null}
      <Collection items={items}>{children as (item: T) => ReactNode}</Collection>
    </AriaMenuSection>
  );
}

/**
 * 菜单分隔线，用于将删除等危险操作与其他常规操作隔开。
 */
export function MenuSeparator() {
  return <Separator className="ui-menu-separator" />;
}
