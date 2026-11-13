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
 * 密码输入框：原生 type="password"，带显示 / 隐藏切换和大写锁定提示。
 * 验证码用 OTPField；普通文字用 TextField。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface PasswordFieldProps
  extends Omit<AriaTextFieldProps, "children" | "type" | "autoComplete" | "inputMode" | "pattern"> {
  /** 可见标签。每个输入框都必须有标签；确实不显示标签时，改写 aria-label。 */
  label?: ReactNode;
  /** 输入框下方的说明文字，例如密码规则。读屏会在聚焦时一并读出。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。可以是固定文字，也可以根据校验结果返回文字。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 占位文字。密码框一般不需要。 */
  placeholder?: string;
  /**
   * 用途，必填。登录写 current-password，注册和修改密码写 new-password。
   * 写错的话，密码管理器不会自动填充，也不会提示保存或生成密码。
   */
  autoComplete: "current-password" | "new-password";
  /**
   * 密码规则，写给 Safari 生成强密码用，例如 "minlength: 12; required: lower; required: upper; required: digit;"。
   * 只在 autoComplete="new-password" 时有意义。格式见 Apple 的 Password Rules Validation Tool。
   */
  passwordRules?: string;
  /**
   * 尺寸，对应控件高度 --control-sm / --control-md / --control-lg。触屏设备上会自动加高，字号也会变成 16px。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * 已保存密码（"记住密码但不自动登录"）。输入框的值保持为空，只画出圆点让它看起来已填写，并隐藏显示密码按钮；
   * 必填和自定义校验暂停。用户开始输入、按退格或被自动填充时，保存的密码作废并调用 onSavedPasswordDiscard。
   * 提交时值为空，由业务代码改用自己持有的凭证（例如长期 token）。不要在网页里保存真密码。
   */
  hasSavedPassword?: boolean;
  /** 保存的密码被用户替换或清除时调用。业务代码在这里丢弃保存的凭证。 */
  onSavedPasswordDiscard?: () => void;
  /** 指向底层的 input 元素。 */
  ref?: Ref<HTMLInputElement>;
}

/**
 * 密码框。始终是原生 type="password"：输入法关闭、读屏不念字符、密码管理器能识别。
 * "显示密码"只切换 type，并固定关闭拼写检查（否则明文会被发到云端拼写检查）；表单提交前自动切回隐藏。
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
