"use client";

import type { ReactNode } from "react";
import { VisuallyHidden } from "react-aria";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "../../lib/icons";
import { paginationStrings } from "./pagination.strings";
import "./pagination.css";

/**
 * 用于在多页列表或表格下方按页码跳转切换。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

/**
 * 计算分页条显示的页码序列，保留首尾页及当前页左右各 `siblings` 页，其余区间以省略号代替（例如 20 页当前第 10 页时返回 `[1, "…", 9, 10, 11, "…", 20]`）。
 */
export function pageRange(page: number, totalPages: number, siblings = 1): (number | "…")[] {
  const total = Math.max(1, totalPages);
  // 固定的项数：首 + 尾 + 当前 + 两侧 + 两个省略号。页数不超过它时全部显示；超过时每一页的项数都一样，切换时分页条不会忽宽忽窄
  const slots = 5 + siblings * 2;
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (total <= slots) return range(1, total);
  const edge = 3 + siblings * 2; // 靠近首尾时，连续显示的页数
  if (page - siblings <= 3) return [...range(1, edge), "…", total];
  if (page + siblings >= total - 2) return [1, "…", ...range(total - edge + 1, total)];
  return [1, "…", ...range(page - siblings, page + siblings), "…", total];
}

export interface PaginationProps {
  /** 当前页码，从 1 开始。 */
  page: number;
  /** 总页数。 */
  totalPages: number;
  /** 页码切换回调；同时传入 `getPageHref` 时，也会在链接跳转前触发。 */
  onChange?: (page: number) => void;
  /** 页码链接生成函数；传入后页码与翻页控件渲染为链接，支持分享与新标签页打开。 */
  getPageHref?: (page: number) => string;
  /**
   * 导航区域名称，页面存在多个分页条时用于区分，例如“课程评价分页”。
   * @default "分页"（英文界面 "Pagination"）
   */
  "aria-label"?: string;
  /** 自定义类名。 */
  className?: string;
}

/**
 * 分页导航组件；外层为带名称的 `nav` 区域，当前页标记 `aria-current="page"`，容器宽度小于 400px 时自动切换为紧凑显示。
 */
export function Pagination({ page, totalPages, onChange, getPageHref, "aria-label": ariaLabelProp, className }: PaginationProps) {
  const t = useStrings(paginationStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const total = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), total);

  const control = (target: number, props: { className: string; "aria-label": string; isDisabled?: boolean; children: ReactNode; isCurrent?: boolean }) => {
    const { isCurrent, ...rest } = props;
    const common = { ...rest, "aria-current": isCurrent ? ("page" as const) : undefined, "data-current": isCurrent || undefined };
    if (getPageHref && !props.isDisabled) {
      return <AriaLink {...common} href={getPageHref(target)} onPress={() => onChange?.(target)} />;
    }
    return <AriaButton {...common} onPress={() => onChange?.(target)} />;
  };

  return (
    <nav aria-label={ariaLabel} className={className ? `ui-pagination ${className}` : "ui-pagination"}>
      <ul className="ui-pagination__list">
        <li>
          {control(current - 1, {
            className: "ui-pagination__step",
            "aria-label": t.previous,
            isDisabled: current <= 1,
            children: <ChevronLeftIcon />,
          })}
        </li>
        {pageRange(current, total).map((item, i) =>
          item === "…" ? (
            <li key={`gap-${i}`} className="ui-pagination__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item} className="ui-pagination__page-item">
              {control(item, {
                className: "ui-pagination__page",
                "aria-label": t.page({ page: item }),
                isCurrent: item === current,
                children: item,
              })}
            </li>
          ),
        )}
        {/* 窄容器里代替页码（宽的时候 display: none，读屏也读不到；窄的时候页码隐藏，读屏读这里） */}
        <li className="ui-pagination__compact">
          <span aria-hidden="true">{t.compact({ page: current, total })}</span>
          <VisuallyHidden>{t.position({ page: current, total })}</VisuallyHidden>
        </li>
        <li>
          {control(current + 1, {
            className: "ui-pagination__step",
            "aria-label": t.next,
            isDisabled: current >= total,
            children: <ChevronRightIcon />,
          })}
        </li>
      </ul>
    </nav>
  );
}
