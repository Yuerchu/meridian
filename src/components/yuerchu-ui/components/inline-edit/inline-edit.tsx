"use client";

import type { ReactNode } from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { useKeyboard, useNumberFormatter, VisuallyHidden } from "react-aria";
import { Button as AriaButton, TableStateContext } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { PenIcon } from "../../lib/icons";
import { ListBoxItem } from "../listbox/listbox";
import { NumberField } from "../number-field/number-field";
import { Select } from "../select/select";
import { Spinner } from "../spinner/spinner";
import { TextField } from "../text-field/text-field";
import { inlineEditStrings } from "./inline-edit.strings";
import "./inline-edit.css";

/**
 * 将平时以文本展示的字段在点击或键盘触发后就地切换为输入控件，修改后按 Enter 或失焦即可保存，适用于表格单元格或详情页中的独立字段。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface InlineEditOption {
  /** 选项唯一标识（即 `value`）。 */
  id: string;
  /** 选项展示文字。 */
  label: string;
}

export interface InlineEditProps {
  /** 字段名称（必填），如“员工账号”。供读屏识别并用于错误播报。 */
  "aria-label": string;
  /** 当前值（受控）。 */
  value?: string;
  /** 默认值（非受控）。 */
  defaultValue?: string;
  /**
   * 值发生变化且通过校验后调用的保存回调。若返回 Promise，等待期间输入框设为只读并显示加载指示；抛出 Error 时保持编辑并展示错误信息。
   */
  onCommit?: (value: string) => void | Promise<void>;
  /** 校验函数，返回错误文本表示不通过（保持编辑不保存），返回 `null` 或 `undefined` 表示通过。 */
  validate?: (value: string) => string | null | undefined;
  /**
   * 值为空时显示的占位文字。
   * @default "未填写"（英文界面 "Empty"）
   */
  placeholder?: string;
  /** 自定义显示态的值渲染方式（如格式化或附带图标）。显示态外层为按钮，请勿在内部放置链接或按钮。 */
  renderValue?: (value: string) => ReactNode;
  /** 是否禁用编辑，设为 `true` 时仅作只读展示。 */
  isDisabled?: boolean;
  /**
   * 组件尺寸，`sm` 适用于表格单元格，`md` 适用于详情页独立字段。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 显示态文字超出宽度时是否换行（默认截断为省略号），适合备注等长度不定的内容。 */
  wrap?: boolean;
  /**
   * 编辑器类型：`text` 为单行输入框；`number` 为数字输入框（`value` 为数字字符串如 `"1250"`，清空为 `""`）；`select` 为下拉选择器（`value` 为选项 `id`，选中即保存）。
   * @default "text"
   */
  type?: "text" | "number" | "select";
  /** `type="select"` 时的候选项列表。 */
  options?: InlineEditOption[];
  /** `type="number"` 时的数字格式配置（同 NumberField），如 `{ style: "currency", currency: "CNY" }`，显示与编辑时均生效。 */
  formatOptions?: Intl.NumberFormatOptions;
  /** `type="number"` 时的最小值。 */
  minValue?: number;
  /** `type="number"` 时的最大值。 */
  maxValue?: number;
  /** `type="number"` 时的步进值。 */
  step?: number;
  /** 附加到根元素的自定义类名。 */
  className?: string;
}

type Caret = "select" | "end";

/**
 * 原地编辑控件，支持点击、`Enter`（全选文字）、`F2`（光标置末）或直接输入替换开始编辑；
 * 按 `Enter` 或失焦保存，按 `Esc` 取消并恢复原值。置于 Table 或 DataTable 单元格中时支持 `Tab` 连续编辑，并在编辑期间暂停表格方向键导航。
 *
 * @promote value, onCommit, validate, renderValue
 */
