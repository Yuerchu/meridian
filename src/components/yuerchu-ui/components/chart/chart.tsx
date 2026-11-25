"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { useDateFormatter, useLocale, useNumberFormatter } from "react-aria";
import { scaleBand, scaleLinear, scalePoint, scaleTime } from "d3-scale";
import type { PieArcDatum } from "d3-shape";
import { arc, area, curveLinear, curveMonotoneX, curveStepAfter, line, pie, stack, stackOffsetDiverging } from "d3-shape";
import type { ChartActive } from "./chart-frame";
import { ChartFrame, ChartPlot, TICK_FONT as FONT, TooltipRow, useSeriesState, useTween, useValueAxis } from "./chart-frame";
import { barPath, hasTimeOfDay, labelStride, textWidth, tickTarget, timeDetailFormat, timeLabelFormat, truncateLabel } from "./chart-scale";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { Button } from "../button/button";
import { chartStrings } from "./chart.strings";
import "./chart.css";

/**
 * 提供折线图、面积图、柱状图、条形图、环形图与散点图，内置图例筛选、表格视图切换与键盘读屏导航。
 *
 * @packageDocumentation
 * @category 数据
 * @status 实验中
 */

/** 单个系列配置，声明数据字段与展示名称。 */
export interface ChartSeries<K extends string = string> {
  /** 数据行中的数值字段名；值为 `null` 时表示数据缺失，折线会在该处断开。 */
  key: K;
  /** 显示在图例、提示框与数据表格中的系列名称。 */
  label: string;
}

type Keys<T> = Extract<keyof T, string>;

export interface LineChartProps<T extends object> {
  /** 图表数据，每项对应横轴上的一个点；横轴为时间或数值时会自动排序。 */
  data: readonly T[];
  /** 横轴字段名。值为 `Date` 时按时间轴渲染，为数字时按数值轴渲染，其余按有序类别处理。 */
  x: Keys<T>;
  /** 需要绘制的系列列表，建议不超过 4 个；更多系列建议合并为“其他”或拆分图表。 */
  series: ChartSeries<Keys<T>>[];
  /** 可见标题；未传标题时请配合 `aria-label` 提供无障碍名称。 */
  heading?: string;
  /**
   * 标题语义层级，按页面大纲结构选择。
   * @default 3
   */
  headingLevel?: 2 | 3 | 4;
  /** 标题下方的补充说明，例如统计口径或单位。 */
  description?: ReactNode;
  /** 未提供可见标题时的无障碍名称。 */
  "aria-label"?: string;
  /** 表格视图中横轴列的表头名称；默认按横轴类型取“时间”或“类别”。 */
  xLabel?: string;
  /**
   * 图表形态：`line` 为折线图，`area` 为填充折线下方区域的面积图。
   * @default "line"
   */
  variant?: "line" | "area";
  /** 是否开启堆叠（仅 `variant="area"` 时生效），用于同时查看总量与各系列构成。 */
  stacked?: boolean;
  /**
   * 曲线插值方式：`monotone` 为不冲出极值的平滑曲线，`step` 为适合价格或配额等阶梯变化的折线。
   * @default "linear"
   */
  curve?: "linear" | "monotone" | "step";
  /** 是否在每个数据点上绘制圆点，适合点数较少的折线。 */
  showDots?: boolean;
  /**
   * 是否允许缩放和平移横轴（仅横轴为时间或数值时可用）。
   * 鼠标横向拖拽可框选放大，按住 `Shift` 拖拽可平移，键盘可用 `+` / `-`、`Shift + ←` / `→` 与 `0` 操作；放大后标题栏会显示“重置缩放”，纵轴按可见范围重新计算。
   */
  allowsZoom?: boolean;
  /** 受控横轴显示范围 `[起, 止]`，时间轴使用毫秒时间戳，`null` 表示完整范围。 */
  zoom?: [number, number] | null;
  /** 默认横轴显示范围（非受控）。 */
  defaultZoom?: [number, number] | null;
  /** 缩放或平移导致横轴范围变化时触发，恢复完整范围时传入 `null`。 */
  onZoomChange?: (zoom: [number, number] | null) => void;
  /** 数值格式化选项（`Intl.NumberFormat`），统一作用于坐标轴、提示框、表格与读屏播报。 */
  valueFormat?: Intl.NumberFormatOptions;
  /** 自定义横轴值格式化函数，用于提示框、表格与读屏；默认时间按语言环境格式化，数字按默认千分位格式，其余转为字符串。 */
  formatX?: (value: T[Keys<T>]) => string;
  /** 手动指定纵轴范围 `[最小值, 最大值]`；默认按数据取整。 */
  yDomain?: [number, number];
  /**
   * 纵轴范围是否强制包含 `0`；面积图始终包含 `0`。
   * @default true
   */
  includeZero?: boolean;
  /**
   * 绘图区高度（像素），不含标题与图例。
   * @default 240
   */
  height?: number;
  /** 是否显示图例；默认存在两个及以上系列时显示。 */
  showLegend?: boolean;
  /**
   * 是否绘制横向网格线。
   * @default true
   */
  showGrid?: boolean;
  /**
   * 是否显示“图表 / 表格”切换控件。
   * @default true
   */
  showTableToggle?: boolean;
  /** 默认隐藏的系列 key 列表（非受控）。 */
  defaultHiddenSeries?: string[];
  /** 当前隐藏的系列 key 列表（受控）。 */
  hiddenSeries?: string[];
  /** 在图例中切换系列显隐时触发，至少保留一个可见系列。 */
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** 是否处于加载状态；加载时会显示加载指示器并暂不绘图。 */
  isLoading?: boolean;
  /**
   * 数据为空时展示的占位内容。
   * @default "暂无数据"
   */
  emptyState?: ReactNode;
  /**
   * 服务端渲染时的初始绘图宽度（像素）。传入后在静态导出阶段即可直接出图，浏览器挂载后再按容器实际宽度重绘。
   * 使用时间轴时刻度按运行环境时区计算，若服务端与浏览器时区可能不一致，请勿设置此项或配合 `formatX` 显式处理时区。
   */
  initialWidth?: number;
  /** 自定义根元素类名。 */
  className?: string;
}

const CURVES = { linear: curveLinear, monotone: curveMonotoneX, step: curveStepAfter };
const MARGIN = { top: 8, right: 12, bottom: 28 };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * 折线图与面积图组件，支持时间、数值及类别横轴，并内置键盘逐点浏览、图例过滤与表格视图切换。
 *
 * @promote aria-label
 */
