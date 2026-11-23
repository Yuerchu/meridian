/*
 * 组件里共用的格式化。时长、token 数只在这里写一份，组件不各自实现（之前有 4 份时长格式，其中一份会出现“1 分 60 秒”）。
 * 都用 Intl 并显式传语言（未传时默认中文），服务端渲染和浏览器输出一致；组件里用 useFormat，跟着 UIProvider 的语言。
 * 普通数字和排序用 React Aria 的 useNumberFormatter / useCollator；这里放有固定写法的：时长、token 数、文件大小、百分比、金额、单位、相对时间、列举。
 */
import { useEffect, useState } from "react";
import { useLocale } from "react-aria";
import { formatStrings } from "./format.strings";
import { pickStrings } from "./i18n";

/**
 * 时长（秒），如“320 毫秒”“1.2 秒”“12 秒”“1 分 5 秒”“2 分钟”“1 小时 5 分”；英文为“320 ms”“1 min 5 s”“1 h 5 min”。
 * 先按显示精度取整再拆分，不会出现“60 秒”“60 分”。组件里用 useFormatDuration（跟着 UIProvider 的语言）；未传 locale 时默认中文。
 */
export function formatDuration(seconds: number, { locale = "zh-CN" }: { locale?: string } = {}): string {
  const t = pickStrings(formatStrings, locale);
  const s = Math.max(0, seconds);
  if (s === 0) return t.s({ n: 0 });
  if (s < 0.9995) return t.ms({ n: Math.max(1, Math.round(s * 1000)) });
  if (s < 9.95) return t.s({ n: Math.round(s * 10) / 10 });
  const total = Math.round(s);
  if (total < 60) return t.s({ n: total });
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? t.minSec({ m, s: rest }) : t.min({ m });
  }
  const minutes = Math.round(total / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t.hourMin({ h, m }) : t.hour({ h });
}

/** 时长（毫秒），同 formatDuration。 */
export const formatMilliseconds = (ms: number, options?: { locale?: string }) => formatDuration(ms / 1000, options);

/** 组件里用：按 UIProvider 的语言格式化时长（秒 / 毫秒） */
export function useFormatDuration() {
  const { locale } = useLocale();
  return { formatDuration: (seconds: number) => formatDuration(seconds, { locale }), formatMilliseconds: (ms: number) => formatMilliseconds(ms, { locale }) };
}

/**
 * token 数（紧凑写法），如“950”“18.4K”“182K”“1M”“1.3M”。不到 100K 保留一位小数。
 * 取整后进位到下一档（999,600 记作“1M”，而非“1000K”）。
 */
