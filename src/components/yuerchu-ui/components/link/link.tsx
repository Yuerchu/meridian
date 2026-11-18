"use client";

import type { ReactNode, Ref } from "react";
import type { LinkProps as AriaLinkProps } from "react-aria-components";
import { Link as AriaLink } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { withUiClass } from "../../lib/class-name";
import { ArrowUpRightIcon } from "../../lib/icons";
import { linkStrings } from "./link.strings";
import "./link.css";

/**
 * 链接：跳转到别的页面或位置。触发操作（保存、删除、打开对话框）用 Button。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface LinkProps extends Omit<AriaLinkProps, "children" | "target" | "rel"> {
  /** 链接文字。写清楚去哪里（"查看账单"），不要写"点这里"。 */
  children?: ReactNode;
  /**
   * 外观。inline 用在正文里：accent 色 + 下划线（不能只靠颜色和周围文字区分，WCAG 1.4.1）；
   * standalone 用在导航、列表这类本身就是一列链接的地方：次要文字色，悬停变深并出下划线；当前页（aria-current="page"）是正文色。
   * @default "inline"
   */
  variant?: "inline" | "standalone";
  /** 外部链接：在新窗口打开，加 rel="noopener noreferrer"，末尾显示箭头，读屏会读出"（在新窗口打开）"。 */
  isExternal?: boolean;
  /** 指向底层的 a 元素。 */
  ref?: Ref<HTMLAnchorElement>;
}

/**
 * 链接。基于 React Aria Link：站内链接经 UIProvider 走 Next.js 客户端路由；
 * 当前页的链接写 aria-current="page"，样式随之改变。
 *
 * @promote href, routerOptions, download, isDisabled
 */
export function Link({ variant = "inline", isExternal, children, className, ...props }: LinkProps) {
  const t = useStrings(linkStrings);
  return (
    <AriaLink
      {...props}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : null)}
      className={withUiClass("ui-link", className)}
      data-variant={variant}
    >
      {children}
      {isExternal ? (
        <>
          <ArrowUpRightIcon className="ui-link__external" />
          <span className="ui-link__hint">{t.newWindow}</span>
        </>
      ) : null}
    </AriaLink>
  );
}
