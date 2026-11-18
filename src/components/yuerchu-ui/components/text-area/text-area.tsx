"use client";

import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { mergeRefs, useMove, VisuallyHidden } from "react-aria";
import type { TextFieldProps as AriaTextFieldProps, ValidationResult } from "react-aria-components";
import { TextArea as AriaTextArea, TextField as AriaTextField } from "react-aria-components";
import { announce } from "../../lib/announce";
import { withUiClass } from "../../lib/class-name";
import { useStrings } from "../../lib/i18n";
import { splitWords } from "../../lib/words";
import { Description, FieldError, Label } from "../field/field";
import "../text-field/text-field.css";
import { textAreaStrings } from "./text-area.strings";
import "./text-area.css";

/**
 * 多行文本输入框：备注、描述、反馈这类可能写好几行的内容。高度随内容增长。
 * 单行内容用 TextField；富文本用编辑器。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface TextAreaProps extends Omit<AriaTextFieldProps, "children" | "type" | "inputMode" | "pattern"> {
  /** 可见标签。每个输入框都必须有标签；确实不显示标签时，改写 aria-label。 */
  label?: ReactNode;
  /** 输入框下方的说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字，只用来举例，不能代替标签或说明。 */
  placeholder?: string;
  /**
   * 最少显示几行。
   * @default 3
   */
  rows?: number;
  /** 最多长到几行，超出后在框里滚动。不写时一直增长。 */
  maxRows?: number;
  /** 指向底层的 textarea 元素。 */
  ref?: Ref<HTMLTextAreaElement>;
  /**
   * 行内补全：停顿一会儿、光标在末尾时调用，返回接在后面的续写（灰色显示），没有建议时返回 null 或空字符串。
   * 用户继续输入、离开输入框时 signal 会中止。Tab 接受全部，Ctrl + → 接受一个词，Esc 取消。
   */
  getCompletion?: (text: string, signal: AbortSignal) => Promise<string | null | undefined>;
  /**
   * 停顿多久（毫秒）后取补全。
   * @default 500
   */
  completionDelay?: number;
}

/**
 * 多行输入框。基于 React Aria TextField + TextArea：标签、说明、错误信息自动关联。
 * 写了 maxLength 时右下角显示"已输入 / 上限"，并通过 aria-describedby 读出。
 *
 * @promote value, defaultValue, onChange, maxLength, isRequired, isInvalid, isDisabled, isReadOnly, validate, name, autoComplete
 */
