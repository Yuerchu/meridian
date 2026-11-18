"use client";

import type { Format } from "@number-flow/react";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import type { Ref } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale, useNumberFormatter, VisuallyHidden } from "react-aria";
import { useMotionTokens } from "../../lib/motion";
import "./animated-number.css";

/**
 * 会变化的数字：变化时只有变了的那几位滚动，变大往上滚、变小往下滚，看一眼就知道涨了还是跌了。
 * 可以在旁边短暂浮出差值（+18、−3），适合实时刷新的数字，例如在线人数、队列长度。
 * 不会变化的数字直接写文字；带标签、变化率和趋势图的指标卡片用 Stat。
 *
 * @packageDocumentation
 * @category 数据
 * @status 实验中
 */

export interface AnimatedNumberProps {
  /** 当前值。 */
  value: number;
  /** 数值格式（Intl.NumberFormat 选项），例如 `{ style: "currency", currency: "CNY" }`、`{ notation: "compact" }`。不支持科学计数法。 */
  format?: Format;
  /** 数字前面的文字，例如"约"。 */
  prefix?: string;
  /** 数字后面的文字，例如"/月"。 */
  suffix?: string;
  /**
   * 变化时在数字旁边短暂浮出差值（+18、−3），停留 --dur-linger 后淡出。
   * 短时间内连续变化会合并成一个累计值，不会叠出一串。差值只是视觉提示，读屏读的是数字本身。
   * @default false
   */
  showChange?: boolean;
  /** 差值的格式。默认沿用 format，并总是带正负号。 */
  changeFormat?: Intl.NumberFormatOptions;
  /**
   * 哪个方向是好的，决定差值的颜色：up（收入、在线人数）是涨绿跌红，down（成本、错误数、排队）反过来，neutral 不分好坏，灰色。
   * @default "neutral"
   */
  positiveIs?: "up" | "down" | "neutral";
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 会变化的数字，基于 NumberFlow（MIT）。时长和缓动来自动效 token，减弱动效时直接跳到新值；
 * 读屏读的是格式化后的完整数字（和页面上看到的一致）。
 *
 * @promote value, format, showChange, positiveIs
 */
export function AnimatedNumber({
  value,
  format,
  prefix,
  suffix,
  showChange = false,
  changeFormat,
  positiveIs = "neutral",
  className,
  ref,
}: AnimatedNumberProps) {
  const { locale } = useLocale();
  const m = useMotionTokens();
  const formatter = useNumberFormatter(format ?? {});
  const change = useChange(value, showChange, m.duration.linger * 1000);
  const changeFormatter = useNumberFormatter(changeFormat ?? { ...format, signDisplay: "exceptZero" });
  const tone = !change || positiveIs === "neutral" ? "neutral" : (change.total > 0) === (positiveIs === "up") ? "good" : "bad";
  const opacity = { duration: m.duration.fast * 1000, easing: `cubic-bezier(${m.ease.standard.join(",")})` };
  return (
    <span ref={ref} className={className ? `ui-animated-number ${className}` : "ui-animated-number"}>
      <VisuallyHidden>{`${prefix ?? ""}${formatter.format(value)}${suffix ?? ""}`}</VisuallyHidden>
      <NumberFlow
        className="ui-animated-number__flow"
        aria-hidden="true"
        value={value}
        locales={locale}
        format={format}
        prefix={prefix}
        suffix={suffix}
        // 减弱动效由我们统一判断（同时认页面上的 data-motion 和系统偏好），不用 NumberFlow 自己的
        animated={!m.reduced}
        respectMotionPreference={false}
        transformTiming={m.springTiming}
        spinTiming={m.springTiming}
        opacityTiming={opacity}
      />
      <AnimatePresence>
        {change ? (
          <motion.span
            // 累计值变了换一个 key：旧的往上飘走，新的从下面升起
            key={change.id}
            className="ui-animated-number__change"
            data-tone={tone}
            aria-hidden="true"
            initial={{ opacity: 0, y: m.swapDistance }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -m.swapDistance * 2, transition: { duration: m.duration.standard, ease: m.ease.standard } }}
            transition={{ default: m.spring, opacity: { duration: m.duration.fast, ease: m.ease.enter } }}
          >
            {changeFormatter.format(change.total)}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

interface Change {
  /** 每次累计值变化都换一个 id，用来重播进场 */
  id: number;
  /** 这一轮累计的差值 */
  total: number;
}

/**
 * 记录最近一轮的差值：值变了就加进累计值，并把停留时间从头算起；停留时间到了清空。
 * 首次渲染不算变化。
 */
function useChange(value: number, enabled: boolean, linger: number): Change | null {
  const [change, setChange] = useState<Change | null>(null);
  const previous = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // id 一直递增（不跟着清空归零）：新提示不会和正在淡出的旧提示用同一个 key
  const ids = useRef(0);
  useEffect(() => {
    const diff = value - previous.current;
    previous.current = value;
    if (!enabled || diff === 0 || !Number.isFinite(diff)) return;
    const id = ++ids.current;
    setChange((c) => ({ id, total: (c?.total ?? 0) + diff }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setChange(null), linger);
  }, [value, enabled, linger]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // 累计到 0（涨了又跌回来）就不显示
  return change && change.total !== 0 ? change : null;
}
