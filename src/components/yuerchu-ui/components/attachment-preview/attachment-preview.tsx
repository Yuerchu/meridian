"use client";

import type { ReactNode, Ref } from "react";
import { Children } from "react";
import { Button as AriaButton } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { useFormat } from "../../lib/format";
import { CircleAlertIcon, XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { Dialog, DialogTrigger } from "../dialog/dialog";
import { FileIcon } from "../file-icon/file-icon";
import { Link } from "../link/link";
import { ProgressBar } from "../progress-bar/progress-bar";
import { attachmentPreviewStrings } from "./attachment-preview.strings";
import "./attachment-preview.css";

/**
 * 展示消息或评论中的图片缩略图与文件卡片，支持点击查看大图、显示上传进度或失败原因以及移除附件。
 *
 * @packageDocumentation
 * @category AI
 * @status 实验中
 */

export interface AttachmentPreviewProps {
  /** 文件名，同时用于匹配文件类型图标。 */
  name: string;
  /** 文件大小（字节），在已完成状态时格式化显示。 */
  size?: number;
  /** 图片缩略图地址；传入后渲染为可点击查看大图按钮的缩略图。 */
  imageUrl?: string;
  /** 文件打开或下载地址；非图片附件在已完成状态时将文件名渲染为链接。 */
  href?: string;
  /** 附件上传状态；未传入表示已完成。 */
  status?: "uploading" | "error";
  /** 上传进度（0～1，仅在上传中有效）；未传入时进度条显示为不确定状态。 */
  progress?: number;
  /** 上传失败的提示文本，例如“超过 20 MB”。 */
  error?: string;
  /** 移除按钮点击回调；传入后显示移除按钮。 */
  onRemove?: () => void;
  /** 自定义根元素类名。 */
  className?: string;
  /** 根元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 附件卡片。图片缩略图可点击打开大图对话框，移除按钮的读屏名称包含对应文件名。
 */
export function AttachmentPreview({ name, size, imageUrl, href, status, progress, error, onRemove, className, ref }: AttachmentPreviewProps) {
  const t = useStrings(attachmentPreviewStrings);
  const f = useFormat();
  const meta =
    status === "uploading"
      ? t.uploading({ percent: progress !== undefined ? f.percent(progress) : undefined })
      : status === "error"
        ? (error ?? t.failed)
        : size !== undefined
          ? f.bytes(size)
          : null;
  return (
    <div ref={ref} className={className ? `ui-attachment ${className}` : "ui-attachment"} data-status={status}>
      {imageUrl ? (
        <DialogTrigger>
          <AriaButton className="ui-attachment__thumb" aria-label={t.view({ name })}>
            <img src={imageUrl} alt="" />
          </AriaButton>
          <Dialog heading={name} size="lg">
            <img className="ui-attachment__full" src={imageUrl} alt={name} />
          </Dialog>
        </DialogTrigger>
      ) : (
        <span className="ui-attachment__icon">
          <FileIcon name={name} size="lg" />
        </span>
      )}
      <span className="ui-attachment__body">
        {href && status === undefined ? (
          <Link href={href} variant="standalone" className="ui-attachment__name">
            {name}
          </Link>
        ) : (
          <span className="ui-attachment__name">{name}</span>
        )}
        {meta ? (
          <span className="ui-attachment__meta">
            {status === "error" ? <CircleAlertIcon aria-hidden="true" /> : null}
            {meta}
          </span>
        ) : null}
        {status === "uploading" ? (
          <ProgressBar
            aria-label={t.progress({ name })}
            value={progress === undefined ? undefined : progress * 100}
            isIndeterminate={progress === undefined}
            showValueLabel={false}
            className="ui-attachment__progress"
          />
        ) : null}
      </span>
      {onRemove ? <Button className="ui-attachment__remove" variant="ghost" size="sm" icon={<XIcon />} aria-label={t.remove({ name })} onPress={onRemove} /> : null}
    </div>
  );
}

export interface AttachmentListProps {
  /** 附件卡片子项（AttachmentPreview）。 */
  children?: ReactNode;
  /**
   * 列表的读屏名称。
   * @default "附件"（英文界面 "Attachments"）
   */
  "aria-label"?: string;
  /** 自定义根元素类名。 */
  className?: string;
}

/** 横向自动换行的具名附件列表容器。 */
export function AttachmentList({ children, "aria-label": ariaLabelProp, className }: AttachmentListProps) {
  const t = useStrings(attachmentPreviewStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.list : ariaLabelProp;
  return (
    <ul aria-label={ariaLabel} className={className ? `ui-attachment-list ${className}` : "ui-attachment-list"}>
      {Children.map(children, (child) => (child ? <li>{child}</li> : null))}
    </ul>
  );
}
