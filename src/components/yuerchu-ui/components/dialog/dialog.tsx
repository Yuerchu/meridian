"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DialogProps as AriaDialogProps, ModalOverlayProps } from "react-aria-components";
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { dialogStrings } from "./dialog.strings";
import "./dialog.css";

export { DialogTrigger } from "react-aria-components";

/**
 * 对话框：打断当前流程、需要用户专注处理的内容，例如编辑表单、确认删除。
 * 小块内容用 Popover；不需要打断的提示用 Toast。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface DialogProps extends Omit<ModalOverlayProps, "children" | "className" | "style"> {
  /** 标题，必填。读屏打开对话框时会先读标题。（不叫 title：避免和会弹出浏览器原生提示的 title 属性混淆） */
  heading: ReactNode;
  /** 标题下方的说明，读屏会在标题之后读出。 */
  description?: ReactNode;
  /** 内容。写成函数时可以拿到 close，用来在按钮里关闭对话框。 */
  children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  /**
   * 宽度。sm 400px 用于简短表单；md 520px；lg 720px 用于内容较多的编辑。小屏上都是屏幕宽度减去边距。
   * xl 是预览用的大尺寸（1200px 宽、几乎占满高度，内容区撑满）；full 铺满整个窗口（没有边距和圆角），用于全屏预览。
   * @default "md"
   */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** 对话框根元素上的类名。 */
  className?: string;
}

/**
 * 对话框。放在 DialogTrigger 里，紧跟在触发按钮后面；也可以用 isOpen / onOpenChange 受控。
 * 基于 React Aria Modal + Dialog：焦点锁在对话框内，关闭后回到触发按钮；页面滚动被锁住；背后的内容对读屏隐藏。
 * 点遮罩或按 Esc 关闭（isDismissable 默认 true）。
 *
 * @promote isOpen, defaultOpen, onOpenChange, isDismissable, isKeyboardDismissDisabled
 */
