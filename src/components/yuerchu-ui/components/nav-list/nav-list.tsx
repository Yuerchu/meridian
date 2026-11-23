"use client";

import type { ReactNode, Ref } from "react";
import { Children, createContext, useContext, useId, useState } from "react";
import { mergeProps, useFocusWithin, useHover } from "react-aria";
import type { ButtonProps as AriaButtonProps, LinkProps as AriaLinkProps } from "react-aria-components";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { ChevronRightIcon } from "../../lib/icons";
import { Tooltip, TooltipTrigger } from "../tooltip/tooltip";
import { navListStrings } from "./nav-list.strings";
import "./nav-list.css";

/**
 * 在侧边栏中展示可分组、可折叠与可级联嵌套的纵向页面导航列表，并高亮标识当前所在页面。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

type DataAttributes = Record<`data-${string}`, string | undefined>;

const NavListContext = createContext<{
  currentHref?: string;
  onNavigate?: () => void;
  size: "sm" | "md";
  showGuides: boolean;
}>({
  size: "md",
  showGuides: false,
});

/** Sidebar 用：抽屉里点了导航项后关闭抽屉 */
export const NavigateContext = createContext<(() => void) | undefined>(undefined);

/** Sidebar 收起成图标条时为 true：导航项只显示图标，名称放进 Tooltip */
export const NavCollapsedContext = createContext(false);

export interface NavListProps {
  /** 导航区域的名称，用于在页面存在多个导航区域时加以区分，例如“主导航”。 */
  "aria-label": string;
  /** 当前页面路径，与其一致的 NavItem 会自动标为当前页，通常传入路由 pathname。 */
  currentHref?: string;
  /**
   * 列表行高与字号尺寸；`sm` 更紧凑，适用于高密度工作台或对话列表侧边栏。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 是否在嵌套的 `NavGroup` 子列表左侧绘制垂直引导线，辅助辨认父子归属关系。 */
  showGuides?: boolean;
  /** 导航内容，传入 NavItem、NavGroup 或 NavSection。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 指向底层 nav 元素。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 纵向导航列表，渲染带名称的 `nav` 地标区域和内部列表，当前页链接自动标记 `aria-current="page"`。
 */
export function NavList({
  "aria-label": ariaLabel,
  currentHref,
  size = "md",
  showGuides = false,
  children,
  className,
  ref,
}: NavListProps) {
  const onNavigate = useContext(NavigateContext);
  return (
    <NavListContext.Provider value={{ currentHref, onNavigate, size, showGuides }}>
      <nav
        ref={ref}
        aria-label={ariaLabel}
        className={className ? `ui-nav-list ${className}` : "ui-nav-list"}
        data-size={size}
        data-guides={showGuides || undefined}
      >
        <ul className="ui-nav-list__items">{children}</ul>
      </nav>
    </NavListContext.Provider>
  );
}

export interface NavSectionProps {
  /** 分组标题。 */
  header: ReactNode;
  /** 该分组内的 NavItem 或 NavGroup 列表。 */
  children?: ReactNode;
  /** 是否允许点击标题折叠或展开该分组。 */
  isCollapsible?: boolean;
  /** 是否处于展开状态（受控）。 */
  isExpanded?: boolean;
  /**
   * 非受控时的初始展开状态。
   * @default true
   */
  defaultExpanded?: boolean;
  /** 展开状态变化时的回调。 */
  onExpandedChange?: (isExpanded: boolean) => void;
  /** 分组标题右侧的辅助操作区（例如新建按钮或更多菜单），默认在悬停、键盘聚焦或触屏下显示。 */
  actions?: ReactNode;
  /** 自定义类名。 */
  className?: string;
}

/**
 * 带标题的一组导航项，标题通过 `aria-labelledby` 关联到组内列表；开启 `isCollapsible` 后可折叠展开。
 */
export function NavSection({
  header,
  children,
  isCollapsible = false,
  isExpanded,
  defaultExpanded = true,
  onExpandedChange,
  actions,
  className,
}: NavSectionProps) {
  const id = useId();
  const listId = useId();
  const collapsed = useContext(NavCollapsedContext);
  const [ownExpanded, setOwnExpanded] = useState(defaultExpanded);
  const expanded = isCollapsible ? (isExpanded ?? ownExpanded) : true;
  const toggle = () => {
    const next = !expanded;
    if (isExpanded === undefined) setOwnExpanded(next);
    onExpandedChange?.(next);
  };
  const { hoverProps, isHovered } = useHover({});
  const [isFocusWithin, setFocusWithin] = useState(false);
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusWithin });
  const hasChildren = Children.count(children) > 0;
  const showList = expanded && hasChildren;

  return (
    <li className={className ? `ui-nav-list__section ${className}` : "ui-nav-list__section"} data-expanded={isCollapsible ? (expanded || undefined) : undefined}>
      {isCollapsible || actions ? (
        <div
          {...mergeProps(hoverProps, focusWithinProps)}
          className="ui-nav-list__section-header"
          data-hovered={isHovered || undefined}
          data-focus-within={isFocusWithin || undefined}
        >
          {isCollapsible ? (
            <AriaButton
              className="ui-nav-list__section-toggle"
              aria-expanded={expanded}
              aria-controls={showList ? listId : undefined}
              data-expanded={expanded || undefined}
              onPress={toggle}
            >
              <span className="ui-nav-list__chevron" aria-hidden="true">
                <ChevronRightIcon />
              </span>
              <span id={id} className="ui-nav-list__section-title">
                {header}
              </span>
            </AriaButton>
          ) : (
            <span id={id} className="ui-nav-list__header">
              {header}
            </span>
          )}
          {actions && !collapsed ? <span className="ui-nav-list__actions">{actions}</span> : null}
        </div>
      ) : (
        <span id={id} className="ui-nav-list__header">
          {header}
        </span>
      )}
      {showList ? (
        <ul id={isCollapsible ? listId : undefined} className="ui-nav-list__items" aria-labelledby={id}>
          {children}
        </ul>
      ) : null}
    </li>
  );
}

