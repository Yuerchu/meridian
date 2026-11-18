"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import "./badge.css";

/**
 * 徽章：短小的状态或分类标签，例如"实验中""必填""3 个未读"。不能点击。
 * 能点击、能删除的标签用 TagGroup；页面级的提示用 Alert。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** 徽章文字，一两个词。状态要写在文字里，不能只靠颜色。 */
  children?: ReactNode;
  /**
   * 语气。neutral 用于一般分类；accent 用于"新""推荐"这类要引起注意的；success / warning / danger 表示状态。
   * @default "neutral"
   */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  /**
   * 尺寸。sm 用于表格、列表行里；md 用于标题旁边。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 文字前加一个同色圆点，常用于表示在线、运行中这类状态。 */
  hasDot?: boolean;
  /** 指向底层的 span 元素。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 徽章。浅底深字，所有语气的对比度都在 4.5 以上。
 */
export function Badge({ tone = "neutral", size = "md", hasDot, children, className, ...props }: BadgeProps) {
  return (
    <span {...props} className={className ? `ui-badge ${className}` : "ui-badge"} data-tone={tone} data-size={size}>
      {hasDot ? <span className="ui-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