export function TextArea({
  label,
  description,
  errorMessage,
  placeholder,
  rows = 3,
  maxRows,
  ref,
  className,
  onChange,
  getCompletion,
  completionDelay = 500,
  ...props
}: TextAreaProps) {
  const t = useStrings(textAreaStrings);
  const counterId = useId();
  const hintId = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState(props.defaultValue ?? "");
  const value = props.value ?? uncontrolledValue;
  const length = value.length;
  const max = props.maxLength;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const change = (v: string) => {
    setUncontrolledValue(v);
    onChange?.(v);
  };
  const completion = useCompletion({ value, inputRef, getCompletion, delay: completionDelay, onAccept: change });
  const style = { "--ui-text-area-rows": rows, ...(maxRows ? { "--ui-text-area-max-rows": maxRows } : null) } as CSSProperties;

  return (
    <AriaTextField
      {...props}
      // 有补全时受控：接受建议要改值
      {...(getCompletion ? { value } : null)}
      onChange={(v) => {
        completion.onInput(v);
        change(v);
      }}
      aria-describedby={[props["aria-describedby"], max ? counterId : undefined, completion.suggestion ? hintId : undefined].filter(Boolean).join(" ") || undefined}
      className={withUiClass("ui-text-area", className)}
      style={style}
    >
      {label ? <Label>{label}</Label> : null}
      <div className="ui-text-area__control">
        <AriaTextArea
          ref={mergeRefs(ref, inputRef)}
          rows={rows}
          placeholder={placeholder}
          className="ui-input ui-text-area__input"
          {...(getCompletion ? { onKeyDown: completion.onKeyDown, onBlur: completion.dismiss, onScroll: completion.syncScroll, onSelect: completion.onSelect } : null)}
        />
        {completion.suggestion ? (
          // 和输入框同样的字体、内边距、换行：前面的文字透明，只露出灰色的续写
          <div ref={completion.mirrorRef} className="ui-text-area__ghost" aria-hidden="true">
            <span className="ui-text-area__ghost-prefix">{value}</span>
            <span className="ui-text-area__ghost-text">{completion.suggestion}</span>
            <kbd className="ui-text-area__ghost-key">Tab</kbd>
          </div>
        ) : null}
        {completion.suggestion ? (
          <VisuallyHidden id={hintId}>{t.hint({ suggestion: completion.suggestion })}</VisuallyHidden>
        ) : null}
        {props.isDisabled || props.isReadOnly ? null : <ResizeGrip inputRef={inputRef} />}
      </div>
      {description || max ? (
        <div className="ui-text-area__footer">
          {description ? <Description>{description}</Description> : <span />}
          {max ? (
            <span id={counterId} className="ui-text-area__counter" data-full={length >= max || undefined}>
              {length} / {max}
            </span>
          ) : null}
        </div>
      ) : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  );
}

interface CompletionOptions {
  value: string;
  inputRef: { current: HTMLTextAreaElement | null };
  getCompletion?: TextAreaProps["getCompletion"];
  delay: number;
  onAccept: (value: string) => void;
}

/** 行内补全：停顿后取建议、显示、Tab / Ctrl + → / Esc；继续输入时打的字和建议开头一样就留着剩下的 */
function useCompletion({ value, inputRef, getCompletion, delay, onAccept }: CompletionOptions) {
  const t = useStrings(textAreaStrings);
  const [suggestion, setSuggestion] = useState("");
  const mirrorRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(value);
  latest.current = value;

  const cancel = () => {
    clearTimeout(timer.current);
    request.current?.abort();
    request.current = null;
  };
  useEffect(() => cancel, []);

  const caretAtEnd = () => {
    const el = inputRef.current;
    return Boolean(el && el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
  };

  const schedule = (text: string) => {
    cancel();
    if (!getCompletion || !text.trim()) return;
    timer.current = setTimeout(() => {
      if (!caretAtEnd() || document.activeElement !== inputRef.current) return;
      const controller = new AbortController();
      request.current = controller;
      getCompletion(text, controller.signal).then(
        (result) => {
          if (controller.signal.aborted || latest.current !== text || !result) return;
          setSuggestion(result);
          announce(t.announce({ suggestion: result.trim() }));
        },
        () => {},
      );
    }, delay);
  };

  const onInput = (next: string) => {
    if (!getCompletion) return;
    const prev = latest.current;
    // 照着建议打字：建议往后缩，不重新请求
    if (suggestion && next.startsWith(prev) && suggestion.startsWith(next.slice(prev.length)) && next.length > prev.length) {
      const remaining = suggestion.slice(next.length - prev.length);
      setSuggestion(remaining);
      if (remaining) return cancel();
    } else setSuggestion("");
    schedule(next);
  };

  const accept = (part: string) => {
    const next = latest.current + part;
    const remaining = suggestion.slice(part.length);
    setSuggestion(remaining);
    onAccept(next);
    if (!remaining) schedule(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestion || e.nativeEvent.isComposing) return;
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      accept(suggestion);
    } else if (e.key === "ArrowRight" && (e.ctrlKey || e.altKey) && !e.shiftKey && caretAtEnd()) {
      e.preventDefault();
      // 一个词，连同它前面的空白
      const words = splitWords(suggestion);
      const first = words[0] && /^\s+$/.test(words[0]) ? words.slice(0, 2).join("") : (words[0] ?? "");
      accept(first);
    } else if (e.key === "Escape") {
      // 只收起建议，不让外层（对话框）也关掉
      e.preventDefault();
      e.stopPropagation();
      cancel();
      setSuggestion("");
    }
  };

  // 光标离开末尾（点到中间、方向键）时收起
  const onSelect = () => {
    if (suggestion && !caretAtEnd()) {
      cancel();
      setSuggestion("");
    }
  };
  const dismiss = () => {
    cancel();
    setSuggestion("");
  };
  const syncScroll = () => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollTop = inputRef.current.scrollTop;
  };
  // 镜像跟着输入框滚动（接受建议时改了值，浏览器会把光标放到末尾）
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (suggestion && el && document.activeElement === el) syncScroll();
  });

  return { suggestion, mirrorRef, onInput, onKeyDown, onSelect, dismiss, syncScroll };
}

/**
 * 右下角拖动改高度的把手。不用浏览器自带的（resize: vertical）：自带的贴着边框画，圆角处压在描边上，样子也改不了；
 * 这个画在框里面，离边框留 --space-1。只改高度，范围由 CSS 的 min-height / max-height 限制。只响应指针（装饰，对读屏隐藏）
 */
function ResizeGrip({ inputRef }: { inputRef: { current: HTMLTextAreaElement | null } }) {
  const start = useRef(0);
  const moved = useRef(0);
  const { moveProps } = useMove({
    onMoveStart(e) {
      if (e.pointerType === "keyboard" || !inputRef.current) return;
      start.current = inputRef.current.getBoundingClientRect().height;
      moved.current = 0;
    },
    onMove(e) {
      const input = inputRef.current;
      if (e.pointerType === "keyboard" || !input) return;
      moved.current += e.deltaY;
      input.style.height = `${Math.max(0, start.current + moved.current)}px`;
    },
  });
  return <span className="ui-text-area__grip" aria-hidden="true" {...moveProps} />;
}
