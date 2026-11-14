"use client";

import type { HTMLAttributes, ReactNode } from "react";

/**
 * 一段说明文字：纯文字时是 <p>；传进来的是元素（列表、<dl>、多段）时换成 <div>，避免 <p> 里套块级元素。
 * 用在 Dialog、AlertDialog、Drawer 的 description 这类"可能是一句话、也可能是一段内容"的位置。
 */
export function TextBlock({ children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  const Tag = typeof children === "string" || typeof children === "number" ? "p" : "div";
  return <Tag {...props}>{children}</Tag>;
}
