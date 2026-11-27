"use client";

import type { ReactNode, Ref } from "react";
import { useDateFormatter, VisuallyHidden } from "react-aria";
import { useLoadingPhase } from "../reveal/reveal";
import { Skeleton } from "../skeleton/skeleton";
import { useStrings } from "../../lib/i18n";
import { timelineStrings } from "./timeline.strings";
import "./timeline.css";

/**
 * 按时间顺序展示已发生的历史事件（如部署记录、操作审计与工单流转），支持按天自动分组并吸顶展示日期标题。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

export interface TimelineItem {
  /** 事件的唯一标识。 */
  id: string;
  /** 事件发生时间。 */
  time: Date;
  /** 事件标题摘要，例如“华东干线班车已完成分拨装车”。 */
  title: ReactNode;
  /** 补充说明、操作链接或状态徽标。 */
  description?: ReactNode;
  /**
   * 事件状态语气，控制节点圆点颜色：`success` 表示成功，`warning` 表示需要注意，`danger` 表示失败，`neutral` 为普通记录。
   * @default "neutral"
   */
  tone?: "neutral" | "success" | "warning" | "danger";
}

export interface TimelineProps {
  /** 已按时间顺序排好的事件数组（组件内部不重新排序）。 */
  items: TimelineItem[];
  /**
   * 是否按日期分组并在每组顶部显示吸顶日期标题。
   * @default true
   */
  groupByDay?: boolean;
  /** 用于计算日期与时刻的时区（例如 `"Asia/Shanghai"`）；未传入时默认使用浏览器所在时区，服务端渲染时建议显式指定。 */
  timeZone?: string;
  /**
   * 读屏区域名称。
   * @default "时间线"（英文界面 "Timeline"）
   */
  "aria-label"?: string;
  /**
   * 是否处于加载中；列表为空时按统一的延迟规则显示占位骨架并标记 `aria-busy`，已有条目时则保留原有内容。
   */
  isLoading?: boolean;
  /**
   * 空白加载时渲染的占位条数。
   * @default 3
   */
  loadingItemCount?: number;
  /**
   * 空白加载期间向读屏播报的提示文本。
   * @default "正在加载"（英文界面 "Loading"）
   */
  loadingLabel?: string;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}


/**
 * 将每天的事件渲染为有序列表并为每条记录标注 `<time datetime>`；除颜色圆点外还会向读屏输出状态前缀（如“失败：”），日期格式跟随全局语言设置。
 */
export function Timeline({
  items,
  groupByDay = true,
  timeZone,
  "aria-label": ariaLabelProp,
  isLoading = false,
  loadingItemCount = 3,
  loadingLabel: loadingLabelProp,
  className,
  ref,
}: TimelineProps) {
  const t = useStrings(timelineStrings);
  const loadingLabel = loadingLabelProp === undefined ? t.loading : loadingLabelProp;
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const { phase } = useLoadingPhase(isLoading);
  const dayFormat = useDateFormatter({ month: "long", day: "numeric", weekday: "short", timeZone });
  const keyFormat = useDateFormatter({ year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const timeFormat = useDateFormatter({ hour: "2-digit", minute: "2-digit", timeZone });

  // 相邻的、同一天的事件放一组（不重新排序）
  const groups: { day: string; label: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const day = groupByDay ? keyFormat.format(item.time) : "";
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, label: groupByDay ? dayFormat.format(item.time) : "", items: [item] });
  }

  return (
    <div ref={ref} role="group" aria-label={ariaLabel} aria-busy={isLoading || undefined} className={className ? `ui-timeline ${className}` : "ui-timeline"}>
      {isLoading && items.length === 0 ? (
        <>
          <VisuallyHidden>{loadingLabel}</VisuallyHidden>
          {/* 和真实事件同样的结构：时间、圆点、标题和说明。等待阶段占住位置但看不见 */}
          <ol className="ui-timeline__list" aria-hidden="true" data-loading="" data-waiting={phase === "waiting" || undefined}>
            {Array.from({ length: loadingItemCount }, (_, i) => (
              <li key={i} className="ui-timeline__item" data-tone="neutral">
                <Skeleton className="ui-timeline__time" width="3em" />
                <span className="ui-timeline__marker" />
                <div className="ui-timeline__body">
                  <Skeleton className="ui-timeline__title" width={i % 2 ? "45%" : "65%"} />
                  <Skeleton className="ui-timeline__description" width="30%" />
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {groups.map((group) => (
        <section key={group.day || "all"} className="ui-timeline__group" aria-label={group.label || undefined}>
          {group.label ? (
            <div className="ui-timeline__day" aria-hidden="true">
              {group.label}
            </div>
          ) : null}
          <ol className="ui-timeline__list">
            {group.items.map((item) => {
              const tone = item.tone ?? "neutral";
              return (
                <li key={item.id} className="ui-timeline__item" data-tone={tone}>
                  <time className="ui-timeline__time" dateTime={item.time.toISOString()}>
                    {timeFormat.format(item.time)}
                  </time>
                  <span className="ui-timeline__marker" aria-hidden="true" />
                  <div className="ui-timeline__body">
                    <div className="ui-timeline__title">
                      {t[tone] ? <span className="ui-timeline__tone-text">{t[tone]}</span> : null}
                      {item.title}
                    </div>
                    {item.description ? <div className="ui-timeline__description">{item.description}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
