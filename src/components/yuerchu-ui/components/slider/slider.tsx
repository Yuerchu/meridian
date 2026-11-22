"use client";

import type { ReactNode, Ref, RefObject } from "react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { SliderProps as AriaSliderProps, SliderState } from "react-aria-components";
import { Label, Slider as AriaSlider, SliderFill, SliderOutput, SliderThumb, SliderTrack, useLocale } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./slider.css";

/**
 * 在连续范围或有序档位中拖动选值的滑块控件，支持单值、区间以及跟随滑块的数值气泡。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

/** 单个档位的配置项，包含名称以及停在该档位时显示的说明。 */
export interface SliderStop {
  /** 档位名称（例如“高”），显示在标签右侧并供读屏播报。 */
  label: string;
  /** 停在该档位时显示在滑块下方的说明（例如“最慢，用量最多”），同时作为读屏描述。 */
  description?: string;
}

export interface SliderProps<T extends number | number[]> extends Omit<AriaSliderProps<T>, "children"> {
  /** 可见标签；未显示可见标签时需传入 aria-label。 */
  label?: ReactNode;
  /**
   * 当前数值的显示位置：true 显示在标签右侧，“thumb”在每个滑块上方显示跟随气泡，false 则不显示。
   * @default true
   */
  showValue?: boolean | "thumb";
  /** 区间滑块中两个滑块各自的读屏名称，例如 `["最低价", "最高价"]`。 */
  thumbLabels?: string[];
  /**
   * 按从低到高排列的命名档位。传入 stops 后滑块只能停留在对应档位，值为从 0 开始的索引，且仅支持横向单值模式。
   */
  stops?: (string | SliderStop)[];
  /** 轨道两端下方展示的方向提示文案，例如 `["更快", "更深入"]`。 */
  endLabels?: [ReactNode, ReactNode];
  /**
   * 是否在停留在最后一档时启用强调提示与波纹效果（需配合 stops 使用），适用于“最高档有额外代价”的场景；减弱动效模式下直接切换颜色。
   */
  emphasizeLast?: boolean;
  /** 表单提交字段名，区间滑块会以同名提交两个数值。 */
  name?: string;
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 基于 React Aria Slider 封装，底层使用原生 range input，支持方向键步进、区间双滑块以及档位读屏名称映射。
 *
 * @promote value, defaultValue, onChange, name, onChangeEnd, minValue, maxValue, step, formatOptions, isDisabled, orientation, stops, endLabels, emphasizeLast
 */
export function Slider<T extends number | number[]>({
  label,
  showValue = true,
  thumbLabels,
  stops: rawStops,
  endLabels,
  emphasizeLast = false,
  name,
  className,
  ...props
}: SliderProps<T>) {
  const stops = rawStops?.map((s) => (typeof s === "string" ? { label: s } : s));
  const hasDescriptions = stops?.some((s) => s.description) ?? false;
  const descriptionId = useId();
  const stopLabel = (value: number) => stops?.[Math.round(value)]?.label ?? "";
  const range = stops ? { minValue: 0, maxValue: Math.max(stops.length - 1, 0), step: 1 } : {};
  return (
    <AriaSlider
      {...props}
      {...range}
      className={withUiClass("ui-slider", className)}
      data-value-display={showValue === "thumb" ? "thumb" : undefined}
      data-stops={stops ? "" : undefined}
    >
      {({ state, isDisabled }) => {
        const value = state.values[0] ?? 0;
        const description = stops?.[Math.round(value)]?.description;
        return (
          <>
            {label || showValue === true ? (
              <div className="ui-slider__header">
                {label ? <Label className="ui-label">{label}</Label> : <span />}
                {showValue === true ? <SliderOutput className="ui-slider__output">{stops ? stopLabel(value) : undefined}</SliderOutput> : null}
              </div>
            ) : null}
            <SliderTrack className="ui-slider__track">
              <div className="ui-slider__rail" />
              {stops ? <Stops count={stops.length} value={value} emphasize={emphasizeLast && !isDisabled} /> : null}
              <SliderFill className="ui-slider__fill" />
              {state.values.map((v, i) => (
                // name 要写在滑块上：值存在滑块里的原生 range input 上
                <Thumb
                  key={i}
                  index={i}
                  name={name}
                  label={thumbLabels?.[i]}
                  valueText={stops ? stopLabel(v) : undefined}
                  describedBy={hasDescriptions ? descriptionId : undefined}
                />
              ))}
              {/* 数值气泡：与滑块分开放置以避免拖动缩小时跟随缩放，读屏直接读取滑块数值，气泡仅作视觉展示 */}
              {showValue === "thumb"
                ? state.values.map((v, i) => (
                    <span
                      key={i}
                      className="ui-slider__bubble"
                      aria-hidden="true"
                      style={{ insetInlineStart: `${state.getThumbPercent(i) * 100}%` }}
                      data-active={state.isThumbDragging(i) || state.focusedThumb === i || undefined}
                    >
                      {stops ? stopLabel(v) : state.getThumbValueLabel(i)}
                    </span>
                  ))
                : null}
            </SliderTrack>
            {endLabels ? (
              <div className="ui-slider__ends">
                <span>{endLabels[0]}</span>
                <span>{endLabels[1]}</span>
              </div>
            ) : null}
            {hasDescriptions ? (
              <p id={descriptionId} className="ui-slider__description">
                {description}
              </p>
            ) : null}
          </>
        );
      }}
    </AriaSlider>
  );
}

/**
 * 档位的刻度，以及最后一档的强调（水和浪头）。只是画面，读屏不读。
 * 从别的档位拖到最后一档时（data-entering）水从滑块漫过整条；一开始就在最后一档时直接是漫完的样子，不播漫过的动画
 */
function Stops({ count, value, emphasize }: { count: number; value: number; emphasize: boolean }) {
  const isLast = emphasize && Math.round(value) === count - 1;
  const wasLast = useRef<boolean | null>(null);
  const entering = useRef(false);
  if (!isLast) entering.current = false;
  else if (wasLast.current === false) entering.current = true;
  wasLast.current = isLast;
  return (
    <div className="ui-slider__stops" aria-hidden="true" data-emphasized={isLast || undefined} data-entering={(isLast && entering.current) || undefined}>
      {emphasize ? (
        <div className="ui-slider__sea">
          <div className="ui-slider__water" />
          <div className="ui-slider__crest" />
        </div>
      ) : null}
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="ui-slider__tick" style={{ insetInlineStart: `${count > 1 ? (i / (count - 1)) * 100 : 0}%` }} />
      ))}
    </div>
  );
}

