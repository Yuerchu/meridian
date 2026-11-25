"use client";

import type { ReactNode, Ref } from "react";
import "./empty-state.css";

/**
 * 用于在列表、表格或页面暂无内容时，清晰说明当前原因并引导用户进行下一步操作。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface EmptyStateProps {
  /** 简短说明当前状况的标题，例如“还没有接入站点”。 */
  heading: ReactNode;
  /**
   * 标题语义层级，按所在页面或容器大纲结构选择。
   * @default 2
   */
  headingLevel?: 2 | 3 | 4;
  /** 补充说明为空的原因及接下来的建议操作。 */
  description?: ReactNode;
  /** 装饰性图标，渲染时自动对读屏隐藏。 */
  icon?: ReactNode;
  /** 引导按钮区，例如“新建项目”，主操作按钮建议放在最前面。 */
  actions?: ReactNode;
  /**
   * 组件尺寸：`md` 用于页面主体，`sm` 适合嵌在表格、列表或弹层内（如 `Table` 的 `renderEmptyState`）。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 自定义根元素类名。 */
  className?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 空状态占位组件，居中展示图标、标题、补充说明及操作按钮。
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
