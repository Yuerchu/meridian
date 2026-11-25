"use client";

import type { ReactNode, Ref } from "react";
import type { ReactElement } from "react";
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState } from "react";
import { useLoadingPhase } from "../reveal/reveal";
import { Skeleton } from "../skeleton/skeleton";
import { useJoinList, useStrings } from "../../lib/i18n";
import { avatarStrings } from "./avatar.strings";
import "./avatar.css";

/**
 * 展示个人、组织或机器人的头像，未传图片或加载失败时自动回退为姓名缩写；多成员叠放请使用 AvatarGroup。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

/**
 * 提取姓名缩写：中文取最后两个字（例如“欧阳娜娜”取“娜娜”，`hanChars` 为 1 时取最后一个字），
 * 其他语言取首尾两个词的首字母（例如“Ada Lovelace”取“AL”）。
 */
export function initialsOf(name: string, hanChars: 1 | 2 = 2) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/\p{Script=Han}/u.test(trimmed)) return [...trimmed.replace(/\s+/g, "")].slice(-hanChars).join("");
  const words = trimmed.split(/\s+/);
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** 在 AvatarGroup 里：头像互相叠住一部分，两个汉字会被下一个头像盖住，只取一个字 */
const InGroupContext = createContext(false);

export interface AvatarProps {
  /** 姓名或名称，同时作为屏幕阅读器名称与缩写生成来源。 */
  name: string;
  /** 头像图片地址，未传入或加载失败时显示姓名缩写。 */
  src?: string;
  /**
   * 尺寸：`sm` 为 24px（列表、评论），`md` 为 32px，`lg` 为 40px（个人资料），`xl` 为 80px（个人主页头部）。
   * @default "md"
   */
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * 形状：个人用户使用圆形，组织、项目或机器人使用圆角方形。
   * @default "circle"
   */
  shape?: "circle" | "square";
  /** 姓名已在旁边文字中展示时设为 `true`，使头像仅作视觉装饰对读屏隐藏。 */
  isDecorative?: boolean;
  /**
   * 加载状态：渲染同等尺寸与形状的占位块（未知姓名时 `name` 可先传空字符串）。
   * 耗时较短时仅显示底色，加载提示由外层容器通过 `aria-busy` 说明，头像本身对读屏隐藏。
   */
  isLoading?: boolean;
  /** 头像外层的装饰框，可传入图片或 SVG，按头像尺寸等比放大至 1.25 倍，仅作装饰不可交互。 */
  frame?: ReactNode;
  /** 右下角的角标图标或状态标记，随头像尺寸等比缩放，仅作展示不可交互。 */
  badge?: ReactNode;
  /** 角标语义说明（如“已认证”“在线”），会与 `name` 一同读出；无角标时忽略。 */
  badgeLabel?: string;
  /** 自定义类名。 */
  className?: string;
  /** 根元素的 DOM 引用。 */
  ref?: Ref<HTMLSpanElement>;
}

/**
 * 根元素采用 `role="img"` 并以 `name` 作为可访问名称，内部图片与缩写均对读屏隐藏；支持水合前加载失败图片的自动回退。
 */
export function Avatar({ name, src, size = "md", shape = "circle", isDecorative, isLoading = false, frame, badge, badgeLabel, className, ref }: AvatarProps) {
  const inGroup = useContext(InGroupContext);
  const join = useJoinList();
  const hasFrame = frame != null && frame !== false;
  const hasBadge = badge != null && badge !== false;
  const { phase } = useLoadingPhase(isLoading);
  const [failedSrc, setFailedSrc] = useState<string>();
  const imgRef = useRef<HTMLImageElement>(null);
  const showImage = src && failedSrc !== src;

  // 水合之前就加载失败的图片不会再触发 onError：挂载后检查一次
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0 && src) setFailedSrc(src);
  }, [src]);

  if (phase !== "content") {
    return (
      <span ref={ref} className={className ? `ui-avatar ${className}` : "ui-avatar"} data-size={size} data-shape={shape} data-loading="" aria-hidden="true">
        {/* 等待阶段只有底色；过了延迟才出现闪光 */}
        {phase === "placeholder" ? <Skeleton shape="rect" className="ui-avatar__skeleton" /> : null}
      </span>
    );
  }

  return (
    <span
      ref={ref}
      className={className ? `ui-avatar ${className}` : "ui-avatar"}
      data-size={size}
      data-shape={shape}
      data-decorated={(hasFrame || hasBadge) || null}
      {...(isDecorative ? { "aria-hidden": true } : { role: "img", "aria-label": join([name, ...(hasBadge && badgeLabel ? [badgeLabel] : [])]) })}
    >
      <span className="ui-avatar__picture" aria-hidden="true">
        <span className="ui-avatar__initials">
          {/* 24px 放不下两个汉字（最小字号 12px），组里会被叠住：都只取一个字 */}
          {initialsOf(name, size === "sm" || inGroup ? 1 : 2)}
        </span>
        {showImage ? (
          <img ref={imgRef} className="ui-avatar__image" src={src} alt="" onError={() => setFailedSrc(src)} />
        ) : null}
      </span>
      {hasFrame ? <span className="ui-avatar__frame" aria-hidden="true">{frame}</span> : null}
      {hasBadge ? <span className="ui-avatar__badge" aria-hidden="true">{badge}</span> : null}
    </span>
  );
}

export interface AvatarGroupProps {
  /** 需要并排叠放的一组 Avatar。 */
  children: ReactNode;
  /** 最多展示的头像数量，超出部分合并为“+N”。 */
  max?: number;
  /** 头像组的可访问名称，例如“项目成员”。 */
  "aria-label": string;
  /**
   * 头像尺寸，统一应用到组内每个头像。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
}

/**
 * 叠放展示一组头像，超出 `max` 的部分合并为“+N”并读作“还有 N 人”。
 */
export function AvatarGroup({ children, max, "aria-label": ariaLabel, size = "md" }: AvatarGroupProps) {
  const t = useStrings(avatarStrings);
  // 尺寸传给每个头像（不只是改 CSS）：缩写取几个字也跟着尺寸走
  const items = Children.toArray(children)
    .filter(isValidElement)
    .map((item) => cloneElement(item as ReactElement<AvatarProps>, { size }));
  const shown = max !== undefined && items.length > max ? items.slice(0, max) : items;
  const rest = items.length - shown.length;
  return (
    <span className="ui-avatar-group" role="group" aria-label={ariaLabel} data-size={size}>
      <InGroupContext value>{shown}</InGroupContext>
      {rest > 0 ? (
        <span className="ui-avatar ui-avatar-group__more" data-size={size} data-shape="circle" role="img" aria-label={t.more({ count: rest })}>
          <span className="ui-avatar__initials" aria-hidden="true">
            +{rest}
          </span>
        </span>
      ) : null}
    </span>
  );
}
