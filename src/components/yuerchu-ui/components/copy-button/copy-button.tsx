"use client";

import type { Ref } from "react";
import { useCopy } from "../../lib/copy";
import { useStrings } from "../../lib/i18n";
import { AlertIcon, CheckIcon, CopyIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { copyButtonStrings } from "./copy-button.strings";
import "./copy-button.css";

/**
 * 用于一键复制密钥、链接或命令等文本，点击后短暂反馈复制结果并保持按钮宽度稳定。
 * 代码块内请直接使用 `CodeBlock` 自带的复制功能。
 *
 * @packageDocumentation
 * @category 操作
 * @status 实验中
 */

export interface CopyButtonProps {
  /** 待复制的文本内容，也可传入同步或异步函数在点击时动态获取。 */
  value: string | (() => string | Promise<string>);
  /**
   * 按钮展示文案与读屏名称，建议写明复制对象（如“复制 API Key”）。
   * @default "复制"（英文界面 "Copy"）
   */
  label?: string;
  /**
   * 仅显示图标并将 `label` 作为读屏名称，适合输入框旁等紧凑位置。
   * @default false
   */
  iconOnly?: boolean;
  /**
   * 按钮外观变体。
   * @default "secondary"
   */
  variant?: "secondary" | "ghost";
  /**
   * 按钮尺寸。
   * @default "sm"
   */
  size?: "sm" | "md";
  /** 复制成功后向读屏器播报的提示语。 @default "已复制"（英文界面 "Copied"） */
  copiedMessage?: string;
  /** 是否禁用按钮。 */
  isDisabled?: boolean;
  /** 复制结束后的回调，参数表示是否成功。 */
  onCopy?: (ok: boolean) => void;
  /** 自定义根元素类名。 */
  className?: string;
  /** 指向底层 `button` 元素的引用。 */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 基于 `Button` 实现的一键复制按钮，在非 HTTPS 环境下会自动降级为传统选区复制方案。
 * 按钮的无障碍名称始终保持为 `label`，复制成功或失败的结果通过实时区域播报，状态切换期间按钮宽度保持不变。
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
