"use client";

import { AnimatePresence, animate, motion, useIsPresent } from "motion/react";
import type { ReactNode, Ref, RefObject } from "react";
import { createContext, isValidElement, useContext, useLayoutEffect, useRef, useState } from "react";
import type { ButtonProps as AriaButtonProps } from "react-aria-components";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { SpinnerIcon } from "../../lib/icons";
import type { MotionTokens } from "../../lib/motion";
import { useMotionTokens } from "../../lib/motion";
import { TextMorph } from "../../lib/text-morph";
import { useLoadingPhase } from "../reveal/reveal";
import "./button.css";

/**
 * 触发页面内的交互操作，例如提交表单、打开对话框或发送消息。
 * 跳转到其他页面时请使用 Link；在多个视图间切换时请使用 Tabs 或 SegmentedControl。
 *
 * @packageDocumentation
 * @category 操作
 * @status 实验中
 */

export interface ButtonProps extends Omit<AriaButtonProps, "children"> {
  /**
   * 按钮外观。primary 使用 Ink 强调当前区域最主要的操作（同一区域最多一个）；
   * secondary 带边框，用于常规操作；ghost 无边框，用于次要或成组操作；destructive 用于删除等不可撤销操作。
   * @default "primary"
   */
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  /**
   * 按钮尺寸，对应 --control-sm、--control-md 和 --control-lg 控件高度；在触屏设备上会自动加高。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 显示在文字前的图标。若未提供文字仅展示图标，按钮会呈正方形，此时必须传入 aria-label；处于等待状态（isPending）时此处会显示加载图标。 */
  icon?: ReactNode;
  /** 显示在文字后的图标，例如表示“展开”的箭头。 */
  iconRight?: ReactNode;
  /** 按钮文字，建议用动词明确表达操作结果，例如“保存修改”。 */
  children?: ReactNode;
  /**
   * 传入链接地址后，组件会渲染为外观与按钮一致的 <a> 元素，并通过 UIProvider 走客户端路由，适用于“开始使用”“查看文档”等主推跳转操作。
   * 链接形态不支持等待状态（isPending）与文字替换动画。
   */
  href?: string;
  /** 指向底层的 button 元素（未传入 href 时生效）。 */
  ref?: Ref<HTMLButtonElement>;
}

/** ButtonGroup 给组里的按钮的默认外观、尺寸和禁用（按钮自己写了的以按钮为准） */
export const ButtonGroupContext = createContext<Pick<ButtonProps, "variant" | "size" | "isDisabled"> | null>(null);

/**
 * 基于 React Aria Button 实现，内置键盘、触屏、按压状态及无障碍播报支持。
 * 传入 isPending 进入等待状态时，按钮保持可聚焦并拦截点击；加载图标在 200ms 后出现，出现后至少停留 400ms。
 *
 * @promote onPress, isPending, isDisabled, type
 */
export function Button(props: ButtonProps) {
  return props.href !== undefined ? <LinkButton {...props} href={props.href} /> : <ActionButton {...props} />;
}

/** 写了 href：外观和按钮一样的链接。键盘 Enter 打开（链接的行为），读屏读作"链接" */
function LinkButton({
  variant: variantProp,
  size: sizeProp,
  icon,
  iconRight,
  children,
  className,
  href,
  isDisabled: disabledProp,
  onPress,
  // 只有图标的链接靠这些拿到读屏名称：漏传就成了没有名字的链接
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
}: ButtonProps & { href: string }) {
  const group = useContext(ButtonGroupContext);
  const variant = variantProp === undefined ? group?.variant ?? "primary" : variantProp;
  const size = sizeProp === undefined ? group?.size ?? "md" : sizeProp;
  const hasLabel = children !== undefined && children !== null && children !== false && children !== "";
  return (
    <AriaLink
      href={href}
      isDisabled={disabledProp ?? group?.isDisabled}
      onPress={onPress}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      className={withUiClass("ui-button", typeof className === "string" ? className : undefined)}
      data-variant={variant}
      data-size={size}
      data-icon-only={!hasLabel || undefined}
    >
      {icon ? <span className="ui-button__icon">{icon}</span> : null}
      {hasLabel ? (
        <span className="ui-button__label">
          <span className="ui-button__text">{children}</span>
        </span>
      ) : null}
      {iconRight ? <span className="ui-button__icon">{iconRight}</span> : null}
    </AriaLink>
  );
}

