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
 * 用于跳转到站内其他页面、页内锚点或外部地址的导航链接。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface LinkProps extends Omit<AriaLinkProps, "children" | "target" | "rel"> {
  /** 链接显示文本，建议使用能独立表达去向的文案（如“查看账单明细”）。 */
  children?: ReactNode;
  /**
   * 视觉变体。`inline` 用于正文段落（带下划线）；`standalone` 用于导航或独立链接列表。
   * @default "inline"
   */
  variant?: "inline" | "standalone";
  /** 是否为外部链接；开启后在新窗口打开、附加 `rel="noopener noreferrer"` 与外链箭头，并向读屏提供“（在新窗口打开）”提示。 */
  isExternal?: boolean;
  /** 指向底层的 a 元素。 */
  ref?: Ref<HTMLAnchorElement>;
}

/**
 * 渲染站内路由或外部链接，支持正文内联与独立列表两种外观，并自动处理 `aria-current="page"` 与外链安全属性。
 * 站内链接通过 UIProvider 配置的路由能力进行跳转。
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
