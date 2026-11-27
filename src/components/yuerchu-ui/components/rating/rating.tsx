"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useNumberFormatter } from "react-aria";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { Button } from "../button/button";
import { ratingStrings } from "./rating.strings";
import "./rating.css";

/**
 * 用于展示与录入星级评分的组件，支持整星、半星以及只读平均分展示，并始终在星形旁显示对应数值。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface RatingProps {
  /** 整组的可见标签；未传入时默认使用读屏名称“评分”。 */
  label?: ReactNode;
  /** 不显示可见标签时的无障碍名称。 */
  "aria-label"?: string;
  /** 当前评分（受控），0 表示尚未评分。 */
  value?: number;
  /**
   * 默认评分。
   * @default 0
   */
  defaultValue?: number;
  /** 分值变更或清除评分时触发。 */
  onChange?: (value: number) => void;
  /**
   * 总星数，需为 1 到 10 的整数。
   * @default 5
   */
  maxValue?: number;
  /**
   * 评分步长：1 表示整星，0.5 表示半星；只读模式下保留原始小数而不按步长舍入。
   * @default 1
   */
  step?: 1 | 0.5;
  /** 是否以只读形态展示，开启后不提供可聚焦的编辑控件。 */
  isReadOnly?: boolean;
  /** 是否禁用评分交互。 */
  isDisabled?: boolean;
  /** 是否允许清除为未评分状态，开启且当前分值大于 0 时显示清除按钮。 */
  allowsClear?: boolean;
  /** 表单字段名；编辑模式下随表单提交已选分值，尚未评分时不产生选中项。 */
  name?: string;
  /** 根元素附加类名。 */
  className?: string;
}

// 星形仅作视觉装饰，不参与键盘焦点与读屏播报。
function Star({ amount }: { amount: number }) {
  const shape = "M12 2 15 8.5 22 9.5 17 14.5 18.2 22 12 18.5 5.8 22 7 14.5 2 9.5 9 8.5Z";
  return (
    <span className="ui-rating__star" aria-hidden="true">
      <svg className="ui-rating__outline" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d={shape} /></svg>
      <span className="ui-rating__fill" style={{ width: `${amount * 100}%` }}>
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d={shape} /></svg>
      </span>
    </span>
  );
}

/** 基于单选组实现星级评分，支持 Tab 进出、方向键选择以及半星拆分为左右两个选项。 */
export function Rating({
  label,
  "aria-label": ariaLabel,
  value,
  defaultValue = 0,
  onChange,
  maxValue = 5,
  step = 1,
  isReadOnly,
  isDisabled,
  allowsClear = false,
  name,
  className,
}: RatingProps) {
  const t = useStrings(ratingStrings);
  const format = useNumberFormatter({ maximumFractionDigits: 1 });
  const [own, setOwn] = useState(defaultValue);
  if (!Number.isInteger(maxValue) || maxValue < 1 || maxValue > 10) {
    throw new Error("Rating maxValue must be an integer between 1 and 10.");
  }
  const raw = value ?? own;
  const bounded = Number.isFinite(raw) ? Math.min(maxValue, Math.max(0, raw)) : 0;
  const current = isReadOnly ? bounded : Math.round(bounded / step) * step;
  const text = current === 0 ? t.empty : t.score({ value: format.format(current), max: maxValue });
  const stars = Array.from({ length: maxValue }, (_, i) => Math.min(1, Math.max(0, current - i)));
  const change = (next: number) => {
    setOwn(next);
    onChange?.(next);
  };
  const classes = className ? `ui-rating ${className}` : "ui-rating";
  if (isReadOnly) {
    return (
      <div className={classes} data-readonly="">
        {label ? <span className="ui-label">{label}</span> : null}
        <span role="img" aria-label={`${ariaLabel ?? (typeof label === "string" ? label : t.label)}: ${text}`}>
          <span className="ui-rating__stars">{stars.map((amount, i) => <Star key={i} amount={amount} />)}</span>
        </span>
        <span className="ui-rating__value" aria-hidden="true">{format.format(current)} / {maxValue}</span>
      </div>
    );
  }
  return (
    <RadioGroup
      className={classes}
      {...(ariaLabel ? { "aria-label": ariaLabel } : !label ? { "aria-label": t.label } : {})}
      orientation="horizontal"
      value={current > 0 ? String(current) : ""}
      onChange={(next) => change(Number(next))}
      isDisabled={isDisabled}
      name={name}
      data-half={step === 0.5 || null}
    >
      {label ? <Label className="ui-label">{label}</Label> : null}
      <div className="ui-rating__stars">
        {stars.map((amount, i) => (
          <span className="ui-rating__cell" key={i}>
            <Star amount={amount} />
            {step === 0.5 ? (
              <Radio
                value={String(i + 0.5)}
                aria-label={t.score({ value: format.format(i + 0.5), max: maxValue })}
                className="ui-rating__option"
                data-half="start"
              />
            ) : null}
            <Radio
              value={String(i + 1)}
              aria-label={t.score({ value: format.format(i + 1), max: maxValue })}
              className="ui-rating__option"
              data-half={step === 0.5 ? "end" : null}
            />
          </span>
        ))}
      </div>
      <span className="ui-rating__value" aria-hidden="true">{format.format(current)} / {maxValue}</span>
      {allowsClear && current > 0 ? (
        <Button variant="ghost" size="sm" isDisabled={isDisabled} onPress={() => change(0)}>{t.clear}</Button>
      ) : null}
    </RadioGroup>
  );
}
