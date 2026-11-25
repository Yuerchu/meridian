"use client";

import type { Ref } from "react";
import { useEffect, useState } from "react";
import { Link as AriaLink } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { tableOfContentsStrings } from "./table-of-contents.strings";
import "./table-of-contents.css";

/**
 * 列出当前页面的各级标题，点击可跳转至对应章节，并在页面滚动时自动高亮当前所在位置。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface TocItem {
  /** 标题元素的 `id`。 */
  id: string;
  /** 目录中展示的标题文字。 */
  label: string;
  /** 标题层级（2 或 3），3 级标题会额外缩进。 */
  level: 2 | 3;
}

export interface TableOfContentsProps {
  /** 按页面阅读顺序排列的目录项列表。 */
  items: TocItem[];
  /**
   * 导航地标的无障碍名称。
   * @default "本页目录"（英文界面 "On this page"）
   */
  "aria-label"?: string;
  /**
   * 标题滚动至距离视口顶部多少像素以内时判定为“当前所在章节”；页面有固定顶栏时可叠加顶栏高度。
   * @default 96
   */
  offset?: number;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向 `<nav>` 元素的引用。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 页面内锚点目录。组件渲染为带名称的 `nav` 地标区域，当前所在章节的链接带有 `aria-current="location"`。
 */
export function TableOfContents({ items, "aria-label": ariaLabelProp, offset = 96, className, ref }: TableOfContentsProps) {
  const t = useStrings(tableOfContentsStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | undefined = items[0]?.id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= offset) current = item.id;
      }
      // 滚到页面底部时，最后几节可能永远到不了顶部：直接算最后一节
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = items.at(-1)?.id;
      setActiveId(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items, offset]);

  if (items.length === 0) return null;
  return (
    <nav ref={ref} aria-label={ariaLabel} className={className ? `ui-toc ${className}` : "ui-toc"}>
      <ol className="ui-toc__list">
        {items.map((item) => (
          <li key={item.id} className="ui-toc__item" data-level={item.level}>
            <AriaLink href={`#${item.id}`} className="ui-toc__link" aria-current={activeId === item.id ? "location" : undefined}>
              {item.label}
            </AriaLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}