export function Dialog({ heading, description, children, size = "md", isDismissable = true, className, ...props }: DialogProps) {
  const t = useStrings(dialogStrings);
  const descriptionId = useId();
  return (
    <ModalOverlay {...props} isDismissable={isDismissable} className="ui-dialog-overlay" data-size={size}>
      <Modal className={className ? `ui-dialog ${className}` : "ui-dialog"} data-size={size}>
        <AriaDialog className="ui-dialog__content" aria-describedby={description ? descriptionId : undefined}>
          {({ close }) => (
            <>
              <div className="ui-dialog__header">
                <Heading slot="title" className="ui-dialog__title">
                  {heading}
                </Heading>
                {description ? (
                  <p id={descriptionId} className="ui-dialog__description">
                    {description}
                  </p>
                ) : null}
              </div>
              <div className="ui-dialog__body">{typeof children === "function" ? children({ close }) : children}</div>
              {/* 视觉上在右上角，DOM 里放最后：Tab 先进入内容，最后才到关闭按钮 */}
              <Button className="ui-dialog__close" variant="ghost" size="sm" icon={<XIcon />} aria-label={t.close} onPress={close} />
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export interface DialogFooterProps {
  /** 操作按钮。主要操作放最右边。 */
  children?: ReactNode;
}

/**
 * 对话框底部的按钮区：靠右排列，主要操作在最右边。窄屏上纵向排列，主要操作在最上面。
 */
export function DialogFooter({ children }: DialogFooterProps) {
  return <div className="ui-dialog__footer">{children}</div>;
}

export interface AlertDialogProps extends Omit<ModalOverlayProps, "children" | "className" | "style" | "isDismissable"> {
  /** 标题：直接问问题，例如"删除项目 foxline？"。 */
  heading: ReactNode;
  /** 说明后果，例如"项目里的 32 个文件会被永久删除，无法恢复。"。 */
  description?: ReactNode;
  /** 确认按钮文字，写清动作（"删除项目"），不要写"确定"。 */
  confirmLabel: string;
  /**
   * 取消按钮文字。
   * @default "取消"（英文界面 "Cancel"）
   */
  cancelLabel?: string;
  /**
   * 语气。danger 时确认按钮用 destructive 样式。
   * @default "default"
   */
  tone?: "default" | "danger";
  /**
   * 点确认时调用。返回 Promise 时，确认按钮进入等待状态，完成后关闭。
   * 抛出错误（或 Promise 失败）时保持打开，错误交给 reportError（控制台和全局错误监控能看到）；
   * 给用户的错误提示由 onConfirm 自己负责，例如用 Toast。
   */
  onConfirm?: () => void | Promise<void>;
}

/**
 * 确认对话框（role="alertdialog"）：执行重要或不可撤销的操作前确认。
 * 点遮罩不会关闭，按 Esc 等于取消。打开时焦点在对话框本身（读屏先读标题和说明），误按 Enter 不会直接执行；Tab 先到"取消"。
 *
 * @promote isOpen, defaultOpen, onOpenChange
 */
export function AlertDialog({
  heading,
  description,
  confirmLabel,
  cancelLabel: cancelLabelProp,
  tone = "default",
  onConfirm,
  ...props
}: AlertDialogProps) {
  const t = useStrings(dialogStrings);
  const cancelLabel = cancelLabelProp === undefined ? t.cancel : cancelLabelProp;
  const descriptionId = useId();
  const [isPending, setPending] = useState(false);
  return (
    // 确认进行中不能用 Esc 关掉：关掉就看不到结果（成功或失败）了
    <ModalOverlay
      {...props}
      isDismissable={false}
      isKeyboardDismissDisabled={isPending || props.isKeyboardDismissDisabled}
      className="ui-dialog-overlay"
    >
      <Modal className="ui-dialog" data-size="sm" data-tone={tone}>
        <AriaDialog role="alertdialog" className="ui-dialog__content" aria-describedby={description ? descriptionId : undefined}>
          {({ close }) => (
            <>
              <div className="ui-dialog__header">
                <Heading slot="title" className="ui-dialog__title">
                  {heading}
                </Heading>
                {description ? (
                  <p id={descriptionId} className="ui-dialog__description">
                    {description}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="secondary" onPress={close} isDisabled={isPending}>
                  {cancelLabel}
                </Button>
                <Button
                  variant={tone === "danger" ? "destructive" : "primary"}
                  isPending={isPending}
                  onPress={async () => {
                    setPending(true);
                    try {
                      await onConfirm?.();
                      close();
                    } catch (error) {
                      reportError(error);
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {confirmLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type ConfirmOptions = Pick<AlertDialogProps, "heading" | "description" | "confirmLabel" | "cancelLabel" | "tone" | "onConfirm">;

/**
 * 用一行 await 弹出确认对话框：`const ok = await confirm({ heading, confirmLabel })`，确认得到 true，取消（或 Esc）得到 false。
 * 返回 [confirm, dialog]：dialog 要放进 JSX 里（放在哪都行）。对话框就是 AlertDialog，onConfirm 返回 Promise 时等它完成再关闭、
 * 失败时保持打开。上一个还没答又调用 confirm 时，上一个按取消处理。组件卸载时没答的也按取消处理。
 * 确认按钮写清动作（"删除项目"），不要写"确定"。
 */
export function useConfirm(): [confirm: (options: ConfirmOptions) => Promise<boolean>, dialog: ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [isOpen, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmed = useRef(false);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  useEffect(() => () => settle(false), [settle]);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        settle(false);
        resolver.current = resolve;
        confirmed.current = false;
        setOptions(next);
        setOpen(true);
      }),
    [settle],
  );

  // 关闭后保留 options，让退场动画播完
  const dialog = options ? (
    <AlertDialog
      {...options}
      isOpen={isOpen}
      onConfirm={async () => {
        await options.onConfirm?.();
        confirmed.current = true;
      }}
      onOpenChange={(open) => {
        if (open) return;
        setOpen(false);
        settle(confirmed.current);
      }}
    />
  ) : null;

  return [confirm, dialog];
}