export function LineChart<T extends object>({
  data,
  x,
  series,
  heading,
  headingLevel = 3,
  description,
  "aria-label": ariaLabel,
  xLabel,
  variant = "line",
  stacked = false,
  curve = "linear",
  showDots = false,
  allowsZoom = false,
  zoom: zoomProp,
  defaultZoom = null,
  onZoomChange,
  valueFormat,
  formatX,
  yDomain,
  includeZero = true,
  height = 240,
  showLegend,
  showGrid = true,
  showTableToggle = true,
  defaultHiddenSeries,
  hiddenSeries,
  onHiddenSeriesChange,
  isLoading = false,
  emptyState,
  initialWidth,
  className,
}: LineChartProps<T>) {
  const t = useStrings(chartStrings);
  const { resolved, visible, hidden, setHidden, legendHover, setLegendHover } = useSeriesState(series, {
    defaultHiddenSeries,
    hiddenSeries,
    onHiddenSeriesChange,
  });
  const isArea = variant === "area";
  const isStacked = isArea && stacked;
  const clipId = useId();

  // 横轴类型和排序
  const first = data.length ? (data[0] as Record<string, unknown>)[x] : undefined;
  const xKind: "time" | "number" | "category" = first instanceof Date ? "time" : typeof first === "number" ? "number" : "category";
  const rows = xKind === "category" ? [...data] : [...data].sort((a, b) => Number(xValue(a)) - Number(xValue(b)));
  function xValue(d: T) {
    return (d as Record<string, unknown>)[x];
  }
  const dates = xKind === "time" ? rows.map((d) => xValue(d) as Date) : [];
  const timeDomain: [Date, Date] = dates.length ? [dates[0]!, dates[dates.length - 1]!] : [new Date(0), new Date(0)];

  const valueFormatter = useNumberFormatter(valueFormat);
  const plainNumber = useNumberFormatter();
  const detailDate = useDateFormatter(timeDetailFormat(timeDomain, hasTimeOfDay(dates)));
  const xText = (d: T) => {
    const v = xValue(d);
    if (formatX) return formatX(v as T[Keys<T>]);
    if (v instanceof Date) return detailDate.format(v);
    if (typeof v === "number") return plainNumber.format(v);
    return String(v ?? "");
  };
  const valueText = (v: number | null) => (v === null ? t.noData : valueFormatter.format(v));
  const valueOf = (d: T, key: string) => num((d as Record<string, unknown>)[key]);

  // ---------- 缩放：横轴显示的范围 ----------
  const zoomable = allowsZoom && xKind !== "category" && rows.length > 2;
  const xNums = xKind === "category" ? [] : rows.map((d) => Number(xValue(d)));
  const full: [number, number] = xNums.length ? [xNums[0]!, xNums[xNums.length - 1]!] : [0, 1];
  // 最少放大到能看见三个点
  const minSpan = xNums.length > 2 ? ((full[1] - full[0]) / (xNums.length - 1)) * 2 : 0;
  const [ownZoom, setOwnZoom] = useState<[number, number] | null>(defaultZoom);
  const zoomRange = zoomable ? (zoomProp === undefined ? ownZoom : zoomProp) : null;
  const xValueText = (v: number) => (xKind === "time" ? detailDate.format(new Date(v)) : plainNumber.format(v));
  const setZoom = (next: [number, number] | null) => {
    let range = next;
    if (range) {
      let [a, b] = range;
      if (b - a < minSpan) {
        const mid = (a + b) / 2;
        [a, b] = [mid - minSpan / 2, mid + minSpan / 2];
      }
      // 不超出数据的范围（平移到头就停）
      const span = Math.min(b - a, full[1] - full[0]);
      a = Math.min(Math.max(a, full[0]), full[1] - span);
      range = [a, a + span];
      if (range[1] - range[0] >= full[1] - full[0] - 1e-9) range = null;
    }
    if (zoomProp === undefined) setOwnZoom(range);
    onZoomChange?.(range);
    announce(range ? t.zoomed({ from: xValueText(range[0]), to: xValueText(range[1]) }) : t.zoomReset);
  };
  // 范围里的点（下标连续）：键盘只在这些点之间浏览
  let winFirst = 0;
  let winLast = rows.length - 1;
  if (zoomRange) {
    winFirst = xNums.findIndex((v) => v >= zoomRange[0]);
    winLast = xNums.findLastIndex((v) => v <= zoomRange[1]);
    if (winFirst < 0 || winLast < winFirst) [winFirst, winLast] = [0, -1];
  }
  const winCount = winLast - winFirst + 1;

  // 纵轴范围：堆叠时取每列的总和
  const stackedSeries = isStacked
    ? stack<T>()
        .keys(visible.map((s) => s.key))
        .value((d, key) => valueOf(d, key) ?? 0)(rows)
    : [];
  const extentFrom = zoomRange ? Math.max(0, winFirst - 1) : 0;
  const extentTo = zoomRange ? Math.min(rows.length, winLast + 2) : rows.length;
  const values = isStacked
    ? stackedSeries.flatMap((layer) => layer.slice(extentFrom, extentTo).map((p) => p[1]))
    : rows
        .slice(extentFrom, extentTo)
        .flatMap((d) => visible.map((s) => valueOf(d, s.key)))
        .filter((v): v is number => v !== null);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (includeZero || isArea) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }

  const plotHeight = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const yAxis = useValueAxis([lo, hi], plotHeight, valueFormat, yDomain);
  const domain = yAxis.domain;
  const yLabels = yAxis.labels;
  const left = yAxis.labelWidth + 12;

  const status = isLoading ? "loading" : rows.length === 0 ? "empty" : null;
  const name = heading ?? ariaLabel ?? t.chart;

  const table = {
    xLabel: xLabel ?? (xKind === "time" ? t.time : t.category),
    rows: rows.map((d, i) => ({ key: String(i), x: xText(d), values: visible.map((s) => valueText(valueOf(d, s.key))) })),
  };

  const { locale } = useLocale();

  // 每个可见系列每个点的纵坐标（堆叠时是上沿、下沿），连同纵轴范围一起过渡
  const rawTops = visible.map((s, si) =>
    rows.map((d, i) => {
      if (isStacked) return valueOf(d, s.key) === null ? null : stackedSeries[si]![i]![1];
      return valueOf(d, s.key);
    }),
  );
  const rawBottoms = isStacked ? visible.map((_, si) => rows.map((_, i) => stackedSeries[si]![i]![0])) : [];
  const lineSignature = [variant, isStacked, visible.map((s) => s.key).join(","), rows.map((d) => String(xValue(d) instanceof Date ? (xValue(d) as Date).getTime() : xValue(d))).join(",")].join("|");
  const tweened = useTween([domain[0], domain[1], ...rawTops.flat().map((v) => v ?? NaN), ...rawBottoms.flat()], lineSignature);
  const drawnDomain: [number, number] = [tweened[0]!, tweened[1]!];
  const tops = rawTops.map((col, si) => col.map((v, i) => (v === null ? null : tweened[2 + si * rows.length + i]!)));
  const tweenedBottoms = rawBottoms.map((col, si) => col.map((_, i) => tweened[2 + rawTops.length * rows.length + si * rows.length + i]!));

  return (
    <ChartFrame
      heading={heading}
      headingLevel={headingLevel}
      description={description}
      aria-label={ariaLabel}
      series={resolved}
      hidden={hidden}
      onHiddenChange={setHidden}
      showLegend={showLegend ?? series.length > 1}
      showTableToggle={showTableToggle}
      onLegendHover={setLegendHover}
      table={table}
      status={status}
      emptyState={emptyState}
      height={height}
      initialWidth={initialWidth}
      className={className}
      dataAttributes={{ "data-variant": variant, "data-stacked": isStacked || undefined }}
      actions={
        zoomRange ? (
          <Button size="sm" variant="ghost" onPress={() => setZoom(null)}>
            {t.resetZoom}
          </Button>
        ) : null
      }
    >
      {(width) => {
        const plotWidth = Math.max(40, width - left - MARGIN.right);
        const y = scaleLinear().domain(drawnDomain).range([plotHeight, 0]);

        let xs: number[];
        let xTicks: { pos: number; label: string }[];
        // 放大时横轴只是范围变了：所有点照样算位置，绘图区外的裁掉
        let xScaleOf: ((v: number) => number) & { invert: (px: number) => number } = Object.assign((v: number) => v, { invert: (px: number) => px });
        if (xKind === "time") {
          const scale = scaleTime()
            .domain(zoomRange ? [new Date(zoomRange[0]), new Date(zoomRange[1])] : timeDomain)
            .range([0, plotWidth]);
          xScaleOf = Object.assign((v: number) => scale(new Date(v)), { invert: (px: number) => scale.invert(px).getTime() });
          xs = dates.map((d) => scale(d));
          const ticks = scale.ticks(tickTarget(plotWidth, 8));
          // 标签格式按实际的刻度间隔选（宽度不同，刻度间隔可能是天也可能是月）
          const format = new Intl.DateTimeFormat(locale, timeLabelFormat(ticks, timeDomain));
          xTicks = ticks.map((t) => ({ pos: scale(t), label: format.format(t) }));
        } else if (xKind === "number") {
          const nums = rows.map((d) => Number(xValue(d)));
          const scale = scaleLinear()
            .domain(zoomRange ?? [nums[0]!, nums[nums.length - 1]!])
            .range([0, plotWidth]);
          xScaleOf = Object.assign((v: number) => scale(v), { invert: (px: number) => scale.invert(px) });
          xs = nums.map((n) => scale(n));
          xTicks = scale.ticks(tickTarget(plotWidth, 8)).map((t) => ({ pos: scale(t), label: plainNumber.format(t) }));
        } else {
          const scale = scalePoint<number>()
            .domain(rows.map((_, i) => i))
            .range([0, plotWidth])
            .padding(0.5);
          xs = rows.map((_, i) => scale(i)!);
          xTicks = rows.map((d, i) => ({ pos: xs[i]!, label: formatX ? formatX(xValue(d) as T[Keys<T>]) : String(xValue(d) ?? "") }));
        }
        if (rows.length === 1) xs = [plotWidth / 2];
        const stride = labelStride(
          xTicks.map((t) => t.pos),
          xTicks.map((t) => textWidth(t.label, FONT)),
        );
        const shownXTicks = xTicks.filter((_, i) => i % stride === 0);

        // 不堆叠时面积填到 0（0 不在范围里时填到纵轴下沿）
        const baseline = Math.min(Math.max(0, drawnDomain[0]), drawnDomain[1]);
        const bottoms = visible.map((_, si) => rows.map((_, i) => (isStacked ? tweenedBottoms[si]![i]! : baseline)));
        const curveFactory = CURVES[curve];

        const label = [
          name,
          isStacked ? t.stackedArea : isArea ? t.area : t.line,
          t.lineCount({ series: visible.length, points: rows.length }),
          visible.length > 1 ? t.lineKeysMulti : t.lineKeys,
          zoomable ? t.zoomKeys : null,
        ]
          .filter(Boolean)
          .join(t.sep);

        // 放大时键盘只在看得到的点之间浏览：ChartPlot 的下标从范围里的第一个点算起
        const toGlobal = (a: ChartActive): ChartActive => ({ ...a, index: a.index + winFirst });

        const describe = (local: ChartActive) => {
          const a = toGlobal(local);
          const d = rows[a.index]!;
          const s = visible[a.series]!;
          return `${xText(d)}，${s.label}：${valueText(valueOf(d, s.key))}`;
        };

        const tooltip = (local: ChartActive) => {
          const a = toGlobal(local);
          const d = rows[a.index]!;
          const top = tops[a.series]![a.index];
          return {
            x: left + xs[a.index]!,
            y: MARGIN.top + (top === null || top === undefined ? plotHeight / 2 : y(top)),
            content: (
              <>
                <div className="ui-chart__tooltip-title">{xText(d)}</div>
                {visible.map((s, si) => (
                  <TooltipRow
                    key={s.key}
                    color={s.color}
                    label={s.label}
                    value={valueText(valueOf(d, s.key))}
                    isActive={visible.length > 1 && si === a.series}
                  />
                ))}
              </>
            ),
          };
        };

        const pick = (px: number, py: number) => {
          const gx = px - left;
          if (gx < -12 || gx > plotWidth + 12 || winCount <= 0) return null;
          let index = winFirst;
          for (let i = winFirst + 1; i <= winLast; i++) if (Math.abs(xs[i]! - gx) < Math.abs(xs[index]! - gx)) index = i;
          // 纵向离指针最近的系列
          const gy = py - MARGIN.top;
          let seriesIndex: number | undefined;
          let best = Infinity;
          tops.forEach((col, si) => {
            const v = col[index];
            if (v === null || v === undefined) return;
            const dist = Math.abs(y(v) - gy);
            if (dist < best) {
              best = dist;
              seriesIndex = si;
            }
          });
          return { index: index - winFirst, series: seriesIndex };
        };

        // 缩放：刷选的一段换算成横轴的值；平移按像素换算；键盘以当前点（没有时以中间）为中心
        const span = zoomRange ? zoomRange[1] - zoomRange[0] : full[1] - full[0];
        const current = zoomRange ?? full;
        const zoomProps = zoomable
          ? {
              onBrush: (from: number, to: number) => setZoom([xScaleOf.invert(from - left), xScaleOf.invert(to - left)]),
              onPan: (dx: number) => {
                const shift = (-dx / plotWidth) * span;
                if (zoomRange) setZoom([current[0] + shift, current[1] + shift]);
              },
              brushArea: { top: MARGIN.top, height: plotHeight, left, right: MARGIN.right },
              onExtraKey: (e: { key: string; shiftKey: boolean }, active: ChartActive | null) => {
                const center = active ? xNums[active.index + winFirst]! : (current[0] + current[1]) / 2;
                if (e.key === "+" || e.key === "=") setZoom([center - span / 4, center + span / 4]);
                else if (e.key === "-" || e.key === "_") setZoom(span * 2 >= full[1] - full[0] ? null : [center - span, center + span]);
                else if (e.key === "0") {
                  if (!zoomRange) return false;
                  setZoom(null);
                } else if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                  if (!zoomRange) return false;
                  const shift = (e.key === "ArrowRight" ? 1 : -1) * (span / 4);
                  setZoom([current[0] + shift, current[1] + shift]);
                } else return false;
                return true;
              },
            }
          : {};

        return (
          <ChartPlot
            label={label}
            width={width}
            height={height}
            count={Math.max(0, winCount)}
            seriesCount={visible.length}
            pick={pick}
            describe={describe}
            tooltip={tooltip}
            {...zoomProps}
          >
            {(localActive) => {
              const active = localActive ? toGlobal(localActive) : null;
              const focusKey = legendHover ?? (active?.source === "keyboard" && visible.length > 1 ? visible[active.series]?.key : null);
              return (
                <svg className="ui-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                  <g transform={`translate(${left},${MARGIN.top})`}>
                    {yAxis.ticks.map((t, i) => (
                      // 纵轴范围过渡时，暂时落在绘图区外面的刻度不画
                      <g key={t} transform={`translate(0,${y(t)})`} visibility={y(t) < -1 || y(t) > plotHeight + 1 ? "hidden" : undefined}>
                        {showGrid || t === 0 ? (
                          <line className="ui-chart__grid" data-zero={t === 0 || undefined} x2={plotWidth} />
                        ) : null}
                        <text className="ui-chart__tick" x={-8} dy="0.32em" textAnchor="end">
                          {yLabels[i]}
                        </text>
                      </g>
                    ))}
                    {shownXTicks.map((t) => {
                      const w = textWidth(t.label, FONT);
                      // 两端的标签不超出图表
                      const cx = Math.min(Math.max(t.pos, w / 2 - left), plotWidth + MARGIN.right - w / 2);
                      return (
                        <text key={`${t.pos}-${t.label}`} className="ui-chart__tick" x={cx} y={plotHeight + 20} textAnchor="middle">
                          {t.label}
                        </text>
                      );
                    })}

                    {zoomable ? (
                      <clipPath id={clipId}>
                        <rect x={-4} y={-4} width={plotWidth + 8} height={plotHeight + 8} />
                      </clipPath>
                    ) : null}
                    <g clipPath={zoomable ? `url(#${clipId})` : undefined}>
                    {visible.map((s, si) => {
                      const points = tops[si]!.map((v, i) => [i, v] as const);
                      const lineGen = line<(typeof points)[number]>()
                        .defined(([, v]) => v !== null)
                        .x(([i]) => xs[i]!)
                        .y(([, v]) => y(v!))
                        .curve(curveFactory);
                      const areaGen = area<(typeof points)[number]>()
                        .defined(([, v]) => v !== null)
                        .x(([i]) => xs[i]!)
                        .y0(([i]) => y(bottoms[si]![i]!))
                        .y1(([, v]) => y(v!))
                        .curve(curveFactory);
                      const isolated = points.filter(([i, v]) => v !== null && tops[si]![i - 1] == null && tops[si]![i + 1] == null);
                      return (
                        <g
                          key={s.key}
                          className="ui-chart__series"
                          style={{ color: s.color }}
                          data-dimmed={focusKey && focusKey !== s.key ? true : undefined}
                        >
                          {isArea ? <path className="ui-chart__area" data-stacked={isStacked || undefined} d={areaGen(points) ?? ""} /> : null}
                          <path className="ui-chart__line" d={lineGen(points) ?? ""} />
                          {(showDots ? points.filter(([, v]) => v !== null) : isolated).map(([i, v]) => (
                            <circle key={i} className="ui-chart__dot" cx={xs[i]} cy={y(v!)} r={3} />
                          ))}
                        </g>
                      );
                    })}
                    </g>

                    {active ? (
                      <g className="ui-chart__active">
                        <line className="ui-chart__crosshair" x1={xs[active.index]} x2={xs[active.index]} y2={plotHeight} />
                        {visible.map((s, si) => {
                          const v = tops[si]![active.index];
                          if (v === null || v === undefined) return null;
                          return (
                            <circle
                              key={s.key}
                              className="ui-chart__marker"
                              data-active={si === active.series || undefined}
                              style={{ color: s.color }}
                              cx={xs[active.index]}
                              cy={y(v)}
                              r={si === active.series ? 5 : 4}
                            />
                          );
                        })}
                      </g>
                    ) : null}
                  </g>
                </svg>
              );
            }}
          </ChartPlot>
        );
      }}
    </ChartFrame>
  );
}

