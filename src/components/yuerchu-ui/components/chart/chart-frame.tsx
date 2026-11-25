"use client";

/*
 * 各种图表共用的外框和交互：标题、图例（显示 / 隐藏系列）、图表和表格两种视图、加载中和空状态，
 * 以及绘图区的键盘浏览、悬停、提示框和读屏播报。具体的图（折线、柱状…）只负责算坐标和画 SVG。
 */
import type { PointerEvent, ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvents } from "react-aria";
import { mergeProps, useFocusRing, useKeyboard, useNumberFormatter, usePress } from "react-aria";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { animate } from "motion/react";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { useMotionTokens } from "../../lib/motion";
import { Segment, SegmentedControl } from "../segmented-control/segmented-control";
import { useLoadingPhase } from "../reveal/reveal";
import { Spinner } from "../spinner/spinner";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../table/table";
import { linearTicks, textWidth } from "./chart-scale";
import { chartFrameStrings } from "./chart-frame.strings";

/** 一个系列在图里的样子：颜色按出现顺序取 --series-1…4，隐藏后也不变 */
export interface ResolvedSeries {
  key: string;
  label: string;
  color: string;
}

/** 系列颜色按顺序分配且不循环；超过 4 个系列时其余部分使用中性灰，建议合并为“其他”或拆分图表 */
export function seriesColor(index: number): string {
  return index < 4 ? `var(--series-${index + 1})` : "var(--text-muted)";
}

/** 系列的显示 / 隐藏（受控或非受控）、颜色，以及悬停在图例上的系列 */
export function useSeriesState(
  series: { key: string; label: string }[],
  options: { defaultHiddenSeries?: string[]; hiddenSeries?: string[]; onHiddenSeriesChange?: (hidden: string[]) => void },
) {
  const [uncontrolled, setUncontrolled] = useState<string[]>(options.defaultHiddenSeries ?? []);
  const hidden = new Set(options.hiddenSeries ?? uncontrolled);
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const resolved: ResolvedSeries[] = series.map((s, i) => ({ key: s.key, label: s.label, color: seriesColor(i) }));
  return {
    resolved,
    visible: resolved.filter((s) => !hidden.has(s.key)),
    hidden,
    setHidden: (next: Set<string>) => {
      const list = [...next];
      setUncontrolled(list);
      options.onHiddenSeriesChange?.(list);
    },
    legendHover,
    setLegendHover,
  };
}

/** 刻度文字的字号（--text-caption） */
export const TICK_FONT = 12;

/**
 * 数值轴：整齐的范围和刻度、刻度文字（一万以上用紧凑写法，小数位跟着步长）、最宽的刻度文字有多宽。
 * valueFormat 和数值本身的格式一致（货币、百分比）。
 */
export function useValueAxis(extent: [number, number], px: number, valueFormat: Intl.NumberFormatOptions | undefined, fixed?: [number, number]) {
  const ticks = linearTicks(fixed ?? extent, px);
  const domain = fixed ?? ticks.domain;
  const formatter = useNumberFormatter(
    Math.max(Math.abs(domain[0]), Math.abs(domain[1])) >= 10_000
      ? { ...valueFormat, notation: "compact", maximumFractionDigits: 1 }
      : {
          ...valueFormat,
          minimumFractionDigits: 0,
          maximumFractionDigits: valueFormat?.style === "percent" ? Math.max(0, ticks.digits - 2) : ticks.digits,
        },
  );
  const labels = ticks.ticks.map((t) => formatter.format(t));
  return { domain, ticks: ticks.ticks, labels, labelWidth: Math.ceil(Math.max(0, ...labels.map((l) => textWidth(l, TICK_FONT)))) };
}

/**
 * 宽度跟着容器走。挂载前是 initial（没给时是 null：服务端不画图，只占住高度。服务端不知道宽度，也不知道浏览器的时区，
 * 画出来的刻度可能和浏览器不一致）。给了 initial 时服务端按它出图，挂载后量到实际宽度再重画。测试环境没有布局，按 fallback 画。
 */