export function InlineEdit({
  "aria-label": label,
  value: valueProp,
  defaultValue = "",
  onCommit,
  validate,
  placeholder: placeholderProp,
  renderValue,
  isDisabled = false,
  size = "md",
  wrap = false,
  type = "text",
  options = [],
  formatOptions,
  minValue,
  maxValue,
  step,
  className,
}: InlineEditProps) {
  const t = useStrings(inlineEditStrings);
  const placeholder = placeholderProp === undefined ? t.empty : placeholderProp;
  const [own, setOwn] = useState(defaultValue);
  const value = valueProp === undefined ? own : valueProp;
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState(value);
  // 最新的草稿：数字输入框在 Enter / 失焦时才把文字解析成数字（和我们的按键处理在同一个事件里），保存时读这里
  const draftRef = useRef(value);
  const setDraft = (next: string) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const numberFormat = useNumberFormatter(formatOptions ?? {});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const caret = useRef<Caret>("select");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  // 下拉这次编辑选过了（选了就保存，关闭时不用再结束编辑）
  const chose = useRef(false);
  // 数字输入框直接打字开始时打的那个字：数字输入框是受控的，写进 value 会被格式化成“¥9.00”，所以等它出现后当作用户输入填进去
  const typed = useRef<string | null>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  // 结束编辑后焦点要不要回到文字上（Enter / Esc 回去；焦点自己离开时不抢）
  const refocus = useRef(false);
  const table = useContext(TableStateContext);

  // 表格里编辑时，暂停表格的方向键导航和输入跳转，按键留给输入框
  useEffect(() => {
    if (!table || !editing) return;
    table.setKeyboardNavigationDisabled(true);
    return () => table.setKeyboardNavigationDisabled(false);
  }, [table, editing]);

  useEffect(() => {
    const input = inputRef.current;
    // 下拉一开始就是打开的，焦点由 React Aria 放进选项列表
    if (editing && type === "select") return;
    if (editing && input) {
      input.focus();
      if (typed.current !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, typed.current);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        typed.current = null;
      }
      if (caret.current === "select") input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    } else if (!editing && refocus.current) {
      refocus.current = false;
      const display = displayRef.current;
      display?.focus();
    }
  }, [editing]);

  // 表格里文字获得焦点时，把所在单元格记成表格的当前单元格。键盘操作时 React Aria 不会因为单元格里的元素获得焦点而更新它，
  // 用 Tab 跳过来之后再按方向键会从原来的单元格出发
  const syncFocusedCell = () => {
    const key = displayRef.current?.closest("[role=gridcell], [role=rowheader]")?.getAttribute("data-key");
    if (table && key != null && table.collection.getItem(key) && table.selectionManager.focusedKey !== key) table.selectionManager.setFocusedKey(key);
  };

  const start = (initial: string, mode: Caret) => {
    if (isDisabled) return;
    caret.current = mode;
    setDraft(initial);
    setError(null);
    chose.current = false;
    setEditing(true);
  };

  const stop = (focusBack: boolean) => {
    refocus.current = focusBack;
    setEditing(false);
    setError(null);
  };

  /** 保存。返回是否成功（校验或保存失败时保持编辑） */
  const commit = async (focusBack: boolean): Promise<boolean> => {
    if (pending) return false;
    const draft = draftRef.current;
    if (draft === value) {
      stop(focusBack);
      return true;
    }
    const problem = validate?.(draft);
    if (problem) {
      setError(problem);
      announce(`${label}：${problem}`, "assertive");
      // 焦点自己离开时不拉回来（用户已经去点别的了），输入框留着显示错误
      if (focusBack) (type === "select" ? selectRef.current?.querySelector<HTMLElement>("button") : inputRef.current)?.focus();
      return false;
    }
    try {
      const result = onCommit?.(draft);
      if (result instanceof Promise) {
        setPending(true);
        await result;
      }
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t.saveFailed;
      setPending(false);
      setError(message);
      announce(`${label}：${message}`, "assertive");
      return false;
    }
    setPending(false);
    if (valueProp === undefined) setOwn(draft);
    stop(focusBack);
    return true;
  };

  const { keyboardProps: displayKeys } = useKeyboard({
    onKeyDown(e) {
      if (e.key === "F2") start(value, "end");
      // 直接打字：用打的字替换原文字（输入法组合中的按键不算）。数字只接受能开头的字符；下拉不接受（用 Enter / 点击打开）
      else if (
        e.key.length === 1 &&
        e.key !== " " &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.nativeEvent.isComposing &&
        (type === "text" || (type === "number" && /[\d.,+-]/.test(e.key)))
      ) {
        e.preventDefault();
        if (type === "number") {
          typed.current = e.key;
          start("", "end");
        } else start(e.key, "end");
      } else e.continuePropagation();
    },
  });

  const { keyboardProps: inputKeys } = useKeyboard({
    onKeyDown(e) {
      if (e.nativeEvent.isComposing) return e.continuePropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        // 数字输入框在同一个按键事件里才解析文字：等它处理完再保存
        if (type === "number") setTimeout(() => void commit(true));
        else void commit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        stop(true);
      } else if (e.key === "Tab") {
        const grid = displayRef.current?.closest("[role=grid], [role=treegrid]") ?? inputRef.current?.closest("[role=grid], [role=treegrid]");
        if (!grid) return e.continuePropagation();
        // 表格里：保存后跳到同一个表格里的下一个（Shift 时上一个）可编辑字段并开始编辑
        e.preventDefault();
        const all = [...grid.querySelectorAll<HTMLElement>(".ui-inline-edit__display:not([data-disabled]), .ui-inline-edit__field")];
        const here = all.findIndex((el) => el.contains(inputRef.current));
        const next = all[here + (e.shiftKey ? -1 : 1)];
        const save = () => commit(!next);
        void (type === "number" ? new Promise<boolean>((resolve) => setTimeout(() => void save().then(resolve))) : save()).then((ok) => {
          if (!ok || !next) return;
          next.focus();
          next.click();
        });
      } else e.continuePropagation();
    },
  });

  if (editing && type === "number") {
    return (
      <div className={className ? `ui-inline-edit ${className}` : "ui-inline-edit"} data-size={size} data-editing="">
        <NumberField
          aria-label={label}
          ref={inputRef}
          size="sm"
          value={draft === "" ? NaN : Number(draft)}
          onChange={(n) => {
            setDraft(Number.isNaN(n) ? "" : String(n));
            if (error) setError(null);
          }}
          formatOptions={formatOptions}
          minValue={minValue}
          maxValue={maxValue}
          step={step}
          isInvalid={error != null}
          errorMessage={error ?? undefined}
          isReadOnly={pending}
          suffix={pending ? <Spinner size="sm" aria-label={t.saving} /> : undefined}
          className="ui-inline-edit__field"
          onKeyDown={inputKeys.onKeyDown}
          onBlur={() => setTimeout(() => void commit(false))}
        />
      </div>
    );
  }

  if (editing && type === "select") {
    return (
      <div className={className ? `ui-inline-edit ${className}` : "ui-inline-edit"} data-size={size} data-editing="">
        <Select
          ref={selectRef}
          aria-label={label}
          size="sm"
          items={options}
          selectedKey={draft === "" ? null : draft}
          defaultOpen
          isInvalid={error != null}
          errorMessage={error ?? undefined}
          isDisabled={pending}
          className="ui-inline-edit__field"
          onSelectionChange={(key) => {
            chose.current = true;
            setDraft(key == null ? "" : String(key));
            void commit(true);
          }}
          onOpenChange={(open) => {
            if (open || pending) return;
            // 没选就关了（Esc、点外面）：结束编辑。弹层有退出动画，等选项列表真的移除、React Aria 把焦点还回来以后再看焦点在哪：
            // 还在这里（Esc）时回到文字上，点了别处就不抢
            const list = document.activeElement?.closest("[role=listbox]");
            const settle = (frames: number) =>
              requestAnimationFrame(() => {
                if (chose.current) return;
                if (list?.isConnected && frames > 0) return settle(frames - 1);
                const active = document.activeElement;
                stop(!active || active === document.body || !!selectRef.current?.contains(active));
              });
            settle(60);
          }}
        >
          {(o: InlineEditOption) => <ListBoxItem id={o.id}>{o.label}</ListBoxItem>}
        </Select>
        {pending ? <Spinner size="sm" aria-label={t.saving} /> : null}
      </div>
    );
  }

  if (editing) {
    return (
      <div className={className ? `ui-inline-edit ${className}` : "ui-inline-edit"} data-size={size} data-editing="">
        <TextField
          aria-label={label}
          ref={inputRef}
          size="sm"
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (error) setError(null);
          }}
          isInvalid={error != null}
          errorMessage={error ?? undefined}
          isReadOnly={pending}
          suffix={pending ? <Spinner size="sm" aria-label={t.saving} /> : undefined}
          className="ui-inline-edit__field"
          onKeyDown={inputKeys.onKeyDown}
          // 焦点移到了别处（不是 Enter / Esc / Tab）：保存，不抢焦点
          onBlur={() => void commit(false)}
        />
      </div>
    );
  }

  function display(v: string) {
    if (type === "select") return options.find((o) => o.id === v)?.label ?? v;
    if (type === "number" && v !== "" && !Number.isNaN(Number(v))) return numberFormat.format(Number(v));
    return v;
  }

  return (
    <div className={className ? `ui-inline-edit ${className}` : "ui-inline-edit"} data-size={size} data-wrap={wrap || undefined} data-type={type}>
      <AriaButton ref={displayRef} className="ui-inline-edit__display" isDisabled={isDisabled} onPress={() => start(value, "select")} onFocus={syncFocusedCell} onKeyDown={displayKeys.onKeyDown}>
        <span className="ui-inline-edit__value" data-empty={value === "" || undefined}>
          {value === "" ? placeholder : renderValue ? renderValue(value) : display(value)}
        </span>
        {/* 读屏读成“shenql-main，编辑员工账号” */}
        <VisuallyHidden>{t.edit({ label: typeof label === "string" ? label : "" })}</VisuallyHidden>
        {isDisabled ? null : (
          <span className="ui-inline-edit__icon" aria-hidden="true">
            <PenIcon />
          </span>
        )}
      </AriaButton>
    </div>
  );
}
