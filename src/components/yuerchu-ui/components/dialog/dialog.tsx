"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ModalOverlayProps } from "react-aria-components";
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { XIcon } from "../../lib/icons";
import { TextBlock } from "../../lib/text-block";
import { Button } from "../button/button";
import { dialogStrings } from "./dialog.strings";
import "./dialog.css";

export { DialogTrigger } from "react-aria-components";

/**
 * 居中弹出的模态对话框，用于承载需要用户专注处理的表单编辑或重要操作确认。
 * 轻量关联弹层请使用 Popover，非阻塞式提示请使用 Toast。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface DialogProps extends Omit<ModalOverlayProps, "children" | "className" | "style"> {
  /** 对话框标题（必填），打开时读屏器会优先播报；为避免与原生 `title` 悬停提示冲突而命名为 `heading`。 */
  heading: ReactNode;
  /** 标题下方的辅助说明，读屏器会在标题之后播报；传入纯文本时渲染为段落，传入列表等复杂元素时自动改用 `div` 容器。 */
  description?: ReactNode;
  /** 对话框主体内容，也可传入渲染函数接收 `close` 方法用于手动关闭。 */
  children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  /**
   * 宽度尺寸。`sm`（400px）适合简短表单，`md`（520px）为默认尺寸，`lg`（720px）适合字段较多的编辑场景，小屏上会自动适配为视口宽度减去边距；
   * `xl`（1200px 宽、接近全屏高度）与 `full`（铺满窗口、无边距与圆角）适用于文档或媒体预览。
   * @default "md"
   */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** 自定义对话框根元素类名。 */
  className?: string;
}

/**
 * 可配合 `DialogTrigger` 使用，或通过 `isOpen` 与 `onOpenChange` 受控显示。
 * 打开时锁定页面滚动、隐藏背景内容并将焦点保持在对话框内，关闭后自动将焦点归还触发按钮。
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
                  <TextBlock id={descriptionId} className="ui-dialog__description">
                    {description}
                  </TextBlock>
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
  /** 底部操作按钮，主要操作建议放在最右侧。 */
  children?: ReactNode;
}

/**
 * 对话框底部操作栏：桌面端靠右排列且主要操作在最右侧，窄屏下转为纵向排列并将主要操作置于上方。
 */
export function DialogFooter({ children }: DialogFooterProps) {
  return <div className="ui-dialog__footer">{children}</div>;
}

export interface AlertDialogProps extends Omit<ModalOverlayProps, "children" | "className" | "style" | "isDismissable"> {
  /** 确认标题，建议直接提出明确问题，例如“删除工作区‘星云看板’？”。 */
  heading: ReactNode;
  /** 说明操作后果，例如“项目里的 32 个文件将被永久删除，无法恢复。”；需要列出受影响条目时可传入包含列表的 JSX。 */
  description?: ReactNode;
  /** 确认按钮文案，建议使用具体动词（如“删除项目”），避免笼统的“确定”。 */
  confirmLabel: string;
  /**
   * 取消按钮文案。
   * @default "取消"（英文界面 "Cancel"）
   */
  cancelLabel?: string;
  /**
   * 语气变体；设为 danger 时确认按钮采用 destructive 外观。
   * @default "default"
   */
  tone?: "default" | "danger";
  /**
   * 点击确认时触发的回调；返回 Promise 时确认按钮进入等待状态并在完成后关闭，
   * 若抛出异常则保持打开并上报至 `reportError`（向用户的错误提示可通过 Toast 等自行展示）。
   */
  onConfirm?: () => void | Promise<void>;
}

/**
 * 确认对话框（`role="alertdialog"`），用于执行重要或不可撤销操作前的二次确认。
 * 点击遮罩不会关闭，按 Esc 等同取消；打开时默认聚焦对话框自身，误按 Enter 不会直接执行，按 Tab 会先移至“取消”按钮。
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
                  <TextBlock id={descriptionId} className="ui-dialog__description">
                    {description}
                  </TextBlock>
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
 * 命令式异步确认 Hook：`const ok = await confirm({ heading, confirmLabel })`，确认返回 `true`，取消或按 Esc 返回 `false`。
 * 返回 `[confirm, dialog]`，需将 `dialog` 渲染到组件树中；若传入异步 `onConfirm`，会等待 Promise 完成后关闭，失败则保持打开。
 * 连续发起新确认或组件卸载时，未决的前一次确认会自动按取消结算。
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