export interface NavGroupProps extends DataAttributes {
  /** 分组行显示的标题内容。 */
  label: ReactNode;
  /** 文字前的装饰性图标。 */
  icon?: ReactNode;
  /** 标题右侧的次要信息，例如计数；同时传入 `actions` 时在细指针设备悬停或聚焦后切换为操作区。 */
  trailing?: ReactNode;
  /** 行尾的辅助操作区（例如新建按钮或更多菜单），默认在悬停、键盘聚焦或触屏下显示。 */
  actions?: ReactNode;
  /** 是否处于展开状态（受控）。 */
  isExpanded?: boolean;
  /**
   * 非受控时的初始展开状态。
   * @default false
   */
  defaultExpanded?: boolean;
  /** 展开状态变化时的回调。 */
  onExpandedChange?: (isExpanded: boolean) => void;
  /** 传入后点击标题区域可跳转至目标地址，左侧箭头独立控制展开与折叠。 */
  href?: string;
  /** 传入后点击标题区域触发回调，左侧箭头独立控制展开与折叠；不传 `href` 且不传 `onPress` 时点击整行切换展开与折叠。 */
  onPress?: AriaButtonProps["onPress"];
  /** 手动指定该分组行是否为当前页；未传入时若存在 `href` 则与 `NavList` 的 `currentHref` 比对。 */
  isCurrent?: boolean;
  /** 分组行是否处于选中/按下状态（输出 `aria-pressed`），适用于工作区筛选等切换语义。 */
  isSelected?: boolean;
  /** 拆分触发模式下展开/折叠按钮的无障碍名称；未传入时使用内置“展开/折叠”文案。 */
  toggleLabel?: string;
  /** 是否禁用交互。 */
  isDisabled?: boolean;
  /** 子级 `NavItem` 或嵌套 `NavGroup` 列表。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
}

/**
 * 可展开折叠的级联导航分组行，支持多级嵌套、垂直引导线、行尾操作以及拆分的标题/折叠触发模式。
 */
export function NavGroup({
  label,
  icon,
  trailing,
  actions,
  isExpanded,
  defaultExpanded = false,
  onExpandedChange,
  href,
  onPress,
  isCurrent,
  isSelected,
  toggleLabel,
  isDisabled = false,
  children,
  className,
  ...rest
}: NavGroupProps) {
  const t = useStrings(navListStrings);
  const { currentHref, onNavigate } = useContext(NavListContext);
  const collapsed = useContext(NavCollapsedContext);
  const labelId = useId();
  const listId = useId();
  const [ownExpanded, setOwnExpanded] = useState(defaultExpanded);
  const expanded = isExpanded ?? ownExpanded;
  const toggle = () => {
    const next = !expanded;
    if (isExpanded === undefined) setOwnExpanded(next);
    onExpandedChange?.(next);
  };
  const { hoverProps, isHovered } = useHover({ isDisabled });
  const [isFocusWithin, setFocusWithin] = useState(false);
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusWithin });

  const hasChildren = Children.count(children) > 0;
  const showChildren = !collapsed && expanded && hasChildren;
  const split = href !== undefined || onPress !== undefined;
  const current = isCurrent ?? (href !== undefined && currentHref !== undefined && currentHref === href);
  const textLabel = typeof label === "string" ? label : undefined;
  const chevronAriaLabel =
    toggleLabel ??
    (textLabel ? (expanded ? t.collapseItem({ name: textLabel }) : t.expandItem({ name: textLabel })) : expanded ? t.collapse : t.expand);

  const iconNode = icon ? (
    <span className="ui-nav-group__icon" aria-hidden="true">
      {icon}
    </span>
  ) : collapsed && textLabel ? (
    <span className="ui-nav-group__icon ui-nav-item__initial" aria-hidden="true">
      {[...textLabel][0]}
    </span>
  ) : null;

  const triggerContent = (
    <>
      {!split ? (
        <span className="ui-nav-group__chevron" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      ) : null}
      {iconNode}
      <span id={labelId} className="ui-nav-group__label">
        {label}
      </span>
      {trailing ? <span className="ui-nav-group__trailing">{trailing}</span> : null}
    </>
  );

  const mainControl = !split ? (
    <AriaButton
      className="ui-nav-group__trigger"
      isDisabled={isDisabled}
      aria-expanded={expanded}
      aria-controls={showChildren ? listId : undefined}
      onPress={toggle}
    >
      {triggerContent}
    </AriaButton>
  ) : href !== undefined ? (
    <AriaLink
      href={href}
      className="ui-nav-group__trigger"
      isDisabled={isDisabled}
      aria-current={current ? "page" : undefined}
      onPress={(e) => {
        onPress?.(e);
        onNavigate?.();
      }}
    >
      {triggerContent}
    </AriaLink>
  ) : (
    <AriaButton
      className="ui-nav-group__trigger"
      isDisabled={isDisabled}
      aria-current={current ? "page" : undefined}
      aria-pressed={isSelected !== undefined ? isSelected : undefined}
      onPress={(e) => {
        onPress?.(e);
        onNavigate?.();
      }}
    >
      {triggerContent}
    </AriaButton>
  );

  const row = (
    <div
      {...mergeProps(hoverProps, focusWithinProps)}
      {...rest}
      className="ui-nav-group__row"
      data-hovered={isHovered || undefined}
      data-focus-within={isFocusWithin || undefined}
      data-expanded={expanded || undefined}
      data-current={current || undefined}
      data-selected={isSelected || undefined}
      data-disabled={isDisabled || undefined}
      data-split={split || undefined}
      data-has-trailing={trailing && actions ? "" : undefined}
    >
      {split && !collapsed ? (
        <AriaButton
          className="ui-nav-group__toggle"
          isDisabled={isDisabled}
          aria-expanded={expanded}
          aria-controls={showChildren ? listId : undefined}
          aria-label={chevronAriaLabel}
          onPress={toggle}
        >
          <ChevronRightIcon />
        </AriaButton>
      ) : null}
      {collapsed ? (
        <TooltipTrigger delay={300}>
          {mainControl}
          <Tooltip placement="end">{label}</Tooltip>
        </TooltipTrigger>
      ) : (
        mainControl
      )}
      {actions && !collapsed ? <span className="ui-nav-list__actions">{actions}</span> : null}
    </div>
  );

  return (
    <li className={className ? `ui-nav-group ${className}` : "ui-nav-group"} data-expanded={expanded || undefined}>
      {row}
      {showChildren ? (
        <ul id={listId} className="ui-nav-group__items" aria-labelledby={labelId}>
          {children}
        </ul>
      ) : null}
    </li>
  );
}