export interface BarChartProps<T extends object> {
  /** 图表数据，每项对应一个类别，按数组顺序排列。 */
  data: readonly T[];
  /** 类别字段名，例如月份或渠道名称。 */
  x: Keys<T>;
  /** 需要绘制的系列列表，建议不超过 4 个。 */
  series: ChartSeries<Keys<T>>[];
  /** 可见标题；未传标题时请配合 `aria-label` 提供无障碍名称。 */
  heading?: string;
  /**
   * 标题语义层级，按页面大纲结构选择。
   * @default 3
   */
  headingLevel?: 2 | 3 | 4;
  /** 标题下方的补充说明，例如统计口径或单位。 */
  description?: ReactNode;
  /** 未提供可见标题时的无障碍名称。 */
  "aria-label"?: string;
  /**
   * 表格视图中类别列的表头名称。
   * @default "类别"（英文界面为“Category”）
   */
  xLabel?: string;
  /**
   * 排列方向：`vertical` 为竖向柱状图，`horizontal` 为适合长标签或多类别的横向条形图。
   * @default "vertical"
   */
  layout?: "vertical" | "horizontal";
  /** 是否开启堆叠；默认并排展示同一类别下的各个系列。 */
  stacked?: boolean;
  /** 数值格式化选项（`Intl.NumberFormat`），统一作用于坐标轴、提示框、表格与读屏播报。 */
  valueFormat?: Intl.NumberFormatOptions;
  /** 自定义类别名称格式化函数，默认将字段值转为字符串。 */
  formatX?: (value: T[Keys<T>]) => string;
  /** 手动指定数值轴范围；默认从 `0` 起按数据取整（柱体始终以 `0` 为基线）。 */
  valueDomain?: [number, number];
  /** 绘图区高度（像素）；未指定时竖向柱状图默认 `240`，横向条形图按类别数量自动计算（每行 `32px`）。 */
  height?: number;
  /** 是否显示图例；默认存在两个及以上系列时显示。 */
  showLegend?: boolean;
  /**
   * 是否绘制数值方向网格线。
   * @default true
   */
  showGrid?: boolean;
  /**
   * 是否显示“图表 / 表格”切换控件。
   * @default true
   */
  showTableToggle?: boolean;
  /** 默认隐藏的系列 key 列表（非受控）。 */
  defaultHiddenSeries?: string[];
  /** 当前隐藏的系列 key 列表（受控）。 */
  hiddenSeries?: string[];
  /** 在图例中切换系列显隐时触发，至少保留一个可见系列。 */
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** 是否处于加载状态；加载时会显示加载指示器并暂不绘图。 */
  isLoading?: boolean;
  /**
   * 数据为空时展示的占位内容。
   * @default "暂无数据"
   */
  emptyState?: ReactNode;
  /**
   * 服务端渲染时的初始绘图宽度（像素）。传入后在静态导出阶段即可直接出图，浏览器挂载后再按容器实际宽度重绘；容器宽度固定时设为一致数值即可避免跳动。
   */
  initialWidth?: number;
  /** 自定义根元素类名。 */
  className?: string;
}

