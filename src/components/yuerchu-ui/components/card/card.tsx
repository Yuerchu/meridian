"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useId } from "react";
import { Link as AriaLink } from "react-aria-components";
import "./card.css";

/**
 * 用于将标题、说明、正文与底部操作组织在统一的带边框容器内，支持整卡点击跳转。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "title"> {
  /** 卡片标题。 */
  heading?: ReactNode;
  /**
   * 标题语义层级，按页面大纲结构选择；整页仅有一张主卡片（如登录页）时可设为 `1`。
   * @default 3
   */
  headingLevel?: 1 | 2 | 3 | 4;
  /** 标题下方的补充说明。 */
  description?: ReactNode;
  /** 标题右侧的操作区，例如“更多”菜单按钮。 */
  actions?: ReactNode;
  /** 卡片正文内容。 */
  children?: ReactNode;
  /** 底部区域，例如操作按钮行或更新时间，上方带分隔线。 */
  footer?: ReactNode;
  /**
   * 整卡跳转地址（需同时传入 `heading`）。标题会作为整张卡片的语义链接，内部按钮与链接仍可独立点击。
   */
  href?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 卡片容器组件。传入 `heading` 时以 `article` 语义承载并关联标题，传入 `href` 时支持整卡点击跳转与悬停反馈。
 */
export function Card({ heading, headingLevel = 3, description, actions, children, footer, href, className, ref, ...props }: CardProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const Root = heading ? "article" : "div";
  const hasHeader = heading || description || actions;
  return (
    <Root
      {...props}
      // article 和 div 的 ref 类型不同，对外统一是 HTMLElement
      ref={ref as Ref<HTMLDivElement>}
      className={className ? `ui-card ${className}` : "ui-card"}
      aria-labelledby={heading ? headingId : undefined}
      data-interactive={href && heading ? true : undefined}
    >
      {hasHeader ? (
        <header className="ui-card__header">
          <div className="ui-card__titles">
            {heading ? (
              <Heading id={headingId} className="ui-card__heading">
                {href ? (
                  <AriaLink href={href} className="ui-card__link">
                    {heading}
                  </AriaLink>
                ) : (
                  heading
                )}
              </Heading>
            ) : null}
            {description ? <p className="ui-card__description">{description}</p> : null}
          </div>
          {actions ? <div className="ui-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="ui-card__body">{children}</div> : null}
      {footer ? <footer className="ui-card__footer">{footer}</footer> : null}
    </Root>
  );
}
