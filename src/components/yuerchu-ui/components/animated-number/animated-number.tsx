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
 * 用于展示实时或周期性变化的数值，通过逐位滚动和可选差值提示直观呈现增减方向与幅度。
 *
 * @packageDocumentation
 * @category 数据
 * @status 实验中
 */

export interface AnimatedNumberProps {
  /** 当前数值。 */
  value: number;
  /** 数值格式（`Intl.NumberFormat` 选项），例如 `{ style: "currency", currency: "CNY" }` 或 `{ notation: "compact" }`；不支持科学计数法。 */
  format?: Format;
  /** 数值前缀文本，例如“约”。 */
  prefix?: string;
  /** 数值后缀文本，例如“/月”。 */
  suffix?: string;
  /**
   * 数值变化时是否在右侧短暂浮出累计差值（例如 `+18`、`−3`）；差值不占文档流宽度，注意在右侧留出间距。
   * 短时间内的连续变化会合并为同一轮累计值，仅作视觉提示，不影响读屏读取完整数值。
   * @default false
   */
  showChange?: boolean;
  /** 差值的格式化选项；默认沿用 `format`，并始终显示正负号。 */
  changeFormat?: Intl.NumberFormatOptions;
  /**
   * 正负趋势的语义倾向：`up` 表示增长为正向（如营收、在线人数），`down` 表示增长为负向（如成本、排队数），`neutral` 为中性灰色。
   * @default "neutral"
   */
  positiveIs?: "up" | "down" | "neutral";
  /** 自定义根元素类名。 */
  className?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 动态数值组件，基于 NumberFlow（MIT），根据系统与站点动效偏好自动切换滚动或即时更新，并向读屏暴露格式化后的完整文本。
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
