"use client";

import type { ReactNode, Ref } from "react";
import { useContext, useRef, useState } from "react";
import { useMove } from "react-aria";
import type { NumberFieldProps as AriaNumberFieldProps, ValidationResult } from "react-aria-components";
import { Button as AriaButton, NumberField as AriaNumberField, NumberFieldStateContext } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { MinusIcon, PlusIcon } from "../../lib/icons";
import { Description, FieldError, Label } from "../field/field";
import { Input, useAffixes } from "../text-field/text-field";
import "./number-field.css";

/**
 * 数字输入框：数量、金额、百分比这类数字，按本地格式显示（千分位、货币符号），可以用方向键和按钮加减。
 * 在一个范围里粗略地选值用 Slider；电话、验证码、卡号不是"数字"，用 TextField 或 OTPField。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface NumberFieldProps extends Omit<AriaNumberFieldProps, "children"> {
  /** 可见标签。每个输入框都必须有标签；确实不显示标签时，改写 aria-label。 */
  label?: ReactNode;
  /** 输入框下方的说明文字，例如范围和单位。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字。 */
  placeholder?: string;
  /**
   * 尺寸，对应控件高度 --control-sm / --control-md / --control-lg。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 输入框里左侧的固定文字，例如 "¥"。货币、百分比优先用 formatOptions（跟随语言）；这里放单位这类格式化做不到的文字。读屏作为说明读出。 */
  prefix?: ReactNode;
  /** 输入框里右侧的固定文字，例如 "元/月"、"台"、"天"。读屏作为说明读出。 */
  suffix?: ReactNode;
  /**
   * 拖动标签调值：按住标签左右拖，每 4px 一个 step；按住 Shift 快十倍，按住 Alt 慢十倍。用在检查器、属性面板这类
   * 要反复微调数字的地方。只是给鼠标和触屏多一种方式：键盘仍然用方向键，读屏不受影响。需要有可见的 label。
   */
  isScrubbable?: boolean;
  /** 指向底层的 input 元素。 */
  ref?: Ref<HTMLInputElement>;
}

/** 拖多少像素算一个 step */
const PX_PER_STEP = 4;

/**
 * 数字输入框。基于 React Aria NumberField：↑↓ 按 step 增减，PageUp / PageDown 大步增减，Home / End 到最小 / 最大值；
 * 按 formatOptions 和当前语言格式化（UIProvider 固定为中文）；手机上弹出数字键盘。
 * 右侧的 −、+ 按钮不在 Tab 顺序里（键盘用方向键），到达最小 / 最大值时禁用。
 *
 * @promote value, defaultValue, onChange, minValue, maxValue, step, formatOptions, isRequired, isInvalid, isDisabled, isReadOnly, validate, name
 */
export function NumberField({
  label,
  description,
  errorMessage,
  placeholder,
  size = "md",
  prefix,
  suffix,
  isScrubbable = false,
  ref,
  className,
  ...props
}: NumberFieldProps) {
  const affix = useAffixes(prefix, suffix, props);
  return (
    <AriaNumberField
      {...props}
      id={affix.id}
      aria-describedby={affix.describedBy}
      className={withUiClass("ui-text-field ui-number-field", className)}
      data-size={size}
    >
      {label ? (
        <Label>
          {isScrubbable && !props.isDisabled && !props.isReadOnly ? (
            <ScrubHandle step={props.step ?? 1} min={props.minValue} max={props.maxValue}>
              {label}
            </ScrubHandle>
          ) : (
            label
          )}
        </Label>
      ) : null}
      <div className="ui-text-field__control" data-has-affix={affix.has || undefined}>
        {affix.prefix}
        <Input ref={ref} placeholder={placeholder} />
        {affix.suffix}
        <span className="ui-number-field__steppers">
          <AriaButton slot="decrement" className="ui-number-field__step">
            <MinusIcon />
          </AriaButton>
          <AriaButton slot="increment" className="ui-number-field__step">
            <PlusIcon />
          </AriaButton>
        </span>
      </div>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaNumberField>
  );
}

/**
 * 标签里可以左右拖的那段文字。按下时记下当前值，之后按累计的水平位移换算成新值（对齐到 step、限制在最小最大值之间）。
 * 只处理指针：键盘调值在输入框上用方向键，这里不重复。
 */
function ScrubHandle({ step, min, max, children }: { step: number; min?: number; max?: number; children: ReactNode }) {
  const state = useContext(NumberFieldStateContext);
  const [scrubbing, setScrubbing] = useState(false);
  const start = useRef(0);
  const moved = useRef(0);
  const decimals = (String(step).split(".")[1] ?? "").length;
  const { moveProps } = useMove({
    onMoveStart(e) {
      if (e.pointerType === "keyboard" || !state) return;
      start.current = Number.isNaN(state.numberValue) ? (min ?? 0) : state.numberValue;
      moved.current = 0;
      setScrubbing(true);
    },
    onMove(e) {
      if (e.pointerType === "keyboard" || !state) return;
      // Shift 快十倍，Alt 慢十倍（一个 step 要拖 40px）
      const rate = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      moved.current += e.deltaX * rate;
      let next = start.current + Math.round(moved.current / PX_PER_STEP) * step;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      next = Number(next.toFixed(decimals));
      if (next !== state.numberValue) state.setNumberValue(next);
    },
    onMoveEnd() {
      setScrubbing(false);
    },
  });
  return (
    <span {...moveProps} className="ui-number-field__scrub" data-scrubbing={scrubbing || undefined}>
      {children}
    </span>
  );
}