export interface NavItemProps extends DataAttributes {
  /** 目标页面地址；不传时渲染为动作按钮，通过 `onPress` 响应点击。 */
  href?: string;
  /** 导航项文字。 */
  children?: ReactNode;
  /** 文字前的装饰性图标。 */
  icon?: ReactNode;
  /** 文字右侧的补充内容，例如计数、时间或 Badge；同时传入 `actions` 时在细指针设备悬停或聚焦后切换为操作区。 */
  trailing?: ReactNode;
  /** 行尾的辅助操作区（例如“更多”菜单按钮），默认在悬停、键盘聚焦或触屏下显示。 */
  actions?: ReactNode;
  /** 手动指定是否为当前页；未传入时与 NavList 的 `currentHref` 自动比对。 */
  isCurrent?: boolean;
  /** 是否禁用交互。 */
  isDisabled?: boolean;
  /** 点击或键盘激活时触发。 */
  onPress?: AriaButtonProps["onPress"];
  /** 链接打开目标（仅传入 `href` 时生效）。 */
  target?: AriaLinkProps["target"];
  /** 链接关系属性（仅传入 `href` 时生效）。 */
  rel?: AriaLinkProps["rel"];
  /** 链接下载属性（仅传入 `href` 时生效）。 */
  download?: AriaLinkProps["download"];
  /** 元素 id。 */
  id?: string;
  /** 无障碍名称。 */
  "aria-label"?: string;
  /** 快捷键说明。 */
  "aria-keyshortcuts"?: string;
  /** 自定义类名。 */
  className?: string;
}

