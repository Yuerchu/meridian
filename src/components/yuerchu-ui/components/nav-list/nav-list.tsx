"use client";

import type { ReactNode, Ref } from "react";
import { createContext, useContext, useId } from "react";
import type { LinkProps as AriaLinkProps } from "react-aria-components";
import { Link as AriaLink } from "react-aria-components";
import { Tooltip, TooltipTrigger } from "../tooltip/tooltip";
import "./nav-list.css";

/**
 * 在侧边栏中展示可分组的纵向页面导航链接，并高亮标识当前所在页面。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

const NavListContext = createContext<{ currentHref?: string; onNavigate?: () => void }>({});

/** Sidebar 用：抽屉里点了导航项后关闭抽屉 */
export const NavigateContext = createContext<(() => void) | undefined>(undefined);

/** Sidebar 收起成图标条时为 true：导航项只显示图标，名称放进 Tooltip */
export const NavCollapsedContext = createContext(false);

export interface NavListProps {
  /** 导航区域的名称，用于在页面存在多个导航区域时加以区分，例如“主导航”。 */
  "aria-label": string;
  /** 当前页面路径，与其一致的 NavItem 会自动标为当前页，通常传入路由 pathname。 */
  currentHref?: string;
  /** 导航内容，传入 NavItem 或 NavSection。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 指向底层 nav 元素。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 纵向导航列表，渲染带名称的 `nav` 地标区域和内部列表，当前页链接自动标记 `aria-current="page"`。
 */
export function NavList({ "aria-label": ariaLabel, currentHref, children, className, ref }: NavListProps) {
  const onNavigate = useContext(NavigateContext);
  return (
    <NavListContext.Provider value={{ currentHref, onNavigate }}>
      <nav ref={ref} aria-label={ariaLabel} className={className ? `ui-nav-list ${className}` : "ui-nav-list"}>
        <ul className="ui-nav-list__items">{children}</ul>
      </nav>
    </NavListContext.Provider>
  );
}

export interface NavSectionProps {
  /** 分组标题。 */
  header: ReactNode;
  /** 该分组内的 NavItem 列表。 */
  children?: ReactNode;
}

/**
 * 带标题的一组导航项，标题通过 `aria-labelledby` 关联到组内列表。
 */
export function NavSection({ header, children }: NavSectionProps) {
  const id = useId();
  return (
    <li className="ui-nav-list__section">
      <span id={id} className="ui-nav-list__header">
        {header}
      </span>
      <ul className="ui-nav-list__items" aria-labelledby={id}>
        {children}
      </ul>
    </li>
  );
}

export interface NavItemProps extends Omit<AriaLinkProps, "children" | "className" | "style"> {
  /** 目标页面地址。 */
  href: string;
  /** 导航项文字。 */
  children?: ReactNode;
  /** 文字前的装饰性图标。 */
  icon?: ReactNode;
  /** 文字右侧的补充内容，例如计数或 Badge。 */
  trailing?: ReactNode;
  /** 手动指定是否为当前页；未传入时与 NavList 的 `currentHref` 自动比对。 */
  isCurrent?: boolean;
}

/**
 * 单个导航链接项，通过 UIProvider 配置的路由能力进行跳转。
 */
export function NavItem({ href, children, icon, trailing, isCurrent, onPress, ...props }: NavItemProps) {
  const { currentHref, onNavigate } = useContext(NavListContext);
  const collapsed = useContext(NavCollapsedContext);
  const current = isCurrent ?? (currentHref !== undefined && currentHref === href);
  const link = (
    <AriaLink
      {...props}
      href={href}
      aria-current={current ? "page" : undefined}
      className="ui-nav-item"
      onPress={(e) => {
        onPress?.(e);
        onNavigate?.();
      }}
    >
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
    </AriaLink>
  );
  return (
    <li className="ui-nav-list__item">
      {collapsed ? (
        <TooltipTrigger delay={300}>
          {link}
          <Tooltip placement="end">{children}</Tooltip>
        </TooltipTrigger>
      ) : (
        link
      )}
    </li>
  );
}