function ActionButton({ variant: variantProp, size: sizeProp, icon, iconRight, children, className, href: _href, ...props }: ButtonProps) {
  const group = useContext(ButtonGroupContext);
  const variant = variantProp === undefined ? group?.variant ?? "primary" : variantProp;
  const size = sizeProp === undefined ? group?.size ?? "md" : sizeProp;
  const isDisabled = props.isDisabled ?? group?.isDisabled;
  const hasLabel = children !== undefined && children !== null && children !== false && children !== "";
  const m = useMotionTokens();
  // 等待的时机同 Reveal（DESIGN.md §7.4）：很快就完成时不出现加载图标；出现后至少停留一小段时间，不闪一下。
  // 加载图标停留期间按钮仍是等待状态（拦截点击、读屏仍是"正在处理"）
  const { phase } = useLoadingPhase(props.isPending ?? false);
  const showSpinner = phase === "placeholder";
  // 文字是字符串或数字时逐字增量替换：相同的字平移到新位置，不同的字退场、进场，宽度跟着弹过去。其他内容不做替换动画。
  // 替换动画用到才挂（#566）：文字、图标、加载状态没变过的按钮按静态内容渲染，第一次变化时才换成动画结构
  const text = typeof children === "string" || typeof children === "number" ? String(children) : null;
  const label = useLiveSwap(text === null ? "node" : `text:${text}`, children);
  const labelText = typeof label.value === "string" || typeof label.value === "number" ? String(label.value) : null;
  // 有左侧图标时加载图标换掉它；没有时加载图标盖在文字上（pending）
  const iconSwap = useLiveSwap(!icon ? "none" : showSpinner ? "pending" : contentKey(icon), icon && showSpinner ? <SpinnerIcon className="ui-button__spinner" /> : icon);
  const pending = useLiveSwap(showSpinner && !icon ? "pending" : "", showSpinner && !icon);
  const labelRef = useRef<HTMLSpanElement>(null);
  useWidthFollow(labelRef, label.key, label.live, m);
  return (
    <AriaButton
      {...props}
      isPending={props.isPending || showSpinner}
      isDisabled={isDisabled}
      className={withUiClass("ui-button", className)}
      data-variant={variant}
      data-size={size}
      data-icon-only={!hasLabel || undefined}
    >
      {() => (
        <>
          {/* 没有左侧图标时，加载图标盖在文字上方，文字淡出但仍保留宽度和可读名称 */}
          {pending.live ? (
            <AnimatePresence initial={false}>
              {pending.value ? (
                <Swap key="pending" className="ui-button__pending" m={m}>
                  <SpinnerIcon className="ui-button__spinner" />
                </Swap>
              ) : null}
            </AnimatePresence>
          ) : null}
          {icon ? (
            <span className="ui-button__icon">
              {iconSwap.live ? (
                <AnimatePresence mode="popLayout" initial={false}>
                  <Swap key={iconSwap.key} className="ui-button__icon-swap" m={m}>
                    {iconSwap.value}
                  </Swap>
                </AnimatePresence>
              ) : (
                <span className="ui-button__icon-swap">{iconSwap.value}</span>
              )}
            </span>
          ) : null}
          {hasLabel ? (
            <span ref={labelRef} className="ui-button__label" data-faded={pending.value || undefined}>
              {label.live && labelText !== null ? (
                <TextMorph text={labelText} m={m} className="ui-button__text" />
              ) : (
                <span className="ui-button__text">{label.value}</span>
              )}
            </span>
          ) : null}
          {iconRight ? <span className="ui-button__icon">{iconRight}</span> : null}
        </>
      )}
    </AriaButton>
  );
}

/**
 * 替换动画用到才挂：key 从没变过时 live 是 false，调用方按静态内容渲染（不挂 Motion 和 AnimatePresence）。
 * key 第一次变化时分两步：先提交一次"动画结构 + 旧内容"（Motion 量到旧的位置和宽度），
 * 紧接着在 layout effect 里换成新内容，动画从旧内容播到新内容。之后一直保持动画结构。
 * 两步都在同一帧绘制之前完成，屏幕上看不到中间那一步。
 */
