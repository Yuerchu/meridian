"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useStrings } from "../../lib/i18n";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { alertStrings } from "./alert.strings";
import "./alert.css";

/**
 * 用于在页面或区域内展示需要注意的持久性说明、状态提示或整体错误。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

const ICONS = {
  neutral: <InfoIcon />,
  success: <CircleCheckIcon />,
  warning: <TriangleAlertIcon />,
  danger: <CircleAlertIcon />,
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title" | "role"> {
  /** 提示标题，用简短的一句话概括当前情况。 */
  heading?: ReactNode;
  /** 提示正文，用于补充说明原因或建议操作。 */
  children?: ReactNode;
  /**
   * 提示语气，决定底色与图标；`neutral` 为中性灰。
   * @default "neutral"
   */
  tone?: "neutral" | "success" | "warning" | "danger";
  /** 放置在正文下方的操作按钮，例如“立即续签”。 */
  actions?: ReactNode;
  /** 关闭回调。传入后会在右上角渲染关闭按钮，点击时触发，由外部控制提示框的显示状态。 */
  onDismiss?: () => void;
  /**
   * 出现时是否由读屏立即播报。仅用于页面加载后动态出现的提示；页面初始渲染时已存在的提示请保持关闭。
   * `danger` 和 `warning` 对应 `role="alert"`，其余语气对应 `role="status"`。
   */
  shouldAnnounce?: boolean;
  /** 根元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 区域级提示框组件，按语气渲染对应图标与语义属性。
 */
export function Alert({
  heading,
  children,
  tone = "neutral",
  actions,
  onDismiss,
  shouldAnnounce,
  className,
  ...props
}: AlertProps) {
  const t = useStrings(alertStrings);
  const role = shouldAnnounce ? (tone === "danger" || tone === "warning" ? "alert" : "status") : undefined;
  return (
    <div {...props} role={role} className={className ? `ui-alert ${className}` : "ui-alert"} data-tone={tone}>
      <span className="ui-alert__icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="ui-alert__body">
        {heading ? <p className="ui-alert__heading">{heading}</p> : null}
        {children ? <div className="ui-alert__content">{children}</div> : null}
        {actions ? <div className="ui-alert__actions">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <Button className="ui-alert__close" variant="ghost" size="sm" icon={<XIcon />} aria-label={t.dismiss} onPress={onDismiss} />
      ) : null}
    </div>
  );
}