export function formatTokens(value: number, { locale = "zh-CN" }: { locale?: string } = {}): string {
  const { value: v, unit } = tokenParts(value);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, useGrouping: false }).format(v)}${unit}`;
}

/**
 * formatTokens 拆开的两部分：数值和单位（`""` / `"K"` / `"M"`）。供需要单独处理数值的场景使用，
 * 例如 AnimatedNumber 只滚动数值，单位作为后缀。
 */
export function tokenParts(value: number): { value: number; unit: "" | "K" | "M" } {
  const n = Math.max(0, value);
  if (n < 999.5) return { value: Math.round(n), unit: "" };
  const compact = (v: number) => (v < 99.95 ? Math.round(v * 10) / 10 : Math.round(v));
  const k = compact(n / 1000);
  if (k < 1000) return { value: k, unit: "K" };
  return { value: compact(n / 1_000_000), unit: "M" };
}

/**
 * 文件大小（按 1024 进位），如“0 B”“512 B”“12 KB”“1.2 MB”“340 MB”“2 GB”。不到 10 保留一位小数；
 * 取整后进位到下一档（1023.96 KB 记作“1 MB”，而非“1024 KB”）。
 */
export function formatBytes(bytes: number, { locale = "zh-CN" }: { locale?: string } = {}): string {
  // 单位用 KB / MB（按 1024 进位，和系统的文件管理器一致）；Intl 的 kilobyte 是 1000 进位的“kB”，不用它
  const units = ["B", "KB", "MB", "GB", "TB"];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, useGrouping: false });
  let n = Math.max(0, bytes);
  if (n < 1023.5) return `${number.format(Math.round(n))} B`;
  let i = 0;
  while (i < units.length - 1) {
    n /= 1024;
    i++;
    const shown = n < 9.95 ? Math.round(n * 10) / 10 : Math.round(n);
    if (shown < 1024 || i === units.length - 1) return `${number.format(shown)} ${units[i]}`;
  }
  return `${number.format(Math.round(n))} ${units[i]}`;
}

/**
 * 百分比，传入比例值（0.184 → “18%”）。有占用但取整后为 0 时写“<1%”（避免误以为无占用）；接近 100% 时同理写“>99%”，除非正好等于 1。
 * maximumFractionDigits 默认 0。
 */
export function formatPercent(ratio: number, { locale = "zh-CN", maximumFractionDigits = 0 }: { locale?: string; maximumFractionDigits?: number } = {}): string {
  const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits });
  const step = 10 ** -(maximumFractionDigits + 2);
  if (ratio > 0 && ratio < step / 2) return `<${format.format(step)}`;
  if (ratio < 1 && ratio > 1 - step / 2) return `>${format.format(1 - step)}`;
  return format.format(ratio);
}

/**
 * 金额，如“$0.0123”“¥1,188.00”“€12.50”。货币符号用窄写法（中文界面里美元也写“$”，不写“US$”）。
 * 未传小数位时按各货币的常规精度显示（如美元、人民币为 2 位）；很小的金额（如模型调用费用）可传入 maximumFractionDigits: 4。
 * amount 可以是十进制字符串（例如 `"0.000003"`，数据库 NUMERIC 原样传入），会直接交给 Intl 格式化而不经过 JS 浮点，避免精度丢失。
 */
export function formatMoney(
  amount: number | Intl.StringNumericLiteral,
  currency: string,
  { locale = "zh-CN", maximumFractionDigits, minimumFractionDigits }: { locale?: string; maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    ...(maximumFractionDigits !== undefined ? { maximumFractionDigits, minimumFractionDigits: Math.min(minimumFractionDigits ?? 2, maximumFractionDigits) } : {}),
    ...(minimumFractionDigits !== undefined && maximumFractionDigits === undefined ? { minimumFractionDigits } : {}),
  }).format(amount);
}

/**
 * 带单位的数，如“12 km”“3.5 GB/s”“60 km/h”。unit 是 Intl 支持的单位（如 kilometer、kilometer-per-hour、celsius 等），写法随语言变化。
 * 文件大小用 formatBytes（1024 进位），时长用 formatDuration。
 */
export function formatUnit(
  value: number,
  unit: string,
  { locale = "zh-CN", unitDisplay = "short", maximumFractionDigits = 1 }: { locale?: string; unitDisplay?: "short" | "long" | "narrow"; maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay, maximumFractionDigits }).format(value);
}

type DateInput = Date | number | string;
const toMs = (d: DateInput) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : new Date(d).getTime());

/** 某个时区里的日历日，换成那天 UTC 零点的毫秒数，用于比较“今天 / 昨天”（只取数字，和语言无关） */
function dayStart(ms: number, timeZone?: string) {
  const parts = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric", timeZone, numberingSystem: "latn" }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}
const dayDiff = (a: number, b: number, timeZone?: string) => Math.round((dayStart(a, timeZone) - dayStart(b, timeZone)) / 86_400_000);

/**
 * 相对时间，如“现在”“3 分钟前”“2 小时前”“昨天 14:20”“周三 14:20”“11月3日”“2025年11月3日”；将来时间同理（“5 分钟后”“明天 09:00”）。
 * 一小时以内按分钟，同一天按小时，相邻一天写“昨天 / 明天”加时刻，一周以内写星期加时刻，更远则写日期（非当年带年份）。
 * “今天 / 昨天”按 timeZone 的日历日计算（未传时使用浏览器时区）。组件里用 useRelativeTime 或 RelativeTime。
 */
export function formatRelativeTime(date: DateInput, now: DateInput, { locale = "zh-CN", timeZone }: { locale?: string; timeZone?: string } = {}): string {
  const at = toMs(date);
  const base = toMs(now);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = (at - base) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(seconds / 60) || Math.sign(seconds), "minute");
  const days = dayDiff(at, base, timeZone);
  if (days === 0) return rtf.format(Math.round(seconds / 3600) || Math.sign(seconds), "hour");
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
  if (Math.abs(days) === 1) return `${rtf.format(days, "day")} ${clock}`;
  if (Math.abs(days) < 7) return `${new Intl.DateTimeFormat(locale, { weekday: "short", timeZone }).format(at)} ${clock}`;
  const sameYear = new Date(dayStart(at, timeZone)).getUTCFullYear() === new Date(dayStart(base, timeZone)).getUTCFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { month: "short", day: "numeric", timeZone } : { year: "numeric", month: "short", day: "numeric", timeZone }).format(at);
}

/** 完整的时间和时区，例如“2026年11月7日星期六 GMT+8 14:20:05”（用于悬停提示和读屏播报） */
export function formatFullTime(date: DateInput, { locale = "zh-CN", timeZone }: { locale?: string; timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", timeZone }).format(toMs(date));
}

/** 相对时间下一次可能变的时刻离现在多久（毫秒）：一小时以内每分钟，同一天每小时，再远每小时检查一次跨天 */
function nextChange(times: number[], now: number) {
  let wait = 3_600_000;
  for (const at of times) {
    const abs = Math.abs(at - now);
    const step = abs < 45 * 60_000 ? 60_000 : 3_600_000;
    // 对齐到下一个整分 / 整点（相对于那个时间），最少 1 秒
    wait = Math.min(wait, Math.max(1000, step - (abs % step)));
  }
  return wait;
}

/**
 * 现在的时间，在 times 的相对时间会变的时候更新（不是每秒刷新）。页面在后台时不更新，回到前台时立刻对一次。
 * 传入 fixed（用于测试或静态页面）时直接使用该时间，不自动更新。
 */
export function useNow(times: DateInput[], fixed?: DateInput): number {
  const [tick, setTick] = useState(() => Date.now());
  const key = times.map(toMs).join(",");
  useEffect(() => {
    if (fixed !== undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      const at = Date.now();
      setTick(at);
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(run, nextChange(key ? key.split(",").map(Number) : [], at));
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [key, fixed]);
  return fixed !== undefined ? toMs(fixed) : tick;
}

/**
 * 组件里用：返回把时间写成相对时间的函数，跟着 UIProvider 的语言。未传 now 时使用当前时间并自动更新（times 为需要显示的时间列表）。
 */
export function useRelativeTime({ now, times = [], timeZone }: { now?: DateInput; times?: DateInput[]; timeZone?: string } = {}) {
  const { locale } = useLocale();
  const current = useNow(times, now);
  return (date: DateInput) => formatRelativeTime(date, current, { locale, timeZone });
}

export interface ListOptions {
  /** 语言，未传时默认中文。 */
  locale?: string;
  /** 最多列几项：超过时列前 max - 1 项，最后一项写成“另外 N 人”。未传时全部列出。 */
  max?: number;
  /** 折叠部分的写法，默认“另外 3 人”/“3 others”。不是人时可自定义，例如 ``(n) => `另外 ${n} 个文件` ``。 */
  rest?: (count: number) => string;
  /** 连接词用“和”还是“或”，如“沈佳、徐磊和唐宁”或“沈佳、徐磊或唐宁”。默认“和”。 */
  type?: "conjunction" | "disjunction";
}

/** 列表拆成要显示的几项和折叠掉的几项（NameList 要知道哪几项被折叠） */
export function splitList<T>(items: readonly T[], max?: number): { shown: T[]; hidden: T[] } {
  if (max === undefined || items.length <= max) return { shown: [...items], hidden: [] };
  const keep = Math.max(1, max - 1);
  return { shown: items.slice(0, keep), hidden: items.slice(keep) };
}

/**
 * 列举列表，如“沈佳、徐磊和唐宁”/“Shen Jia, Xu Lei, and Tang Ning”（基于 Intl.ListFormat）；超出上限时折叠为“沈佳、徐磊和另外 3 人”/“…, and 3 others”。
 * 组件里用 useListFormat（跟着 UIProvider 的语言）。
 */
export function formatList(items: readonly string[], { locale = "zh-CN", max, rest, type = "conjunction" }: ListOptions = {}): string {
  const { shown, hidden } = splitList(items, max);
  const others = rest ?? ((count: number) => pickStrings(formatStrings, locale).others({ count }));
  return new Intl.ListFormat(locale, { type }).format(hidden.length ? [...shown, others(hidden.length)] : shown);
}

/** 组件里用：按 UIProvider 的语言列举，选项同 formatList */
export function useListFormat() {
  const { locale } = useLocale();
  return (items: readonly string[], options: Omit<ListOptions, "locale"> = {}) => formatList(items, { ...options, locale });
}

/**
 * 组件里用：上面这些函数绑定 UIProvider 的语言。
 * `const f = useFormat(); f.bytes(1_300_000) → "1.2 MB"，f.money(0.0123, "USD", { maximumFractionDigits: 4 }) → "$0.0123"`
 */
export function useFormat() {
  const { locale } = useLocale();
  return {
    locale,
    duration: (seconds: number) => formatDuration(seconds, { locale }),
    milliseconds: (ms: number) => formatMilliseconds(ms, { locale }),
    tokens: (value: number) => formatTokens(value, { locale }),
    bytes: (bytes: number) => formatBytes(bytes, { locale }),
    percent: (ratio: number, options: { maximumFractionDigits?: number } = {}) => formatPercent(ratio, { ...options, locale }),
    money: (amount: number | Intl.StringNumericLiteral, currency: string, options: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {}) => formatMoney(amount, currency, { ...options, locale }),
    unit: (value: number, unit: string, options: { unitDisplay?: "short" | "long" | "narrow"; maximumFractionDigits?: number } = {}) => formatUnit(value, unit, { ...options, locale }),
    list: (items: readonly string[], options: Omit<ListOptions, "locale"> = {}) => formatList(items, { ...options, locale }),
  };
}