function useLiveSwap<T>(key: string, value: T): { live: boolean; key: string; value: T } {
  const [state, setState] = useState({ live: false, settled: false, key });
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (!state.live) previous.current = value;
  });
  if (!state.live && key !== state.key) {
    // 第一次变化：先用旧内容挂上动画结构（渲染中直接更新 state，不多提交一轮静态内容）
    setState({ ...state, live: true });
  }
  useLayoutEffect(() => {
    if (state.live && !state.settled) setState((s) => ({ ...s, settled: true }));
  }, [state.live, state.settled]);
  if (state.live && !state.settled) return { live: true, key: state.key, value: previous.current };
  return { live: state.live, key, value };
}

const typeIds = new WeakMap<object, number>();
let nextTypeId = 1;
/** 图标换成另一个图标（例如复制变成对勾）时 key 跟着变，才会播替换动画；同一个图标重新渲染 key 不变 */
function contentKey(node: ReactNode): string {
  if (!isValidElement(node)) return "icon";
  const { type } = node;
  if (typeof type === "string") return `${type}:${node.key ?? ""}`;
  if (!typeIds.has(type)) typeIds.set(type, nextTypeId++);
  return `${typeIds.get(type)}:${node.key ?? ""}`;
}

/**
 * 同一位置的图标替换（图标换成另一个、换成加载图标）：新图标从小放大、从模糊中出现，旧图标反过来离开，离开得更快。
 * 正在离开的那份对读屏隐藏。文字的替换见 lib/text-morph（逐字增量）。
 */
function Swap({ className, m, children, ref }: { className: string; m: MotionTokens; children: ReactNode; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  const hidden = { opacity: 0, scale: m.swapScale, filter: `blur(${m.swapBlur}px)` };
  const tween = { duration: m.duration.fast, ease: m.ease.enter };
  return (
    <motion.span
      ref={ref}
      className={className}
      aria-hidden={present ? undefined : true}
      initial={hidden}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      // 离开用 standard 而不是 exit 曲线：exit 先慢后快，旧图标会在原地停留半程，和新图标叠在一起
      exit={{ ...hidden, transition: { duration: m.duration.fast, ease: m.ease.standard } }}
      transition={{ default: m.spring, opacity: tween, filter: tween }}
    >
      {children}
    </motion.span>
  );
}

/** 文字换了以后，标签的宽度从旧宽度弹到新宽度（按钮跟着变宽变窄），而不是一下跳过去。live 之前（文字没变过）什么都不注册 */
function useWidthFollow(ref: RefObject<HTMLElement | null>, key: string, live: boolean, m: MotionTokens) {
  // 屏幕上现在的宽度：换文字的那一刻 DOM 已经是新文字了，旧宽度只能从这里拿。
  // 变成 live 的那一次提交里标签还是旧文字（useLiveSwap 的第一步），这时量到的就是旧宽度
  const shown = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!live || !el || typeof ResizeObserver === "undefined") return;
    shown.current = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      shown.current = el.getBoundingClientRect().width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, live]);
  const last = useRef(key);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!live || !el || last.current === key) {
      last.current = key;
      return;
    }
    last.current = key;
    // 上一次还没弹完时，从它停下的地方接着弹
    const from = el.style.width ? el.getBoundingClientRect().width : shown.current;
    el.style.width = "";
    const to = el.getBoundingClientRect().width;
    if (from === undefined || Math.abs(from - to) < 0.5) return;
    // 先同步写回旧宽度：Motion 在下一帧才开始，不写的话会先闪一帧新宽度
    el.style.width = `${from}px`;
    // 弹的过程中文字保持完整宽度，不出省略号（否则变宽时会先显示"保存…"），超出部分由按钮边缘裁掉
    el.dataset.morphing = "";
    const animation = animate(el, { width: [from, to] }, m.spring);
    void animation.then(() => {
      el.style.width = "";
      delete el.dataset.morphing;
    });
    return () => animation.stop();
    // 只在文字变化时播放：m.spring 只在切换动效模式时变化，不需要因此重播
  }, [key, ref, live]);
}
