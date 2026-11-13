"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useStrings } from "../../lib/i18n";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { alertStrings } from "./alert.strings";
import "./alert.css";

/**
 * 提示框：页面里一段需要注意的说明，例如"试用还剩 3 天""这个 API 将在下个版本移除"。一直显示，直到条件变化或用户关闭。
 * 操作结果的短暂反馈用 Toast；需要用户处理才能继续的用 Dialog。
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
  /** 标题：一句话说清是什么情况。（不叫 title：避免和会弹出浏览器原生提示的 title 属性混淆） */
  heading?: ReactNode;
  /** 正文：补充说明和建议怎么做。 */
  children?: ReactNode;
  /**
   * 语气，决定底色和图标。neutral 是中性灰（info 不用蓝色）。
   * @default "neutral"
   */
  tone?: "neutral" | "success" | "warning" | "danger";
  /** 操作按钮，放在正文下方，例如"升级套餐"。 */
  actions?: ReactNode;
  /** 传了就显示右上角的关闭按钮，点击时调用。组件不自己隐藏，由使用方决定。 */
  onDismiss?: () => void;
  /**
   * 出现时让读屏立即读出。只用于页面加载之后才出现的提示（例如提交后出现的错误）；
   * 页面一打开就在的提示不要开，读屏用户按顺序读到即可。danger / warning 用 role="alert"，其他用 role="status"。
   */
  shouldAnnounce?: boolean;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 提示框。浅底，图标带语气色，文字用正文色。
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
