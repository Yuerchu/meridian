"use client";

import type { ReactNode, Ref } from "react";
import "./empty-state.css";

/**
 * 空状态：列表、表格、页面没有内容时，说明为什么是空的、接下来可以做什么。
 * 加载中用 Skeleton；出错用 Alert；搜索没有结果也用这个（说明换个关键词）。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface EmptyStateProps {
  /** 一句话说清是什么情况，例如"还没有项目"。（不叫 title：避免和会弹出浏览器原生提示的 title 属性混淆） */
  heading: ReactNode;
  /**
   * 标题级别，按页面结构选。
   * @default 2
   */
  headingLevel?: 2 | 3 | 4;
  /** 补充说明：为什么是空的、怎么让它不空。 */
  description?: ReactNode;
  /** 图标，只做装饰（对读屏隐藏）。 */
  icon?: ReactNode;
  /** 下一步操作，例如"新建项目"按钮。主操作放最前面。 */
  actions?: ReactNode;
  /**
   * 尺寸。md 用在页面主体；sm 用在表格、列表、弹层里（例如 Table 的 renderEmptyState）。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 空状态。居中排列图标、标题、说明和操作；图标放在一个浅色圆底里。
 */
export function EmptyState({ heading, headingLevel = 2, description, icon, actions, size = "md", className, ref }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div ref={ref} className={className ? `ui-empty-state ${className}` : "ui-empty-state"} data-size={size}>
      {icon ? (
        <span className="ui-empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="ui-empty-state__text">
        <Heading className="ui-empty-state__heading">{heading}</Heading>
        {description ? <p className="ui-empty-state__description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-empty-state__actions">{actions}</div> : null}
    </div>
  );
}
