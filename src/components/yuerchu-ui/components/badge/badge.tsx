"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import "./badge.css";

/**
 * 用于在标题、表格或列表项旁展示简短的状态、分类或数量标签。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** 徽章文案，通常为一两个词。状态含义需体现在文字中，避免只靠颜色区分。 */
  children?: ReactNode;
  /**
   * 徽章语气。`neutral` 用于常规分类，`accent` 用于“上新”“推荐”等需要突出的标签，`success` / `warning` / `danger` 用于表达状态。
   * @default "neutral"
   */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  /**
   * 徽章尺寸。`sm` 适合表格行与列表项，`md` 适合标题旁。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 是否在文字前显示同色圆点，常用于在线或运行中等持续状态。 */
  hasDot?: boolean;
  /** 根元素引用。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 静态状态与分类徽章组件。
 */
export function Badge({ tone = "neutral", size = "md", hasDot, children, className, ...props }: BadgeProps) {
  return (
    <span {...props} className={className ? `ui-badge ${className}` : "ui-badge"} data-tone={tone} data-size={size}>
      {hasDot ? <span className="ui-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
