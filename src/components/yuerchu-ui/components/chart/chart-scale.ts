/*
 * 图表的刻度和文字：刻度数按可用像素算，标签放不下时隔几个显示一个，时间标签按刻度间隔选格式。
 * 都是纯函数，服务端也能算（文字宽度用估算，不量 DOM）。
 */
import { scaleLinear } from "d3-scale";

/** 两个刻度之间至少隔这么多像素 */
export const MIN_TICK_SPACING = 50;
/** 相邻两个标签之间至少留这么宽 */
export const LABEL_GAP = 10;

/** 刻度数：目标 5 个，地方小就少几个，至少 2 个 */
export function tickTarget(px: number, max = 5): number {
  return Math.max(2, Math.min(max, Math.floor(px / MIN_TICK_SPACING)));
}

const WIDE = /[…ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** 文字宽度估算：中日韩、全角字符和省略号按 1em（中文字体中“…”为全角），其余字符按 0.6em */
export function textWidth(text: string, fontPx = 12): number {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? fontPx : fontPx * 0.6;
  return w;
}

/**
 * 标签太挤时隔几个显示一个：返回步长 k，只显示下标是 k 的倍数的标签。
 * positions 是标签中心，widths 是标签宽度。
 */
export function labelStride(positions: number[], widths: number[], gap = LABEL_GAP): number {
  for (let k = 1; k < positions.length; k++) {
    let prevEnd = -Infinity;
    let fits = true;
    for (let i = 0; i < positions.length; i += k) {
      const half = widths[i]! / 2;
      if (positions[i]! - half < prevEnd + gap) {
        fits = false;
        break;
      }
      prevEnd = positions[i]! + half;
    }
    if (fits) return k;
  }
  return Math.max(1, positions.length);
}

/**
 * 数值轴：取整齐的范围和刻度（步长是 1 / 2 / 5 × 10ⁿ），小数位数跟着步长走（步长 0.5 显示一位，不会出现 0.30000000000000004）。
 */
export function linearTicks(domain: [number, number], px: number): { domain: [number, number]; ticks: number[]; digits: number } {
  let [lo, hi] = domain;
  if (lo === hi) {
    // 只有一个值（或全是 0）：上下各留一点，不画成一条贴着轴的线
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad;
    hi += pad;
  }
  const count = tickTarget(px);
  const scale = scaleLinear().domain([lo, hi]).nice(count);
  const ticks = scale.ticks(count);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return { domain: scale.domain() as [number, number], ticks, digits };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 时间轴标签格式：按刻度间隔选择精度（秒、分、日、月、年）；范围在同一年内不显示年份，跨天的小时刻度附加日期。
 * 小时判断阈值为 23 小时，避免夏令时当天间隔被误判为“天”。
 */
export function timeLabelFormat(ticks: Date[], domain: [Date, Date]): Intl.DateTimeFormatOptions {
  const gaps = ticks.slice(1).map((t, i) => t.getTime() - ticks[i]!.getTime());
  const gap = gaps.length ? Math.min(...gaps) : domain[1].getTime() - domain[0].getTime();
  const sameYear = domain[0].getFullYear() === domain[1].getFullYear();
  const sameDay = sameYear && domain[0].getMonth() === domain[1].getMonth() && domain[0].getDate() === domain[1].getDate();
  if (gap < MINUTE) return { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  if (gap < 23 * HOUR) {
    const time: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    return sameDay ? time : { month: "numeric", day: "numeric", ...time };
  }
  if (gap < 28 * DAY) return sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" };
  if (gap < 365 * DAY) return sameYear ? { month: "short" } : { year: "numeric", month: "short" };
  return { year: "numeric" };
}

/** 提示框和读屏里的完整时间：比刻度标签多一档精度，范围跨年时带年份 */
export function timeDetailFormat(domain: [Date, Date], hasTime: boolean): Intl.DateTimeFormatOptions {
  const sameYear = domain[0].getFullYear() === domain[1].getFullYear();
  return {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  };
}

/** 数据里有没有不在零点的时间（决定提示框要不要显示时分） */
export const hasTimeOfDay = (dates: Date[]) =>
  dates.some((d) => d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0);

/** 超过 maxWidth 的标签进行截断并在末尾添加“…”（完整文本保留在提示框、表格和读屏中） */
export function truncateLabel(text: string, maxWidth: number, fontPx = 12): string {
  if (textWidth(text, fontPx) <= maxWidth) return text;
  let out = "";
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`, fontPx) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}

/**
 * 柱子的路径：只有数值那一端是圆角（另一端贴着基线或下一段）。
 * end 是圆角的一边；null 表示四角都是直角（堆叠中间的段）。圆角不超过宽、高的一半。
 */
export function barPath(x: number, y: number, w: number, h: number, radius: number, end: "top" | "bottom" | "left" | "right" | null): string {
  if (w <= 0 || h <= 0) return "";
  const r = end ? Math.min(radius, (end === "top" || end === "bottom" ? w : h) / 2, end === "top" || end === "bottom" ? h : w) : 0;
  const [tl, tr, br, bl] =
    end === "top" ? [r, r, 0, 0] : end === "bottom" ? [0, 0, r, r] : end === "right" ? [0, r, r, 0] : end === "left" ? [r, 0, 0, r] : [0, 0, 0, 0];
  return [
    `M${x + tl},${y}`,
    `H${x + w - tr}`,
    tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : "",
    `V${y + h - br}`,
    br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : "",
    `H${x + bl}`,
    bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : "",
    `V${y + tl}`,
    tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : "",
    "Z",
  ].join("");
}
