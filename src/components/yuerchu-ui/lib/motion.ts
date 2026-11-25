"use client";

/*
 * JS 动画（Motion）取动效 token 的唯一入口。数值来自 motion-tokens.ts（和 tokens.css 同一个来源）。
 *
 * 减弱动效只在这里判断一次，规则和 tokens.css 的选择器一致：
 * <html data-motion="reduced"> 或 "standard" 优先；没有设置时跟随系统偏好。
 * 组件拿到的就是已经换好的值（时长为 0、弹簧直接到位），不用、也不允许自己写判断分支（ui/no-reduced-motion-branch）。
 */
import { spring as springEasing } from "motion";
import type { Transition } from "motion/react";
import { useSyncExternalStore } from "react";
import * as tokens from "./motion-tokens";

const QUERY = "(prefers-reduced-motion: reduce)";

/** 当前是否处于减弱动效模式。给事件回调这类不在渲染里的代码用；渲染里用 useMotionTokens()。 */
export function isMotionReduced(): boolean {
  if (typeof document === "undefined") return false;
  const choice = document.documentElement.dataset.motion;
  if (choice === "reduced") return true;
  if (choice === "standard") return false;
  // 测试环境（jsdom）没有 matchMedia
  return typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void) {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : undefined;
  media?.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    media?.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

type Bezier = readonly [number, number, number, number];

export interface MotionTokens {
  /** 是否处于减弱动效模式。只用来给 Motion 的 MotionConfig 等需要它的地方，组件不要用它写分支。 */
  reduced: boolean;
  /** 时长，秒（Motion 的单位）。 */
  duration: Record<keyof typeof tokens.duration, number>;
  /** 缓动曲线，直接传给 Motion 的 ease。 */
  ease: Record<keyof typeof tokens.ease, Bezier>;
  /** 弹簧过渡，直接传给 Motion 的 transition。减弱模式下直接到位。 */
  spring: Transition;
  /**
   * 同一条弹簧的 CSS 写法（毫秒 + linear() 缓动），给只认 Web Animations 时间参数的库用（例如 NumberFlow 的 transformTiming）。
   * 减弱模式下时长为 0。
   */
  springTiming: { duration: number; easing: string };
  /**
   * 同一条弹簧的物理参数写法（刚度 + 阻尼），给手势松手后的归位用。
   * Motion 里用时间定义的弹簧（visualDuration）会丢掉初速度，松手时的甩动就断了；
   * 写成刚度和阻尼后，它接着拖动的速度走，曲线和 spring 相同。减弱模式下直接到位。
   */
  springGesture: Transition;
  pressScale: number;
  enterDistance: number;
  enterScale: number;
  swapBlur: number;
  swapDistance: number;
  swapScale: number;
  /** 逐个错开的间隔，秒；减弱模式下为 0。staggerMax 是总时长上限（秒）。 */
  stagger: Record<keyof typeof tokens.stagger, number>;
  staggerMax: number;
}

/** Motion 把弹簧采样成 "650ms linear(...)"；和 tokens.css 里的 --dur-spring / --ease-spring 是同一个结果 */
const SPRING_TIMING = (() => {
  const css = String(springEasing(tokens.spring.visualDuration, tokens.spring.bounce));
  const at = css.indexOf("ms ");
  return { duration: Number(css.slice(0, at)), easing: css.slice(at + 3) };
})();

/** 和 Motion 把 visualDuration / bounce 换算成刚度、阻尼的公式一致（bounce 在 0 到 1 之间时） */
const SPRING_PHYSICS = (() => {
  const dampingRatio = Math.max(1 - tokens.spring.bounce, 0.05);
  const root = (2 * Math.PI) / (tokens.spring.visualDuration * 1.2);
  const stiffness = root * root;
  return { type: "spring", stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness), mass: 1 } as const;
})();

function resolve(reduced: boolean): MotionTokens {
  const r = reduced ? tokens.reduced : undefined;
  const ms = { ...tokens.duration, ...r?.duration };
  return {
    reduced,
    duration: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v / 1000])) as MotionTokens["duration"],
    ease: tokens.ease,
    spring: r ? { duration: 0 } : { type: "spring", ...tokens.spring },
    springTiming: r ? { duration: 0, easing: "linear" } : SPRING_TIMING,
    springGesture: r ? { duration: 0 } : SPRING_PHYSICS,
    pressScale: r?.pressScale ?? tokens.pressScale,
    enterDistance: r?.enterDistance ?? tokens.enterDistance,
    enterScale: r?.enterScale ?? tokens.enterScale,
    swapBlur: r?.swapBlur ?? tokens.swapBlur,
    swapDistance: r?.swapDistance ?? tokens.swapDistance,
    swapScale: r?.swapScale ?? tokens.swapScale,
    stagger: Object.fromEntries(Object.entries(r?.stagger ?? tokens.stagger).map(([k, v]) => [k, v / 1000])) as MotionTokens["stagger"],
    staggerMax: tokens.staggerMax / 1000,
  };
}

const STANDARD = resolve(false);
const REDUCED = resolve(true);

/** 不在渲染里时取当前模式的 token（例如拖放结束的回调）。 */
export function currentMotionTokens(): MotionTokens {
  return isMotionReduced() ? REDUCED : STANDARD;
}

/**
 * 渲染里取当前模式的动效 token；用户切换动效设置或系统偏好变化时组件会重新渲染。
 * 服务端渲染时按标准模式。
 */
export function useMotionTokens(): MotionTokens {
  return useSyncExternalStore(subscribe, isMotionReduced, () => false) ? REDUCED : STANDARD;
}