export function useElementWidth(fallback = 640, initial: number | null = null) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry!.contentRect.width);
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/**
 * 数据变化时的过渡：结构（signature：哪些点、哪些系列）不变时，画出来的值从上次的位置用弹簧过渡到新值；
 * 结构变了（点或系列变了）直接换成新值。减弱动效时直接到位。NaN 表示缺失，不参与过渡。
 * 只用在画图上：提示框、表格、读屏一律用真实的值。第一次渲染直接是 values（服务端和浏览器一致）。
 */
export function useTween(values: readonly number[], signature: string): readonly number[] {
  const { spring } = useMotionTokens();
  const key = values.join(",");
  const [state, setState] = useState(() => ({ key, signature, shown: values, from: values, to: values }));
  let current = state;
  if (state.key !== key || state.signature !== signature) {
    // 渲染阶段直接记录“从哪里开始”，避免等到 effect 才更新导致新值闪现一帧
    const continues = state.signature === signature && state.shown.length === values.length;
    current = continues ? { key, signature, shown: state.shown, from: state.shown, to: values } : { key, signature, shown: values, from: values, to: values };
    setState(current);
  }
  const { from, to } = current;
  useEffect(() => {
    if (from === to) return;
    const controls = animate(0, 1, {
      ...spring,
      onUpdate: (p) =>
        setState((s) => (s.to === to ? { ...s, shown: to.map((v, i) => (Number.isFinite(v) && Number.isFinite(from[i]!) ? from[i]! + (v - from[i]!) * p : v)) } : s)),
    });
    return () => controls.stop();
  }, [from, to, spring]);
  return current.shown;
}

export interface ChartTable {
  /** 第一列（横轴）的列名 */
  xLabel: string;
  /** 数值列的列名；未指定时默认使用各可见系列的名称 */
  columns?: string[];
  /** 每行：横轴文字 + 每个数值列的文字 */
  rows: { key: string; x: string; values: string[] }[];
}

export interface ChartFrameProps {
  heading?: string;
  headingLevel?: 2 | 3 | 4;
  description?: ReactNode;
  "aria-label"?: string;
  series: ResolvedSeries[];
  hidden: ReadonlySet<string>;
  onHiddenChange: (hidden: Set<string>) => void;
  showLegend: boolean;
  showTableToggle: boolean;
  /** 悬停在图例上的系列，绘图区里其他系列变淡 */
  onLegendHover: (key: string | null) => void;
  table: ChartTable;
  status: "loading" | "empty" | null;
  emptyState?: ReactNode;
  height: number;
  /** 服务端渲染（和水合）时按这个宽度出图 */
  initialWidth?: number;
  /** 标题栏右侧、“图表 / 表格”切换前的操作区（例如“重置缩放”），仅在图表视图显示 */
  actions?: ReactNode;
  className?: string;
  /** 根元素上的变体属性（data-variant 等） */
  dataAttributes?: Record<`data-${string}`, string | boolean | undefined>;
  /** 绘图区，参数是可用宽度 */
  children: (width: number) => ReactNode;
}

