"use client";

import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { TextFieldProps as AriaTextFieldProps, ValidationResult } from "react-aria-components";
import { Button as AriaButton, TextField as AriaTextField } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { withUiClass } from "../../lib/class-name";
import { EyeIcon, EyeOffIcon } from "../../lib/icons";
import { Description, FieldError, Label } from "../field/field";
import { Input } from "../text-field/text-field";
import { passwordFieldStrings } from "./password-field.strings";
import "./password-field.css";

/**
 * 用于密码和敏感口令输入，基于原生密码输入框提供显隐切换、大写锁定提醒以及“已保存密码”占位状态。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface PasswordFieldProps
  extends Omit<AriaTextFieldProps, "children" | "type" | "autoComplete" | "inputMode" | "pattern"> {
  /** 可见标签。若不显示可见标签，需传入 `aria-label`。 */
  label?: ReactNode;
  /** 输入框下方的说明文字（如密码复杂度要求），读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息，可传入固定文案或根据校验结果动态返回。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字，密码输入框一般无需设置。 */
  placeholder?: string;
  /**
   * 密码用途（必填）。登录场景传入 `current-password`，注册或修改密码传入 `new-password`，以便密码管理器正确填充或提示保存。
   */
  autoComplete: "current-password" | "new-password";
  /**
   * 密码生成规则，供 Safari 在 `autoComplete="new-password"` 时自动生成强密码，如 `minlength: 12; required: lower; required: upper; required: digit;`。
   */
  passwordRules?: string;
  /**
   * 控件尺寸。触屏设备上会自动适配最小触控高度与 16px 字号。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * 是否展示“已保存密码”占位状态（用于记住密码但不自动登录）。开启后输入框值为空、仅渲染占位圆点并隐藏显隐切换按钮，同时暂停必填与自定义校验；
   * 用户开始输入、按退格或触发自动填充时，会丢弃该状态并调用 `onSavedPasswordDiscard`。
   */
  hasSavedPassword?: boolean;
  /** 已保存密码状态被用户输入或退格清除时触发，可用于同步丢弃业务侧持有的凭证。 */
  onSavedPasswordDiscard?: () => void;
  /** 指向底层 `input` 元素的引用。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 密码输入框，基于原生 `type="password"` 实现输入法屏蔽、读屏掩码与密码管理器兼容；
 * 切换明文时保持关闭拼写检查与自动更正，并在表单提交前自动切回密文。
 *
 * @promote value, defaultValue, onChange, isRequired, isInvalid, isDisabled, isReadOnly, validate, minLength, name
 */
export function PasswordField({
  label,
  description,
  errorMessage,
  placeholder,
  autoComplete,
  passwordRules,
  size = "md",
  hasSavedPassword = false,
  onSavedPasswordDiscard,
  ref,
  className,
  isRequired,
  validate,
  onChange,
  ...props
}: PasswordFieldProps) {
  const t = useStrings(passwordFieldStrings);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedHintId = useId();
  const [isRevealed, setRevealed] = useState(false);
  const [isCapsLock, setCapsLock] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(props.defaultValue ?? "");
  const [isSavedDiscarded, setSavedDiscarded] = useState(false);
  const value = props.value ?? uncontrolledValue;
  const isSaved = hasSavedPassword && !isSavedDiscarded && value === "";

  // 业务代码重新给出保存的密码（例如切换账号）时，恢复显示
  useEffect(() => {
    if (hasSavedPassword) setSavedDiscarded(false);
  }, [hasSavedPassword]);

  const discardSaved = () => {
    if (!isSaved) return;
    setSavedDiscarded(true);
    onSavedPasswordDiscard?.();
  };

  // 表单提交前切回 password：部分浏览器和密码管理器只在密码类型下才提示保存。
  // 直接改 DOM，保证在提交这一刻已经是 password；再同步 state。
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const hide = () => {
      if (inputRef.current) inputRef.current.type = "password";
      setRevealed(false);
    };
    form.addEventListener("submit", hide, true);
    return () => form.removeEventListener("submit", hide, true);
  }, []);

  const setRefs = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === "function") return ref(el);
    if (ref) ref.current = el;
  };

  const checkCapsLock = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));

  return (
    <AriaTextField
      {...props}
      // 已保存密码时值是空的：暂停必填和自定义校验，否则提交会被拦下
      isRequired={isRequired && !isSaved}
      validate={validate && ((v) => (isSaved ? null : validate(v)))}
      onChange={(v) => {
        setUncontrolledValue(v);
        if (v !== "") discardSaved();
        onChange?.(v);
      }}
      aria-describedby={[props["aria-describedby"], isSaved ? savedHintId : undefined].filter(Boolean).join(" ") || undefined}
      className={withUiClass("ui-text-field ui-password-field", className)}
      data-size={size}
      data-revealed={isRevealed || undefined}
      data-saved={isSaved || undefined}
    >
      {label ? <Label>{label}</Label> : null}
      <div className="ui-text-field__control">
        <Input
          ref={setRefs}
          type={isRevealed ? "text" : "password"}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={isSaved ? undefined : placeholder}
          {...(passwordRules ? { passwordrules: passwordRules } : null)}
          onKeyDown={(e) => {
            checkCapsLock(e);
            if (e.key === "Backspace" || e.key === "Delete") discardSaved();
          }}
          onKeyUp={checkCapsLock}
          onBlur={() => setCapsLock(false)}
        />
        {isSaved ? (
          <>
            <span className="ui-password-field__saved" aria-hidden="true">
              ••••••••
            </span>
            <span id={savedHintId} className="ui-password-field__saved-hint">
              {t.saved}
            </span>
          </>
        ) : (
          <AriaButton
            className="ui-password-field__toggle"
            aria-label={isRevealed ? t.hide : t.show}
            isDisabled={props.isDisabled}
            onPress={(e) => {
              const input = inputRef.current;
              // 鼠标和触屏点按后把焦点还给输入框，光标位置不变；键盘操作时焦点留在按钮上
              if (!input || e.pointerType === "keyboard" || e.pointerType === "virtual") return setRevealed((v) => !v);
              const { selectionStart, selectionEnd } = input;
              flushSync(() => setRevealed((v) => !v));
              input.focus();
              input.setSelectionRange(selectionStart, selectionEnd);
            }}
          >
            {/* 两个图标叠在一起交叉淡化；状态由根元素的 data-revealed 决定 */}
            <span className="ui-password-field__icon" data-icon="show">
              <EyeIcon />
            </span>
            <span className="ui-password-field__icon" data-icon="hide">
              <EyeOffIcon />
            </span>
          </AriaButton>
        )}
      </div>
      <p className="ui-password-field__caps" aria-live="polite">
        {isCapsLock ? t.capsLock : null}
      </p>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  );
}