function Thumb({
  index,
  name,
  label,
  valueText,
  describedBy,
}: {
  index: number;
  name?: string;
  label?: string;
  valueText?: string;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // React Aria 的 aria-valuetext 总是格式化后的数字：有档位时换成档位的名字（每次渲染后写一次，React 改回数字后马上覆盖）
  useLayoutEffect(() => {
    if (valueText !== undefined) inputRef.current?.setAttribute("aria-valuetext", valueText);
  });
  return (
    <SliderThumb
      ref={ref}
      inputRef={inputRef}
      index={index}
      name={name}
      aria-label={label}
      aria-describedby={describedBy}
      className="ui-slider__thumb"
    >
      {({ state, isDragging }) => <Overdrag thumbRef={ref} index={index} state={state} isDragging={isDragging} />}
    </SliderThumb>
  );
}

/** 拖过头多少像素时，滑块走到上限的一半（上限是 CSS 的 --ui-slider-stretch） */
const OVERDRAG_HALF = 16;

/**
 * 拖到头还往外拖：滑块不变形，带着阻力多走一小段，拖得越远越走不动（有上限），松手弹回。
 * 越界量写进 --ui-slider-over（-1~1，正的是往右 / 往下），走多远由 CSS 按 --ui-slider-stretch 算，减弱动效时不动。
 * 直接改滑块（和它的数值气泡）的属性，不触发重新渲染（拖动时每帧都在变）
 */
function Overdrag({ thumbRef, index, state, isDragging }: { thumbRef: RefObject<HTMLDivElement | null>; index: number; state: SliderState; isDragging: boolean }) {
  const { direction } = useLocale();
  const latest = useRef(state);
  latest.current = state;
  // 按下的位置离滑块中心多远：拖动时滑块一直保持这段距离，越界量要从滑块中心算，不是从指针算。按在轨道上时滑块跳到指针下面，是 0
  const grab = useRef(0);
  useEffect(() => {
    const thumb = thumbRef.current;
    const track = thumb?.parentElement;
    if (!thumb || !track) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !thumb.contains(e.target)) {
        grab.current = 0;
        return;
      }
      const r = thumb.getBoundingClientRect();
      const vertical = thumb.closest(".ui-slider")?.getAttribute("data-orientation") === "vertical";
      grab.current = vertical ? e.clientY - (r.top + r.bottom) / 2 : e.clientX - (r.left + r.right) / 2;
    };
    track.addEventListener("pointerdown", onDown, true);
    return () => track.removeEventListener("pointerdown", onDown, true);
  }, [thumbRef]);
  useEffect(() => {
    const thumb = thumbRef.current;
    if (!isDragging || !thumb) return;
    const track = thumb.parentElement;
    const vertical = thumb.closest(".ui-slider")?.getAttribute("data-orientation") === "vertical";
    // 数值变大时滑块在屏幕上往哪边走
    const inc = vertical ? -1 : direction === "rtl" ? -1 : 1;
    const targets = () => [thumb, track?.querySelectorAll<HTMLElement>(".ui-slider__bubble")[index]].filter((el) => el !== undefined);
    const clear = () => {
      for (const el of targets()) {
        el.removeAttribute("data-over");
        el.style.removeProperty("--ui-slider-over");
      }
    };
    const onMove = (e: PointerEvent) => {
      const s = latest.current;
      if (!track) return;
      const r = track.getBoundingClientRect();
      const pct = s.getThumbPercent(index);
      const pos = vertical ? r.bottom - pct * r.height : inc > 0 ? r.left + pct * r.width : r.right - pct * r.width;
      const delta = (vertical ? e.clientY : e.clientX) - grab.current - pos;
      const value = s.getThumbValue(index);
      const pushing = (value >= s.getThumbMaxValue(index) && delta * inc > 0) || (value <= s.getThumbMinValue(index) && delta * inc < 0);
      if (!pushing) {
        clear();
        return;
      }
      const over = Math.sign(delta) * (1 - 1 / (Math.abs(delta) / OVERDRAG_HALF + 1));
      for (const el of targets()) {
        el.setAttribute("data-over", "");
        el.style.setProperty("--ui-slider-over", over.toFixed(3));
      }
    };
    document.addEventListener("pointermove", onMove);
    return () => {
      document.removeEventListener("pointermove", onMove);
      clear();
    };
  }, [isDragging, index, direction, thumbRef]);
  return null;
}
