"use client";

import type { ReactNode, Ref, RefObject } from "react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { SliderProps as AriaSliderProps, SliderState } from "react-aria-components";
import { Label, Slider as AriaSlider, SliderFill, SliderOutput, SliderThumb, SliderTrack, useLocale } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import "./slider.css";

/**
 * 滑块：在一个范围里拖动选值，例如音量、透明度、价格区间。传数组时是区间（两个滑块）。
 * 需要精确数值时用 NumberField（或者两者一起用）。也可以是几个带名字的档位（stops），例如思考强度"关闭 / 低 / 中 / 高 / 最高"。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

/** 一个档位：名字，以及停在这一档时显示在滑块下面的说明。 */
export interface SliderStop {
  /** 档位的名字，例如"高"。显示在标签右边，读屏读的也是它。 */
  label: string;
  /** 停在这一档时滑块下面的一行说明，例如"最慢，用量最多"。读屏作为滑块的描述。 */
  description?: string;
}

export interface SliderProps<T extends number | number[]> extends Omit<AriaSliderProps<T>, "children"> {
  /** 可见标签。不显示时写 aria-label。 */
  label?: ReactNode;
  /**
   * 显示当前值（按 formatOptions 格式化）。true：标签右边；"thumb"：每个滑块上方一个小气泡（区间滑块、轨道很长时更好对照）；false：不显示。
   * @default true
   */
  showValue?: boolean | "thumb";
  /** 区间滑块两个滑块各自的读屏名称，例如 ["最低价", "最高价"]。 */
  thumbLabels?: string[];
  /**
   * 带名字的档位，从小到大。写了以后滑块只能停在这些档位上（值是档位的序号，从 0 开始；minValue / maxValue / step 不再起作用），
   * 每一档一个刻度，标签右边和读屏都是档位的名字；轨道变粗，滑块在轨道里面。只用于横向的单个值。
   */
  stops?: (string | SliderStop)[];
  /** 轨道两端下面的说明，例如 ["更快", "更深入"]，说明往哪边拖意味着什么。 */
  endLabels?: [ReactNode, ReactNode];
  /**
   * 停在最后一档时强调：accent 色从滑块漫过整条轨道（越来越慢），之后不时有一道浪花扫过。用在"最高档有额外代价"的场合，
   * 例如最高的思考强度。需要 stops。减弱动效时直接变色，不动。
   */
  emphasizeLast?: boolean;
  /** 表单字段名：提交表单时带上当前值（区间时同名提交两个值）。 */
  name?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 滑块。基于 React Aria Slider：方向键按 step 移动，PageUp / PageDown 大步移动，Home / End 到两端；
 * 底层是原生 range input，读屏读出数值（按 formatOptions 格式化）；有档位时读档位的名字。
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
              {/* 数值气泡：和滑块分开放（滑块拖动缩小时气泡不跟着缩），按位置对齐滑块。
                  读屏从滑块本身读数值，气泡只给眼睛看 */}
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
