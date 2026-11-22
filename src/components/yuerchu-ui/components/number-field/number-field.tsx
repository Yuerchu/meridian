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
 * 用于输入数量、金额、百分比等需要精确控制与步进微调的数值，支持本地化格式显示和方向键、按钮增减。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface NumberFieldProps extends Omit<AriaNumberFieldProps, "children"> {
  /** 可见标签。若不显示可见标签，需传入 `aria-label`。 */
  label?: ReactNode;
  /** 输入框下方的说明文字，如取值范围和单位说明。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字。 */
  placeholder?: string;
  /**
   * 控件尺寸。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 输入框左侧的固定前缀文字（如“¥”），读屏会作为补充说明读出。货币和百分比优先使用 `formatOptions`。 */
  prefix?: ReactNode;
  /** 输入框右侧的固定后缀文字（如“元/月”“台”“天”），读屏会作为补充说明读出。 */
  suffix?: ReactNode;
  /**
   * 是否开启按住标签左右拖动调值（每 4px 调整一个 `step`，按住 `Shift` 快十倍，按住 `Alt` 慢十倍），适用于属性面板等需要高频微调的场景，需配合可见 `label` 使用。
   */
  isScrubbable?: boolean;
  /** 指向底层 `input` 元素的引用。 */
  ref?: Ref<HTMLInputElement>;
}

/** 拖多少像素算一个 step */
const PX_PER_STEP = 4;

/**
 * 数字输入框，基于 React Aria NumberField。支持方向键按 `step` 增减、`PageUp` / `PageDown` 大步调整与 `Home` / `End` 跳转边界，并按 `formatOptions` 与当前页面语言自动格式化。
 * 右侧的 `−`、`+` 按钮不参与 `Tab` 顺序，到达边界时自动禁用。
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