export function ChartFrame({
  heading,
  headingLevel = 3,
  description,
  "aria-label": ariaLabel,
  series,
  hidden,
  onHiddenChange,
  showLegend,
  showTableToggle,
  onLegendHover,
  table,
  status,
  emptyState,
  height,
  initialWidth,
  actions,
  className,
  dataAttributes,
  children,
}: ChartFrameProps) {
  const t = useStrings(chartFrameStrings);
  const Heading = `h${headingLevel}` as const;
  // 加载的时机同 Reveal：很快就加载完时不出现转圈；转圈出现后至少停留一小段时间
  const { phase } = useLoadingPhase(status === "loading");
  const shownStatus = phase !== "content" ? "loading" : status;
  const headingId = useId();
  const descriptionId = useId();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [bodyRef, width] = useElementWidth(640, initialWidth ?? null);
  const name = heading ?? ariaLabel ?? t.chart;
  const visible = series.filter((s) => !hidden.has(s.key));

  return (
    <figure
      {...dataAttributes}
      className={className ? `ui-chart ${className}` : "ui-chart"}
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : ariaLabel}
      aria-describedby={description ? descriptionId : undefined}
    >
      {heading || description || showTableToggle || actions ? (
        <div className="ui-chart__header">
          <div className="ui-chart__titles">
            {heading ? (
              <Heading id={headingId} className="ui-chart__title">
                {heading}
              </Heading>
            ) : null}
            {description ? (
              <p id={descriptionId} className="ui-chart__description">
                {description}
              </p>
            ) : null}
          </div>
          {actions && view === "chart" ? <div className="ui-chart__actions">{actions}</div> : null}
          {showTableToggle ? (
            <SegmentedControl
              aria-label={t.view({ name: typeof name === "string" ? name : t.chart })}
              size="sm"
              selectedKey={view}
              onSelectionChange={(key) => setView(key as "chart" | "table")}
            >
              <Segment id="chart">{t.chart}</Segment>
              <Segment id="table">{t.table}</Segment>
            </SegmentedControl>
          ) : null}
        </div>
      ) : null}

      {showLegend && view === "chart" ? (
        <ToggleButtonGroup
          aria-label={t.legend({ name: typeof name === "string" ? name : t.chart })}
          className="ui-chart__legend"
          selectionMode="multiple"
          disallowEmptySelection
          selectedKeys={series.filter((s) => !hidden.has(s.key)).map((s) => s.key)}
          onSelectionChange={(keys) => onHiddenChange(new Set(series.filter((s) => !keys.has(s.key)).map((s) => s.key)))}
        >
          {series.map((s) => (
            <ToggleButton
              key={s.key}
              id={s.key}
              className="ui-chart__legend-item"
              onHoverStart={() => onLegendHover(s.key)}
              onHoverEnd={() => onLegendHover(null)}
            >
              <span className="ui-chart__swatch" style={{ color: s.color }} aria-hidden="true" />
              {s.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : null}

      <div ref={bodyRef} className="ui-chart__body" style={{ height }}>
        {view === "table" ? (
          <div className="ui-chart__table">
            <Table aria-label={t.data({ name: typeof name === "string" ? name : t.chart })} size="sm" maxHeight={height}>
              <TableHeader>
                <Column isRowHeader>{table.xLabel}</Column>
                {(table.columns ?? visible.map((s) => s.label)).map((label, i) => (
                  <Column key={i} className="ui-chart__number">
                    {label}
                  </Column>
                ))}
              </TableHeader>
              <TableBody>
                {table.rows.map((row) => (
                  <Row key={row.key} id={row.key}>
                    <Cell>{row.x}</Cell>
                    {row.values.map((v, i) => (
                      <Cell key={i} className="ui-chart__number">
                        {v}
                      </Cell>
                    ))}
                  </Row>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : shownStatus === "loading" ? (
          <div className="ui-chart__overlay" data-status="loading" data-waiting={phase === "waiting" || undefined}>
            <Spinner aria-label={t.loading({ name: typeof name === "string" ? name : t.chart })} />
          </div>
        ) : shownStatus === "empty" ? (
          <div className="ui-chart__overlay" data-status="empty">
            {emptyState ?? t.empty}
          </div>
        ) : width === null ? null : (
          children(width)
        )}
      </div>
    </figure>
  );
}

/** 绘图区当前高亮的数据点索引与可见系列索引 */
export interface ChartActive {
  index: number;
  series: number;
  source: "pointer" | "keyboard";
}

export interface ChartPlotProps {
  /** 读屏名称：图表名称 + 概要 */
  label: string;
  width: number;
  height: number;
  /** 横向有几个点 */
  count: number;
  /** 可见系列数 */
  seriesCount: number;
  /** 指针位置（绘图区坐标）对应第几个点；不在任何点上返回 null */
  pick: (x: number, y: number) => { index: number; series?: number } | null;
  /** 播报的文字（和提示框内容一致） */
  describe: (active: ChartActive) => string;
  /** 提示框：锚点（绘图区坐标）和内容 */
  tooltip: (active: ChartActive) => { x: number; y: number; content: ReactNode };
  /** 数据点排列的方向：horizontal 时左右键浏览数据点、上下键切换系列；vertical（条形图）反过来。默认 horizontal */
  orientation?: "horizontal" | "vertical";
  /** 刷选：鼠标在绘图区横向拖出一段（绘图区坐标，from < to）；传入后开启刷选 */
  onBrush?: (from: number, to: number) => void;
  /** 平移：按住 Shift 拖动，参数是这次移动的横向距离（像素） */
  onPan?: (dx: number) => void;
  /** 刷选区域的上下边（绘图区坐标），默认整个高度 */
  brushArea?: { top: number; height: number; left: number; right: number };
  /** 方向键之外的按键（缩放等）。返回 true 表示处理了 */
  onExtraKey?: (e: { key: string; shiftKey: boolean }, active: ChartActive | null) => boolean;
  /** SVG */
  children: (active: ChartActive | null) => ReactNode;
}

const TOOLTIP_OFFSET = 12;

/**
 * 绘图区：整个区域只占一个 Tab 位置。左右键逐个浏览数据点，上下键切换系列，Home / End 到两端，Esc 收起提示框。
 * 每移动一次播报一句（和提示框的内容一样）。鼠标悬停显示同样的提示框。
 */
export function ChartPlot({
  label,
  width,
  height,
  count,
  seriesCount,
  pick,
  describe,
  tooltip,
  orientation = "horizontal",
  onBrush,
  onPan,
  brushArea,
  onExtraKey,
  children,
}: ChartPlotProps) {
  // 正在刷选的一段（绘图区坐标）；正在平移时记下上次的横坐标
  const [brush, setBrush] = useState<{ from: number; to: number } | null>(null);
  const drag = useRef<{ mode: "brush" | "pan"; start: number; last: number } | null>(null);
  const onBrushRef = useRef(onBrush);
  const onPanRef = useRef(onPan);
  onBrushRef.current = onBrush;
  onPanRef.current = onPan;
  const t = useStrings(chartFrameStrings);
  const [active, setActive] = useState<ChartActive | null>(null);
  const [tooltipHidden, setTooltipHidden] = useState(false);
  const { focusProps, isFocusVisible } = useFocusRing();
  const plotRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);

  // 数据变少（筛选或隐藏系列）后，此前高亮的位置可能已经越界
  const current = active && active.index < count && active.series < seriesCount ? active : null;
  const tip = current && !tooltipHidden ? tooltip(current) : null;

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!tip || !el) {
      setTooltipPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // 先放右边，放不下放左边；上下以锚点为中心，不超出绘图区
    const right = tip.x + TOOLTIP_OFFSET;
    const left = right + w <= width ? right : Math.max(0, tip.x - TOOLTIP_OFFSET - w);
    const top = Math.min(Math.max(0, tip.y - h / 2), Math.max(0, height - h));
    setTooltipPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });

  const move = (next: ChartActive) => {
    setActive(next);
    setTooltipHidden(false);
    if (!current || current.index !== next.index || current.series !== next.series) announce(describe(next));
  };

  const onKeyDown: NonNullable<KeyboardEvents["onKeyDown"]> = (e) => {
    if (count === 0) return e.continuePropagation();
    if (onExtraKey?.({ key: e.key, shiftKey: e.shiftKey }, current)) {
      e.preventDefault();
      return;
    }
    const index = current?.index;
    const series = current?.series ?? 0;
    let next: ChartActive | null = null;
    // 条形图的数据点从上往下排：上下键浏览数据点，左右键切换系列
    const swap: Record<string, string> = { ArrowDown: "ArrowRight", ArrowUp: "ArrowLeft", ArrowRight: "ArrowDown", ArrowLeft: "ArrowUp" };
    const key = orientation === "vertical" ? (swap[e.key] ?? e.key) : e.key;
    switch (key) {
      case "ArrowRight":
        next = { index: index === undefined ? 0 : Math.min(count - 1, index + 1), series, source: "keyboard" };
        break;
      case "ArrowLeft":
        next = { index: index === undefined ? count - 1 : Math.max(0, index - 1), series, source: "keyboard" };
        break;
      case "ArrowDown":
        next = { index: index ?? 0, series: Math.min(seriesCount - 1, series + 1), source: "keyboard" };
        break;
      case "ArrowUp":
        next = { index: index ?? 0, series: Math.max(0, series - 1), source: "keyboard" };
        break;
      case "Home":
        next = { index: 0, series, source: "keyboard" };
        break;
      case "End":
        next = { index: count - 1, series, source: "keyboard" };
        break;
      case "Escape":
        if (current && !tooltipHidden) {
          e.preventDefault();
          setTooltipHidden(true);
          return;
        }
        return e.continuePropagation();
      default:
        return e.continuePropagation();
    }
    e.preventDefault();
    move(next);
  };
  const { keyboardProps } = useKeyboard({ onKeyDown });
  // 触屏点一下也显示提示框（指针悬停只有鼠标、触控笔有）
  const { pressProps } = usePress({
    onPressStart: (e) => {
      if (e.pointerType === "keyboard" || e.pointerType === "virtual") return;
      const hit = pick(e.x, e.y);
      if (!hit) return;
      setTooltipHidden(false);
      setActive((a) => ({ index: hit.index, series: hit.series ?? a?.series ?? 0, source: "pointer" }));
    },
  });

  // 鼠标、触控笔按住拖：刷选（按住 Shift 时平移）。触屏的拖动留给页面滚动。
  // 绘图区本身是 application（键盘由 useKeyboard 处理），这里只补按下的那一下：挂原生监听
  const brushable = !!onBrush || !!onPan;
  useEffect(() => {
    const el = plotRef.current;
    if (!el || !brushable) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      const mode = e.shiftKey && onPanRef.current ? "pan" : onBrushRef.current ? "brush" : null;
      if (!mode) return;
      const px = e.clientX - el.getBoundingClientRect().left;
      drag.current = { mode, start: px, last: px };
      el.setPointerCapture(e.pointerId);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [brushable]);

  const local = (e: PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };

  return (
    <div
      ref={plotRef}
      // 方向键要交给图表处理：application 让读屏在这里切到焦点模式（浏览模式会自己吃掉方向键）
      role="application"
      aria-roledescription={t.chart}
      aria-label={label}
      tabIndex={count ? 0 : -1}
      className="ui-chart__plot"
      data-focus-visible={isFocusVisible || undefined}
      data-zoomable={onBrush ? "" : undefined}
      {...mergeProps(focusProps, keyboardProps, pressProps, {
        onBlur: () => setActive((a) => (a?.source === "keyboard" ? null : a)),
      })}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        setBrush(null);
        const [px] = local(e);
        // 只是点一下（没怎么动）不算刷选
        if (d.mode === "brush" && Math.abs(px - d.start) > 6) onBrush?.(Math.min(d.start, px), Math.max(d.start, px));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setBrush(null);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) {
          const [px] = local(e);
          if (d.mode === "pan") onPan?.(px - d.last);
          else {
            const lo = brushArea?.left ?? 0;
            const hi = width - (brushArea?.right ?? 0);
            setBrush({ from: Math.max(lo, Math.min(d.start, px)), to: Math.min(hi, Math.max(d.start, px)) });
          }
          d.last = px;
          return;
        }
        if (e.pointerType === "touch" && e.buttons === 0) return;
        const hit = pick(...local(e));
        if (!hit) return setActive((a) => (a?.source === "pointer" ? null : a));
        setTooltipHidden(false);
        setActive((a) => ({ index: hit.index, series: hit.series ?? a?.series ?? 0, source: "pointer" }));
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") setActive((a) => (a?.source === "pointer" ? null : a));
      }}
    >
      {children(current)}
      {brush ? (
        <div
          className="ui-chart__brush"
          aria-hidden="true"
          style={{ left: brush.from, width: brush.to - brush.from, top: brushArea?.top ?? 0, height: brushArea?.height ?? height }}
        />
      ) : null}
      {tip && !brush ? (
        <div
          ref={tooltipRef}
          className="ui-chart__tooltip"
          aria-hidden="true"
          style={tooltipPos ? { left: tooltipPos.left, top: tooltipPos.top } : { visibility: "hidden" }}
        >
          {tip.content}
        </div>
      ) : null}
    </div>
  );
}

/** 提示框里的一行：色块 + 系列名 + 数值 */
export function TooltipRow({ color, label, value, isActive }: { color?: string; label: string; value: string; isActive?: boolean }) {
  return (
    <div className="ui-chart__tooltip-row" data-active={isActive || undefined}>
      {/* 不是系列的行（散点图的横轴、纵轴数值）不画色块，但占住位置，文字和有色块的行对齐 */}
      <span className="ui-chart__swatch" data-none={color ? undefined : ""} style={color ? { color } : undefined} />
      <span className="ui-chart__tooltip-label">{label}</span>
      <span className="ui-chart__tooltip-value">{value}</span>
    </div>
  );
}