/**
 * 单个导航项；传入 `href` 时渲染为路由链接，省略 `href` 时渲染为动作按钮。
 */
export function NavItem({
  href,
  children,
  icon,
  trailing,
  actions,
  isCurrent,
  isDisabled = false,
  onPress,
  target,
  rel,
  download,
  id,
  "aria-label": ariaLabel,
  "aria-keyshortcuts": ariaKeyshortcuts,
  className,
  ...rest
}: NavItemProps) {
  const { currentHref, onNavigate } = useContext(NavListContext);
  const collapsed = useContext(NavCollapsedContext);
  const current = isCurrent ?? (href !== undefined && currentHref !== undefined && currentHref === href);
  const { hoverProps, isHovered } = useHover({ isDisabled });
  const [isFocusWithin, setFocusWithin] = useState(false);
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusWithin });

  const inner = (
    <>
      {icon ? (
        <span className="ui-nav-item__icon" aria-hidden="true">
          {icon}
        </span>
      ) : collapsed && typeof children === "string" ? (
        // 收起时没有图标的项显示名称的第一个字，不然什么都看不到
        <span className="ui-nav-item__icon ui-nav-item__initial" aria-hidden="true">
          {[...children][0]}
        </span>
      ) : null}
      {/* 收起时文字看不见但还在（宽度为 0），链接的读屏名称不变 */}
      <span className="ui-nav-item__label">{children}</span>
      {trailing ? <span className="ui-nav-item__trailing">{trailing}</span> : null}
    </>
  );

  const sharedProps = {
    id,
    isDisabled,
    "aria-label": ariaLabel,
    "aria-keyshortcuts": ariaKeyshortcuts,
    "aria-current": current ? ("page" as const) : undefined,
    className: actions ? "ui-nav-item" : className ? `ui-nav-item ${className}` : "ui-nav-item",
    onPress: (e: Parameters<NonNullable<AriaButtonProps["onPress"]>>[0]) => {
      onPress?.(e);
      onNavigate?.();
    },
  };

  const control =
    href !== undefined ? (
      <AriaLink {...(actions ? undefined : rest)} {...sharedProps} href={href} target={target} rel={rel} download={download}>
        {inner}
      </AriaLink>
    ) : (
      <AriaButton {...(actions ? undefined : rest)} {...sharedProps}>
        {inner}
      </AriaButton>
    );

  const wrappedControl = collapsed ? (
    <TooltipTrigger delay={300}>
      {control}
      <Tooltip placement="end">{children}</Tooltip>
    </TooltipTrigger>
  ) : (
    control
  );

  if (!actions || collapsed) {
    return <li className="ui-nav-list__item">{wrappedControl}</li>;
  }

  return (
    <li className="ui-nav-list__item">
      <div
        {...mergeProps(hoverProps, focusWithinProps)}
        {...rest}
        className={className ? `ui-nav-list__row ${className}` : "ui-nav-list__row"}
        data-hovered={isHovered || undefined}
        data-focus-within={isFocusWithin || undefined}
        data-current={current || undefined}
        data-disabled={isDisabled || undefined}
        data-has-trailing={trailing ? "" : undefined}
      >
        {wrappedControl}
        <span className="ui-nav-list__actions">{actions}</span>
      </div>
    </li>
  );
}
