"use client";

import type { Ref } from "react";
import { useCopy } from "../../lib/copy";
import { useStrings } from "../../lib/i18n";
import { AlertIcon, CheckIcon, CopyIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { copyButtonStrings } from "./copy-button.strings";
import "./copy-button.css";

/**
 * 复制按钮：复制 API Key、ID、命令这类一段文字。点了以后图标和文字变成"已复制"（失败时"复制失败"）1.6 秒，按钮宽度不变。
 * 代码块自带复制按钮（CodeBlock），不用再放。
 *
 * @packageDocumentation
 * @category 操作
 * @status 实验中
 */

export interface CopyButtonProps {
  /** 要复制的文字。也可以是函数（点的时候才取，可以返回 Promise，例如先向服务端要一个临时链接）。 */
  value: string | (() => string | Promise<string>);
  /**
   * 按钮文字，同时是读屏名称。写清复制的是什么，例如"复制 API Key"。
   * @default "复制"（英文界面 "Copy"）
   */
  label?: string;
  /**
   * 只显示图标（label 只用作读屏名称）。放在输入框、代码旁边这类空间小的地方。
   * @default false
   */
  iconOnly?: boolean;
  /**
   * 外观，同 Button。
   * @default "secondary"
   */
  variant?: "secondary" | "ghost";
  /**
   * 尺寸，同 Button。
   * @default "sm"
   */
  size?: "sm" | "md";
  /** 复制成功后读屏读出的话。 @default "已复制"（英文界面 "Copied"） */
  copiedMessage?: string;
  /** 是否禁用。 */
  isDisabled?: boolean;
  /** 复制完成后调用，参数是是否成功。 */
  onCopy?: (ok: boolean) => void;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向底层的 button 元素。 */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 复制按钮。基于 Button 和 lib/copy：不是 HTTPS 的页面也能复制；成功、失败都会播报（失败用 assertive）。
 * 三种状态的图标和文字叠放在同一个格子里，只切换显示哪一个：按钮宽度按最宽的那个算，状态变化时不跳动。
 * 读屏名称一直是 label，结果通过播报读出。
 */
export function CopyButton({
  value,
  label: labelProp,
  iconOnly = false,
  variant = "secondary",
  size = "sm",
  copiedMessage,
  isDisabled,
  onCopy,
  className,
  ref,
}: CopyButtonProps) {
  const { state, copy } = useCopy();
  const t = useStrings(copyButtonStrings);
  const label = labelProp === undefined ? t.copy : labelProp;
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      isDisabled={isDisabled}
      aria-label={label}
      className={className ? `ui-copy-button ${className}` : "ui-copy-button"}
      data-state={state}
      icon={
        <span className="ui-copy-button__icons" aria-hidden="true">
          <CopyIcon data-show={state === "idle" || undefined} />
          <CheckIcon data-show={state === "copied" || undefined} />
          <AlertIcon data-show={state === "error" || undefined} />
        </span>
      }
      onPress={async () => {
        // 先复制再回调：写成 onCopy?.(await copy(…)) 的话，没传 onCopy 时整个参数都不会执行
        const ok = await copy(value, { done: copiedMessage ?? t.copied });
        onCopy?.(ok);
      }}
    >
      {iconOnly ? undefined : (
        <span className="ui-copy-button__labels" aria-hidden="true">
          <span data-show={state === "idle" || undefined}>{label}</span>
          <span data-show={state === "copied" || undefined}>{t.copied}</span>
          <span data-show={state === "error" || undefined}>{t.failed}</span>
        </span>
      )}
    </Button>
  );
}