/** 柱体数值端圆角（像素） */
const BAR_RADIUS = 4;
/** 并排柱体之间的间距（像素） */
const BAR_GAP = 2;
/** 单根柱体最大宽度（像素） */
const BAR_MAX = 48;
/** 横向条形图单个类别占用的行高（像素） */
const ROW_HEIGHT = 32;

/**
 * 柱状图与条形图组件，用于对比多个类别的数量或展示堆叠构成，支持键盘逐项浏览与表格视图切换。
 *
 * @promote aria-label
 */
export function BarChart<T extends object>({
  data,
  x,
  series,
  heading,
  headingLevel = 3,
  description,
  "aria-label": ariaLabel,
  xLabel: xLabelProp,
  layout = "vertical",
  stacked = false,
  valueFormat,
  formatX,
  valueDomain,
  height: heightProp,
  showLegend,
  showGrid = true,
  showTableToggle = true,
  defaultHiddenSeries,
  hiddenSeries,
  onHiddenSeriesChange,
  isLoading = false,
  emptyState,
  initialWidth,
  className,
}: BarChartProps<T>) {
  const t = useStrings(chartStrings);
  const xLabel = xLabelProp === undefined ? t.category : xLabelProp;
  const { resolved, visible, hidden, setHidden, legendHover, setLegendHover } = useSeriesState(series, {
    defaultHiddenSeries,
    hiddenSeries,
    onHiddenSeriesChange,
  });
  const horizontal = layout === "horizontal";
  const rows = [...data];
  const height = heightProp === undefined ? (horizontal ? Math.max(120, rows.length * ROW_HEIGHT + MARGIN.top + MARGIN.bottom) : 240) : heightProp;
  const valueFormatter = useNumberFormatter(valueFormat);
  const category = (d: T) => {
    const v = (d as Record<string, unknown>)[x];
    return formatX ? formatX(v as T[Keys<T>]) : String(v ?? "");
  };
  const valueOf = (d: T, key: string) => num((d as Record<string, unknown>)[key]);
  const valueText = (v: number | null) => (v === null ? t.noData : valueFormatter.format(v));

  // 每根柱子（或每一段）的起止数值。堆叠时正数往上叠、负数往下叠
  const segments = stacked
    ? stack<T>()
        .keys(visible.map((s) => s.key))
        .value((d, key) => valueOf(d, key) ?? 0)
        .offset(stackOffsetDiverging)(rows)
        .map((layer) => layer.map((p) => [p[0], p[1]] as [number, number]))
    : visible.map((s) => rows.map((d) => [0, valueOf(d, s.key) ?? 0] as [number, number]));
  const ends = segments.flat(2);
  const extent: [number, number] = [Math.min(0, ...ends), Math.max(0, ...ends, ends.length ? 0 : 1)];

  // 数值轴的长度：竖柱是高度，横条是宽度（宽度挂载后才知道，先按高度估刻度，画的时候再按宽度算）
  const plotHeight = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const valueAxis = useValueAxis(extent, horizontal ? 400 : plotHeight, valueFormat, valueDomain);
  const categoryLabels = rows.map(category);
  // 柱子的起止和数值轴范围一起过渡
  const barSignature = [layout, stacked, visible.map((s) => s.key).join(","), categoryLabels.join(",")].join("|");
  const barTween = useTween([valueAxis.domain[0], valueAxis.domain[1], ...segments.flat(2)], barSignature);
  const drawnValueDomain: [number, number] = [barTween[0]!, barTween[1]!];
  const drawnSegments = segments.map((seg, si) => seg.map((_, i) => [barTween[2 + (si * rows.length + i) * 2]!, barTween[3 + (si * rows.length + i) * 2]!] as [number, number]));

  const status = isLoading ? "loading" : rows.length === 0 ? "empty" : null;
  const name = heading ?? ariaLabel ?? t.chart;
  const kind = horizontal ? (stacked ? t.stackedHbar : t.hbar) : stacked ? t.stackedBar : t.bar;

  const table = {
    xLabel,
    rows: rows.map((d, i) => ({ key: String(i), x: categoryLabels[i]!, values: visible.map((s) => valueText(valueOf(d, s.key))) })),
  };

  return (
    <ChartFrame
      heading={heading}
      headingLevel={headingLevel}
      description={description}
      aria-label={ariaLabel}
      series={resolved}
      hidden={hidden}
      onHiddenChange={setHidden}
      showLegend={showLegend ?? series.length > 1}
      showTableToggle={showTableToggle}
      onLegendHover={setLegendHover}
      table={table}
      status={status}
      emptyState={emptyState}
      height={height}
      initialWidth={initialWidth}
      className={className}
      dataAttributes={{ "data-layout": layout, "data-stacked": stacked || undefined }}
    >
      {(width) => {
        // 横条：类别名在左边，最多占四成宽度，再长就截断
        const maxCategoryWidth = Math.min(160, width * 0.4);
        const shownCategories = horizontal ? categoryLabels.map((l) => truncateLabel(l, maxCategoryWidth, FONT)) : categoryLabels;
        const left = horizontal
          ? Math.ceil(Math.max(0, ...shownCategories.map((l) => textWidth(l, FONT)))) + 12
          : valueAxis.labelWidth + 12;
        const plotWidth = Math.max(40, width - left - MARGIN.right);
        const bandLength = horizontal ? plotHeight : plotWidth;
        const valueLength = horizontal ? plotWidth : plotHeight;

        const band = scaleBand<number>()
          .domain(rows.map((_, i) => i))
          .range([0, bandLength])
          .paddingInner(0.24)
          .paddingOuter(0.12);
        const value = scaleLinear()
          .domain(drawnValueDomain)
          .range(horizontal ? [0, valueLength] : [valueLength, 0]);
        // 横条的数值刻度按实际宽度重新取（useValueAxis 是按估计的长度算的）
        const valueTicks = horizontal ? value.ticks(tickTarget(valueLength)) : valueAxis.ticks;
        const valueTickLabel = (t: number, i: number) => (horizontal ? valueFormatter.format(t) : valueAxis.labels[i]!);

        // 每根柱子在类别里的位置：并排时平分（中间留 2px），堆叠时占满
        const groupSize = stacked ? 1 : Math.max(1, visible.length);
        const barThickness = Math.min(BAR_MAX, (band.bandwidth() - BAR_GAP * (groupSize - 1)) / groupSize);
        const groupThickness = barThickness * groupSize + BAR_GAP * (groupSize - 1);
        const slot = (i: number, si: number) => band(i)! + (band.bandwidth() - groupThickness) / 2 + (stacked ? 0 : si * (barThickness + BAR_GAP));

        // 堆叠时只有最外面的一段是圆角：后面的系列叠在外侧，所以是最后一个正数段和最后一个负数段
        const outer = rows.map((_, i) => {
          let pos = -1;
          let neg = -1;
          drawnSegments.forEach((seg, si) => {
            const [a, b] = seg[i]!;
            if (b > a) pos = si;
            if (b < a) neg = si;
          });
          return { pos, neg };
        });

        const bars = visible.map((_, si) =>
          rows.map((_, i) => {
            const [a, b] = drawnSegments[si]![i]!;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const isNegative = b < a;
            const rounded = !stacked || (isNegative ? outer[i]!.neg === si : outer[i]!.pos === si);
            const end: "top" | "bottom" | "left" | "right" | null = !rounded ? null : horizontal ? (isNegative ? "left" : "right") : isNegative ? "bottom" : "top";
            const pos = slot(i, si);
            if (horizontal) {
              const x0 = value(lo);
              return { x: x0, y: pos, w: value(hi) - x0, h: barThickness, end, tip: [value(isNegative ? lo : hi), pos + barThickness / 2] as const };
            }
            const y0 = value(hi);
            return { x: pos, y: y0, w: barThickness, h: value(lo) - y0, end, tip: [pos + barThickness / 2, value(isNegative ? lo : hi)] as const };
          }),
        );

        const label = [
          name,
          kind,
          t.barCount({ series: visible.length, categories: rows.length }),
          horizontal ? (visible.length > 1 ? t.vKeysMulti : t.vKeys) : visible.length > 1 ? t.hKeysMulti : t.hKeys,
        ].join(t.sep);

        const describe = (a: ChartActive) => {
          const s = visible[a.series]!;
          return `${categoryLabels[a.index]}，${s.label}：${valueText(valueOf(rows[a.index]!, s.key))}`;
        };

        const tooltip = (a: ChartActive) => {
          const [tx, ty] = bars[a.series]![a.index]!.tip;
          return {
            x: left + tx,
            y: MARGIN.top + ty,
            content: (
              <>
                <div className="ui-chart__tooltip-title">{categoryLabels[a.index]}</div>
                {visible.map((s, si) => (
                  <TooltipRow
                    key={s.key}
                    color={s.color}
                    label={s.label}
                    value={valueText(valueOf(rows[a.index]!, s.key))}
                    isActive={visible.length > 1 && si === a.series}
                  />
                ))}
              </>
            ),
          };
        };

        const pick = (px: number, py: number) => {
          const along = horizontal ? py - MARGIN.top : px - left;
          const across = horizontal ? px - left : py - MARGIN.top;
          if (along < 0 || along > bandLength || across < -12 || across > valueLength + 12 || rows.length === 0) return null;
          const index = Math.min(rows.length - 1, Math.max(0, Math.floor((along - band.step() * band.paddingOuter()) / band.step())));
          let seriesIndex: number | undefined;
          if (stacked) {
            // 指针所在的那一段
            const v = value.invert(across);
            seriesIndex = segments.findIndex((seg) => {
              const [a, b] = seg[index]!;
              return v >= Math.min(a, b) && v <= Math.max(a, b) && a !== b;
            });
            if (seriesIndex < 0) seriesIndex = undefined;
          } else {
            // 指针所在的那根柱子
            const offset = along - slot(index, 0);
            seriesIndex = Math.min(visible.length - 1, Math.max(0, Math.floor(offset / (barThickness + BAR_GAP))));
          }
          return { index, series: seriesIndex };
        };

        const shownCategoryIndexes = horizontal
          ? rows.map((_, i) => i)
          : (() => {
              const stride = labelStride(
                rows.map((_, i) => band(i)! + band.bandwidth() / 2),
                categoryLabels.map((l) => textWidth(l, FONT)),
              );
              return rows.map((_, i) => i).filter((i) => i % stride === 0);
            })();

        return (
          <ChartPlot
            label={label}
            width={width}
            height={height}
            count={rows.length}
            seriesCount={visible.length}
            orientation={horizontal ? "vertical" : "horizontal"}
            pick={pick}
            describe={describe}
            tooltip={tooltip}
          >
            {(active) => {
              const focusKey = legendHover ?? (active?.source === "keyboard" && visible.length > 1 ? visible[active.series]?.key : null);
              return (
                <svg className="ui-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                  <g transform={`translate(${left},${MARGIN.top})`}>
                    {active ? (
                      <rect
                        className="ui-chart__band"
                        x={horizontal ? 0 : band(active.index)! - (band.step() - band.bandwidth()) / 2}
                        y={horizontal ? band(active.index)! - (band.step() - band.bandwidth()) / 2 : 0}
                        width={horizontal ? plotWidth : band.step()}
                        height={horizontal ? band.step() : plotHeight}
                        rx={BAR_RADIUS}
                      />
                    ) : null}
                    {valueTicks.map((t, i) => {
                      const p = value(t);
                      return (
                        // 数值轴范围过渡时，暂时落在绘图区外面的刻度不画
                        <g key={t} transform={horizontal ? `translate(${p},0)` : `translate(0,${p})`} visibility={p < -1 || p > valueLength + 1 ? "hidden" : undefined}>
                          {showGrid || t === 0 ? (
                            <line
                              className="ui-chart__grid"
                              data-zero={t === 0 || undefined}
                              x2={horizontal ? 0 : plotWidth}
                              y2={horizontal ? plotHeight : 0}
                            />
                          ) : null}
                          {horizontal ? (
                            <text className="ui-chart__tick" y={plotHeight + 20} textAnchor="middle">
                              {valueTickLabel(t, i)}
                            </text>
                          ) : (
                            <text className="ui-chart__tick" x={-8} dy="0.32em" textAnchor="end">
                              {valueTickLabel(t, i)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {shownCategoryIndexes.map((i) =>
                      horizontal ? (
                        <text key={i} className="ui-chart__tick" x={-8} y={band(i)! + band.bandwidth() / 2} dy="0.32em" textAnchor="end">
                          {shownCategories[i]}
                        </text>
                      ) : (
                        <text key={i} className="ui-chart__tick" x={band(i)! + band.bandwidth() / 2} y={plotHeight + 20} textAnchor="middle">
                          {shownCategories[i]}
                        </text>
                      ),
                    )}
                    {visible.map((s, si) => (
                      <g
                        key={s.key}
                        className="ui-chart__series"
                        style={{ color: s.color }}
                        data-dimmed={focusKey && focusKey !== s.key ? true : undefined}
                      >
                        {bars[si]!.map((b, i) => (
                          <path
                            key={i}
                            className="ui-chart__bar"
                            data-active={active && active.index === i && active.series === si ? true : undefined}
                            d={barPath(b.x, b.y, b.w, b.h, BAR_RADIUS, b.end)}
                          />
                        ))}
                      </g>
                    ))}
                  </g>
                </svg>
              );
            }}
          </ChartPlot>
        );
      }}
    </ChartFrame>
  );
}

export interface DonutChartProps<T extends object> {
  /** 图表数据，每项对应一个扇区，负数按 `0` 处理；超过 4 项时保留最大的 3 项，其余合并为“其他”。 */
  data: readonly T[];
  /** 扇区名称字段名。 */
  label: Keys<T>;
  /** 扇区数值字段名。 */
  value: Keys<T>;
  /** 可见标题；未传标题时请配合 `aria-label` 提供无障碍名称。 */
  heading?: string;
  /**
   * 标题语义层级，按页面大纲结构选择。
   * @default 3
   */
  headingLevel?: 2 | 3 | 4;
  /** 标题下方的补充说明，例如统计口径或单位。 */
  description?: ReactNode;
  /** 未提供可见标题时的无障碍名称。 */
  "aria-label"?: string;
  /**
   * 表格视图中名称列的表头名称。
   * @default "类别"（英文界面为“Category”）
   */
  labelColumn?: string;
  /** 数值格式化选项（`Intl.NumberFormat`），统一作用于中心总计、提示框、表格与读屏播报。 */
  valueFormat?: Intl.NumberFormatOptions;
  /**
   * 中心总计数字上方的提示文字；传入 `null` 可隐藏中心总计。
   * @default "总计"（英文界面为“Total”）
   */
  totalLabel?: string | null;
  /**
   * 绘图区高度（像素），环形外径随高度自适应。
   * @default 220
   */
  height?: number;
  /**
   * 是否显示图例。
   * @default true
   */
  showLegend?: boolean;
  /**
   * 是否显示“图表 / 表格”切换控件。
   * @default true
   */
  showTableToggle?: boolean;
  /** 默认隐藏的扇区名称列表（非受控）。 */
  defaultHiddenSeries?: string[];
  /** 当前隐藏的扇区名称列表（受控）。 */
  hiddenSeries?: string[];
  /** 在图例中切换扇区显隐时触发，至少保留一个可见扇区。 */
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** 是否处于加载状态；加载时会显示加载指示器并暂不绘图。 */
  isLoading?: boolean;
  /**
   * 数据为空或总计为 `0` 时展示的占位内容。
   * @default "暂无数据"
   */
  emptyState?: ReactNode;
  /**
   * 服务端渲染时的初始绘图宽度（像素）。传入后在静态导出阶段即可直接出图，浏览器挂载后再按容器实际宽度重绘；容器宽度固定时设为一致数值即可避免跳动。
   */
  initialWidth?: number;
  /** 自定义根元素类名。 */
  className?: string;
}

/** 环体内径与外径比例 */
const DONUT_INNER = 0.64;
/** 扇区之间的间隙（像素） */
const SLICE_GAP = 2;
/** 选中扇区向外突出的像素距离 */
const SLICE_GROW = 4;
/** 最多保留的扇区数，超出后合并为“其他” */
const MAX_SLICES = 4;

/**
 * 环形图组件，用于展示各部分占整体的比例关系，支持中心总计、图例过滤与扇区逐块键盘浏览。
 *
 * @promote aria-label
 */
export function DonutChart<T extends object>({
  data,
  label,
  value,
  heading,
  headingLevel = 3,
  description,
  "aria-label": ariaLabel,
  labelColumn: labelColumnProp,
  valueFormat,
  totalLabel: totalLabelProp,
  height = 220,
  showLegend = true,
  showTableToggle = true,
  defaultHiddenSeries,
  hiddenSeries,
  onHiddenSeriesChange,
  isLoading = false,
  emptyState,
  initialWidth,
  className,
}: DonutChartProps<T>) {
  const t = useStrings(chartStrings);
  const labelColumn = labelColumnProp === undefined ? t.category : labelColumnProp;
  const totalLabel = totalLabelProp === undefined ? t.total : totalLabelProp;
  const valueFormatter = useNumberFormatter(valueFormat);
  const percent = useNumberFormatter({ style: "percent", maximumFractionDigits: 1 });

  // 超过 4 块时保留最大的 3 块（按原数据顺序），其余合并为“其他”
  const all = data.map((d) => ({
    name: String((d as Record<string, unknown>)[label] ?? ""),
    value: Math.max(0, num((d as Record<string, unknown>)[value]) ?? 0),
  }));
  let slices = all;
  if (all.length > MAX_SLICES) {
    const keep = new Set(
      [...all]
        .sort((a, b) => b.value - a.value)
        .slice(0, MAX_SLICES - 1)
        .map((s) => s.name),
    );
    slices = [...all.filter((s) => keep.has(s.name)), { name: t.other, value: all.filter((s) => !keep.has(s.name)).reduce((t, s) => t + s.value, 0) }];
  }

  const { resolved, hidden, setHidden, legendHover, setLegendHover } = useSeriesState(
    slices.map((s) => ({ key: s.name, label: s.name })),
    { defaultHiddenSeries, hiddenSeries, onHiddenSeriesChange },
  );
  // “其他”使用中性灰，不占用系列色
  const colored = resolved.map((s, i) => (all.length > MAX_SLICES && i === slices.length - 1 ? { ...s, color: "var(--text-muted)" } : s));
  const colorOf = new Map(colored.map((s) => [s.key, s.color]));
  const shown = slices.filter((s) => !hidden.has(s.name));
  const total = shown.reduce((t, s) => t + s.value, 0);
  const share = (v: number) => (total ? v / total : 0);
  const text = (s: { name: string; value: number }) => t.slice({ name: s.name, value: valueFormatter.format(s.value), share: percent.format(share(s.value)) });

  // 每块的大小过渡（块的组成变了就直接换）
  const donutTween = useTween(
    shown.map((s) => s.value),
    shown.map((s) => s.name).join("\n"),
  );
  const drawn = shown.map((s, i) => ({ ...s, value: donutTween[i] ?? s.value }));
  const status = isLoading ? "loading" : all.length === 0 || all.every((s) => s.value === 0) ? "empty" : null;
  const name = heading ?? ariaLabel ?? t.chart;

  const table = {
    xLabel: labelColumn,
    columns: [t.value, t.share],
    rows: shown.map((s) => ({ key: s.name, x: s.name, values: [valueFormatter.format(s.value), percent.format(share(s.value))] })),
  };

  return (
    <ChartFrame
      heading={heading}
      headingLevel={headingLevel}
      description={description}
      aria-label={ariaLabel}
      series={colored}
      hidden={hidden}
      onHiddenChange={setHidden}
      showLegend={showLegend}
      showTableToggle={showTableToggle}
      onLegendHover={setLegendHover}
      table={table}
      status={status}
      emptyState={emptyState}
      height={height}
      initialWidth={initialWidth}
      className={className}
      dataAttributes={{ "data-type": "donut" }}
    >
      {(width) => {
        const outerRadius = Math.max(20, Math.min(width, height) / 2 - SLICE_GROW - 2);
        const innerRadius = outerRadius * DONUT_INNER;
        const cx = width / 2;
        const cy = height / 2;
        const arcs = pie<{ name: string; value: number }>()
          .sort(null)
          .value((s) => s.value)
          .padAngle(shown.length > 1 ? SLICE_GAP / outerRadius : 0)(drawn);
        const arcGen = arc<PieArcDatum<{ name: string; value: number }>>().innerRadius(innerRadius).cornerRadius(BAR_RADIUS);

        const label = [name, t.donut, t.slices({ count: shown.length }), totalLabel === null ? null : `${totalLabel} ${valueFormatter.format(total)}`, t.donutKeys]
          .filter(Boolean)
          .join(t.sep);

        const pick = (px: number, py: number) => {
          const dx = px - cx;
          const dy = py - cy;
          const r = Math.hypot(dx, dy);
          if (r < innerRadius - 4 || r > outerRadius + SLICE_GROW + 4) return null;
          // d3 的角度从 12 点方向顺时针
          let angle = Math.atan2(dx, -dy);
          if (angle < 0) angle += 2 * Math.PI;
          const index = arcs.findIndex((a) => angle >= a.startAngle && angle <= a.endAngle);
          return index < 0 ? null : { index };
        };

        return (
          <ChartPlot
            label={label}
            width={width}
            height={height}
            count={arcs.length}
            seriesCount={1}
            pick={pick}
            describe={(a) => text(shown[a.index]!)}
            tooltip={(a) => {
              const d = arcs[a.index]!;
              const [tx, ty] = arcGen.outerRadius(outerRadius).centroid(d);
              const s = shown[a.index]!;
              return {
                x: cx + tx,
                y: cy + ty,
                content: (
                  <>
                    <div className="ui-chart__tooltip-title">{s.name}</div>
                    <TooltipRow color={colorOf.get(s.name)!} label={valueFormatter.format(s.value)} value={percent.format(share(s.value))} />
                  </>
                ),
              };
            }}
          >
            {(active) => {
              const focus = active ? shown[active.index]!.name : legendHover;
              return (
                <svg className="ui-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                  <g transform={`translate(${cx},${cy})`}>
                    {arcs.map((d) => (
                      <path
                        key={d.data.name}
                        className="ui-chart__slice"
                        style={{ color: colorOf.get(d.data.name) }}
                        data-dimmed={focus && focus !== d.data.name ? true : undefined}
                        d={arcGen.outerRadius(focus === d.data.name ? outerRadius + SLICE_GROW : outerRadius)(d) ?? ""}
                      />
                    ))}
                    {totalLabel === null ? null : (
                      <>
                        <text className="ui-chart__total-label" y={-12} textAnchor="middle">
                          {totalLabel}
                        </text>
                        <text className="ui-chart__total" y={14} textAnchor="middle">
                          {valueFormatter.format(total)}
                        </text>
                      </>
                    )}
                  </g>
                </svg>
              );
            }}
          </ChartPlot>
        );
      }}
    </ChartFrame>
  );
}

export interface ScatterChartProps<T extends object> {
  /** 图表数据，每项为一个散点；横纵轴值均需为数字，缺失时传入 `null`（不绘制该点，表格中显示“无数据”）。 */
  data: readonly T[];
  /** 横轴数值字段名。 */
  x: Keys<T>;
  /** 纵轴数值字段名。 */
  y: Keys<T>;
  /** 横轴名称，例如“响应时间（毫秒）”，显示在横轴下方并用于提示框、表格和读屏。 */
  xLabel: string;
  /** 纵轴名称，例如“错误率”，显示在纵轴上方。 */
  yLabel: string;
  /** 分组字段名；相同分组的点使用同一种颜色并可在图例中切换显隐，建议不超过 4 组，默认仅单组。 */
  group?: Keys<T>;
  /** 获取每个散点名称的函数（例如接口路径），用于提示框标题、表格首列和读屏；默认按序号命名为“第 N 个点”。 */
  pointLabel?: (d: T) => string;
  /** 可见标题；未传标题时请配合 `aria-label` 提供无障碍名称。 */
  heading?: string;
  /**
   * 标题语义层级，按页面大纲结构选择。
   * @default 3
   */
  headingLevel?: 2 | 3 | 4;
  /** 标题下方的补充说明，例如统计口径。 */
  description?: ReactNode;
  /** 未提供可见标题时的无障碍名称。 */
  "aria-label"?: string;
  /** 横轴数值格式化选项（`Intl.NumberFormat`）。 */
  xFormat?: Intl.NumberFormatOptions;
  /** 纵轴数值格式化选项（`Intl.NumberFormat`）。 */
  valueFormat?: Intl.NumberFormatOptions;
  /** 手动指定横轴范围 `[最小值, 最大值]`；默认按数据取整。 */
  xDomain?: [number, number];
  /** 手动指定纵轴范围 `[最小值, 最大值]`；默认按数据取整。 */
  yDomain?: [number, number];
  /**
   * 坐标轴是否强制包含 `0`；散点图关注分布与相关性，默认从数据区间起止取范围。
   * @default false
   */
  includeZero?: boolean;
  /**
   * 绘图区高度（像素），不含标题与图例。
   * @default 280
   */
  height?: number;
  /** 是否显示图例；默认存在两组及以上时显示。 */
  showLegend?: boolean;
  /**
   * 是否同时绘制横向与纵向网格线。
   * @default true
   */
  showGrid?: boolean;
  /**
   * 是否显示“图表 / 表格”切换控件。
   * @default true
   */
  showTableToggle?: boolean;
  /** 默认隐藏的分组名称列表（非受控）。 */
  defaultHiddenSeries?: string[];
  /** 当前隐藏的分组名称列表（受控）。 */
  hiddenSeries?: string[];
  /** 在图例中切换分组显隐时触发，至少保留一个可见分组。 */
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** 是否处于加载状态；加载时会显示加载指示器并暂不绘图。 */
  isLoading?: boolean;
  /**
   * 数据为空时展示的占位内容。
   * @default "暂无数据"
   */
  emptyState?: ReactNode;
  /**
   * 服务端渲染时的初始绘图宽度（像素）。传入后在静态导出阶段即可直接出图，浏览器挂载后再按容器实际宽度重绘；容器宽度固定时设为一致数值即可避免跳动。
   */
  initialWidth?: number;
  /** 自定义根元素类名。 */
  className?: string;
}

const SCATTER_MARGIN = { top: 24, right: 12, bottom: 44 };
/** 指针命中数据点的最大距离（像素） */
const SCATTER_HIT = 24;

/**
 * 散点图组件，用于观察两个数值变量之间的分布与关联关系，支持按分组着色、图例过滤与键盘逐点浏览。
 *
 * @promote aria-label
 */
export function ScatterChart<T extends object>({
  data,
  x,
  y: yKey,
  xLabel,
  yLabel,
  group,
  pointLabel,
  heading,
  headingLevel = 3,
  description,
  "aria-label": ariaLabel,
  xFormat,
  valueFormat,
  xDomain,
  yDomain,
  includeZero = false,
  height = 280,
  showLegend,
  showGrid = true,
  showTableToggle = true,
  defaultHiddenSeries,
  hiddenSeries,
  onHiddenSeriesChange,
  isLoading = false,
  emptyState,
  initialWidth,
  className,
}: ScatterChartProps<T>) {
  const t = useStrings(chartStrings);
  const field = (d: T, key: string) => (d as Record<string, unknown>)[key];
  // 分组：按第一次出现的顺序取颜色
  const groups = group ? [...new Set(data.map((d) => String(field(d, group) ?? "")))] : [""];
  const series = groups.map((g) => ({ key: g, label: g || yLabel }));
  const { resolved, visible, hidden, setHidden, legendHover, setLegendHover } = useSeriesState(series, {
    defaultHiddenSeries,
    hiddenSeries,
    onHiddenSeriesChange,
  });
  const groupOf = (d: T) => (group ? String(field(d, group) ?? "") : "");
  const name = (d: T, i: number) => (pointLabel ? pointLabel(d) : t.point({ index: i + 1 }));

  // 可见的点，按横轴从小到大（键盘左右浏览的顺序）
  const all = data.map((d, i) => ({ d, i, xv: num(field(d, x)), yv: num(field(d, yKey)), g: groupOf(d) }));
  const visibleKeys = new Set(visible.map((s) => s.key));
  const points = all
    .filter((p): p is typeof p & { xv: number; yv: number } => p.xv !== null && p.yv !== null && visibleKeys.has(p.g))
    .sort((a, b) => a.xv - b.xv);

  const xFormatter = useNumberFormatter(xFormat);
  const yFormatter = useNumberFormatter(valueFormat);
  const xText = (v: number | null) => (v === null ? t.noData : xFormatter.format(v));
  const yText = (v: number | null) => (v === null ? t.noData : yFormatter.format(v));

  const extent = (vs: number[]): [number, number] => {
    let lo = vs.length ? Math.min(...vs) : 0;
    let hi = vs.length ? Math.max(...vs) : 1;
    if (includeZero) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    return [lo, hi];
  };
  const plotHeight = Math.max(40, height - SCATTER_MARGIN.top - SCATTER_MARGIN.bottom);
  const yAxis = useValueAxis(extent(points.map((p) => p.yv)), plotHeight, valueFormat, yDomain);
  const xExtent = extent(points.map((p) => p.xv));
  const left = yAxis.labelWidth + 12;
  // 点的位置和纵轴范围一起过渡（点的组成变了就直接换）。横轴范围要按宽度取整齐的刻度，直接换
  const scatterTween = useTween(
    [...yAxis.domain, ...points.flatMap((p) => [p.xv, p.yv])],
    points.map((p) => p.i).join(","),
  );
  const drawnYDomain: [number, number] = [scatterTween[0]!, scatterTween[1]!];
  const drawnPoints = points.map((p, k) => ({ ...p, xv: scatterTween[2 + k * 2]!, yv: scatterTween[3 + k * 2]! }));

  const status = isLoading ? "loading" : all.every((p) => p.xv === null || p.yv === null) ? "empty" : null;
  const chartName = heading ?? ariaLabel ?? t.chart;

  const table = {
    xLabel: pointLabel ? t.name : "#",
    columns: [xLabel, yLabel, ...(group ? [t.group] : [])],
    rows: all
      .filter((p) => visibleKeys.has(p.g))
      .map((p) => ({ key: String(p.i), x: name(p.d, p.i), values: [xText(p.xv), yText(p.yv), ...(group ? [p.g] : [])] })),
  };

  return (
    <ChartFrame
      heading={heading}
      headingLevel={headingLevel}
      description={description}
      aria-label={ariaLabel}
      series={resolved}
      hidden={hidden}
      onHiddenChange={setHidden}
      showLegend={showLegend ?? groups.length > 1}
      showTableToggle={showTableToggle}
      onLegendHover={setLegendHover}
      table={table}
      status={status}
      emptyState={emptyState}
      height={height}
      initialWidth={initialWidth}
      className={className}
      dataAttributes={{ "data-variant": "scatter" }}
    >
      {(width) => {
        const plotWidth = Math.max(40, width - left - SCATTER_MARGIN.right);
        const yScale = scaleLinear().domain(drawnYDomain).range([plotHeight, 0]);
        const xScale = scaleLinear()
          .domain(xDomain ?? xExtent)
          .range([0, plotWidth]);
        if (!xDomain) xScale.nice(tickTarget(plotWidth, 8));
        const xTicks = xScale.ticks(tickTarget(plotWidth, 8)).map((v) => ({ pos: xScale(v), label: xFormatter.format(v) }));
        const stride = labelStride(
          xTicks.map((tk) => tk.pos),
          xTicks.map((tk) => textWidth(tk.label, FONT)),
        );
        const colorOf = (g: string) => visible.find((s) => s.key === g)?.color ?? "currentcolor";

        const label = [chartName, t.scatter, t.scatterCount({ points: points.length, groups: visible.length }), t.scatterKeys].join(t.sep);
        const describe = (a: ChartActive) => {
          const p = points[a.index]!;
          return [name(p.d, p.i), group ? p.g : null, `${xLabel}：${xText(p.xv)}`, `${yLabel}：${yText(p.yv)}`].filter(Boolean).join(t.sep);
        };
        const tooltip = (a: ChartActive) => {
          const p = points[a.index]!;
          const at = drawnPoints[a.index]!;
          return {
            x: left + xScale(at.xv),
            y: SCATTER_MARGIN.top + yScale(at.yv),
            content: (
              <>
                <div className="ui-chart__tooltip-title">{name(p.d, p.i)}</div>
                {group ? <TooltipRow color={colorOf(p.g)} label={t.group} value={p.g} /> : null}
                <TooltipRow label={xLabel} value={xText(p.xv)} />
                <TooltipRow label={yLabel} value={yText(p.yv)} />
              </>
            ),
          };
        };
        // 最近的点（在 SCATTER_HIT 以内）
        const pick = (px: number, py: number) => {
          const gx = px - left;
          const gy = py - SCATTER_MARGIN.top;
          let best = -1;
          let dist = SCATTER_HIT * SCATTER_HIT;
          drawnPoints.forEach((p, i) => {
            const dx = xScale(p.xv) - gx;
            const dy = yScale(p.yv) - gy;
            const d2 = dx * dx + dy * dy;
            if (d2 < dist) {
              dist = d2;
              best = i;
            }
          });
          return best < 0 ? null : { index: best, series: 0 };
        };

        return (
          <ChartPlot label={label} width={width} height={height} count={points.length} seriesCount={1} pick={pick} describe={describe} tooltip={tooltip}>
            {(active) => (
              <svg className="ui-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                <g transform={`translate(${left},${SCATTER_MARGIN.top})`}>
                  {yAxis.ticks.map((tk, i) => (
                    <g key={tk} transform={`translate(0,${yScale(tk)})`} visibility={yScale(tk) < -1 || yScale(tk) > plotHeight + 1 ? "hidden" : undefined}>
                      {showGrid || tk === 0 ? <line className="ui-chart__grid" data-zero={tk === 0 || undefined} x2={plotWidth} /> : null}
                      <text className="ui-chart__tick" x={-8} dy="0.32em" textAnchor="end">
                        {yAxis.labels[i]}
                      </text>
                    </g>
                  ))}
                  {xTicks.map((tk, i) => {
                    const w = textWidth(tk.label, FONT);
                    const cx = Math.min(Math.max(tk.pos, w / 2 - left), plotWidth + SCATTER_MARGIN.right - w / 2);
                    return (
                      <g key={`${tk.pos}-${tk.label}`}>
                        {showGrid ? <line className="ui-chart__grid" x1={tk.pos} x2={tk.pos} y2={plotHeight} /> : null}
                        {i % stride === 0 ? (
                          <text className="ui-chart__tick" x={cx} y={plotHeight + 20} textAnchor="middle">
                            {tk.label}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                  {/* 轴名：纵轴的写在左上角，横轴的写在右下角 */}
                  <text className="ui-chart__axis-title" x={-left} y={-12}>
                    {yLabel}
                  </text>
                  <text className="ui-chart__axis-title" x={plotWidth} y={plotHeight + 38} textAnchor="end">
                    {xLabel}
                  </text>
                  {visible.map((s) => (
                    <g key={s.key} className="ui-chart__series" style={{ color: s.color }} data-dimmed={legendHover && legendHover !== s.key ? true : undefined}>
                      {drawnPoints
                        .filter((p) => p.g === s.key)
                        .map((p) => (
                          <circle key={p.i} className="ui-chart__point" cx={xScale(p.xv)} cy={yScale(p.yv)} r={4} />
                        ))}
                    </g>
                  ))}
                  {active && drawnPoints[active.index] ? (
                    <g className="ui-chart__active">
                      <circle
                        className="ui-chart__marker"
                        data-active=""
                        style={{ color: colorOf(drawnPoints[active.index]!.g) }}
                        cx={xScale(drawnPoints[active.index]!.xv)}
                        cy={yScale(drawnPoints[active.index]!.yv)}
                        r={6}
                      />
                    </g>
                  ) : null}
                </g>
              </svg>
            )}
          </ChartPlot>
        );
      }}
    </ChartFrame>
  );
}
