"use client";

import { AnimatePresence, animate, motion, type AnimationPlaybackControls } from "motion/react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mergeRefs, VisuallyHidden } from "react-aria";
import { announce } from "../../lib/announce";
import { useMotionTokens } from "../../lib/motion";
import { loading as timing } from "../../lib/motion-tokens";
import { Skeleton } from "../skeleton/skeleton";
import type { Shape } from "./reveal-trace";
import { traceShape } from "./reveal-trace";
import "./reveal.css";

/**
 * 加载切换：数据区域在"占位"和"内容"之间切换。负责时机和过渡；占位可以由 sample（示例数据渲染的同一个组件）自动量出来，也可以自己给（fallback）。
 * 数据很快就到时不显示占位；占位出现后至少停留一小段时间；占位换成内容时交叉淡化，容器高度从旧高度过渡到新高度。
 * 页面上已知的部分（标题、按钮）放在外面照常渲染，只把缺数据的那块包进来，见 DESIGN.md §7.4。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface RevealProps {
  /** 是否还在加载。从 true 变成 false 时换成内容；再变回 true 时重新走一遍。 */
  isLoading: boolean;
  /**
   * 示例：用示例数据渲染的同一个内容，例如 `<MemberCard member={SAMPLE_MEMBER} />`。加载中把它隐藏着渲染一遍（inert、对读屏隐藏），
   * 按它的 DOM 画骨架：文字一行一条，图片、按钮、输入框、徽标一个块，和真实内容一样大。示例里不要发请求、订阅数据。
   * 量不准的元素加 data-skeleton="block"（画成一块）或 data-skeleton="ignore"（不画）；图表、canvas 这类用 fallback。
   */
  sample?: ReactNode;
  /** 自己画的占位（通常是几个 Skeleton），对读屏隐藏。写了 sample 时不用。都没写时是三行文字。 */
  fallback?: ReactNode;
  /**
   * 记住形状用的键，例如 "project-members"。内容显示过以后记下它的布局（只记位置和尺寸，不记内容），
   * 下次加载（刷新、翻页回来）时按上次的样子画骨架，优先于 sample 和 fallback。只在这次页面会话里有效。
   */
  id?: string;
  /** 加载好的内容。加载中不渲染。 */
  children?: ReactNode;
  /** 加载中给读屏的说明，例如"正在加载成员列表"。 */
  loadingLabel: string;
  /** 加载完成后读屏播报的一句话，例如"成员列表已加载"。不写不播报（内容出现在原处，读屏用户往下读就能读到）。 */
  loadedLabel?: string;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/** waiting：在加载，但还没到显示占位的时候（占位已经占住位置，只是看不见）；placeholder：占位可见；content：内容 */
export type LoadingPhase = "waiting" | "placeholder" | "content";
/** fromPlaceholder：这次是从可见的占位换成内容（只有这时做交叉淡化和高度过渡） */
export type LoadingState = { phase: LoadingPhase; fromPlaceholder: boolean };

/**
 * 加载的时机（DESIGN.md §7.4）：isLoading 变 true 后先 waiting（占位占住位置但看不见），
 * 过了 showDelay 才 placeholder（占位可见）；占位一旦可见，至少停留 minVisible 才换成 content。
 * 自己画占位的组件（Table 的骨架行、Markdown 的正文占位）用它，和 Reveal 的时机一致。
 */
export function useLoadingPhase(isLoading: boolean): LoadingState {
  const [state, setState] = useState<LoadingState>({ phase: isLoading ? "waiting" : "content", fromPlaceholder: false });
  const shownAt = useRef(0);

  useEffect(() => {
    if (isLoading) {
      setState((s) => (s.phase === "content" ? { phase: "waiting", fromPlaceholder: false } : s));
      const t = setTimeout(() => {
        shownAt.current = performance.now();
        setState((s) => (s.phase === "waiting" ? { phase: "placeholder", fromPlaceholder: false } : s));
      }, timing.showDelay);
      return () => clearTimeout(t);
    }
    // 加载完了：占位还没露面就直接换；露面了就等它停够
    const reveal = () => setState((s) => (s.phase === "content" ? s : { phase: "content", fromPlaceholder: s.phase === "placeholder" }));
    const left = timing.minVisible - (performance.now() - shownAt.current);
    const t = setTimeout(reveal, Math.max(0, left));
    // 占位没露面时不等
    setState((s) => (s.phase === "waiting" ? { phase: "content", fromPlaceholder: false } : s));
    return () => clearTimeout(t);
  }, [isLoading]);

  return state;
}

/**
 * 加载切换。很快就到的数据不显示占位；慢的数据先显示占位，到了以后交叉淡化成内容，容器高度跟着过渡。
 * 加载中容器 aria-busy，并给读屏一段说明；占位对读屏隐藏。
 */
export function Reveal({ isLoading, sample, fallback, id, children, loadingLabel, loadedLabel, className, ref }: RevealProps) {
  const m = useMotionTokens();
  const state = useLoadingPhase(isLoading);
  const { phase, fromPlaceholder } = state;
  const frame = useRef<HTMLDivElement>(null);
  const height = useRef<number | undefined>(undefined);
  const controls = useRef<AnimationPlaybackControls | undefined>(undefined);
  const content = useRef<HTMLDivElement>(null);
  useRememberShape(id, content, phase === "content");

  // 被动的尺寸变化（窗口、字体、内容自己长高）直接跟随：只记下高度，不做动画
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!controls.current) height.current = el.offsetHeight;
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      controls.current?.stop();
    };
  }, []);

  // 占位 → 内容：从旧高度弹到新高度。只在这一刻动，动的时候才裁切（静止时焦点环不被切掉）
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const start = height.current;
    const end = el.offsetHeight;
    height.current = end;
    if (!fromPlaceholder || phase !== "content" || start === undefined || start === end) return;
    controls.current?.stop();
    el.dataset.resizing = "";
    const run = animate(el, { height: [`${start}px`, `${end}px`] }, m.spring);
    controls.current = run;
    void run.then(() => {
      if (controls.current !== run) return;
      el.style.height = "";
      delete el.dataset.resizing;
      controls.current = undefined;
      height.current = el.offsetHeight;
    });
  }, [state, phase, fromPlaceholder, m.spring]);

  // 加载完成的播报：每次从加载换成内容播一次
  const wasBusy = useRef(phase !== "content");
  useEffect(() => {
    if (phase !== "content") {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (loadedLabel) announce(loadedLabel);
  }, [phase, loadedLabel]);

  const busy = phase !== "content";
  const fade = { duration: m.duration.fast, ease: m.ease.standard };
  return (
    <div ref={mergeRefs(frame, ref ?? null)} className={className ? `ui-reveal ${className}` : "ui-reveal"} aria-busy={busy} data-phase={phase}>
      {busy ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : null}
      <AnimatePresence mode="popLayout" initial={false}>
        {busy ? (
          <motion.div
            key="placeholder"
            className="ui-reveal__placeholder"
            aria-hidden="true"
            // 等待阶段占住位置但看不见：数据很快到时根本不出现
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === "placeholder" ? 1 : 0 }}
            exit={{ opacity: 0, transition: { duration: m.duration.fast, ease: m.ease.exit } }}
            transition={fade}
          >
            <Placeholder sample={sample} fallback={fallback} remembered={id === undefined ? undefined : shapes.get(id)} />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            ref={content}
            className="ui-reveal__content"
            // 占位没露面（很快就到，或一开始就有数据）：直接出现，不播进场
            initial={fromPlaceholder ? { opacity: 0, y: m.enterDistance } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: m.duration.standard, ease: m.ease.enter }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 按 id 记住的形状（这次页面会话） */
const shapes = new Map<string, Shape>();

/** 清掉记住的形状，例如退出登录时（形状里没有内容，但能看出上次列表有多长） */
export function forgetShapes() {
  shapes.clear();
}

/** 一行文字的骨架只画字号那么高：行框的上下各去掉 15% */
const TEXT_INSET = 0.15;
const TEXT_RADIUS = "calc(var(--radius-item) / 2)";
/** 一次最多画这么多块：再多也看不出区别，只是更慢 */
const MAX_BONES = 400;

/** 骨架从哪来：上次显示过的形状（写了 id）→ 示例量出来的 → 自己画的 → 三行文字 */
function Placeholder({ sample, fallback, remembered }: { sample: ReactNode; fallback: ReactNode; remembered: Shape | undefined }) {
  if (remembered) return <Bones shape={remembered} standalone />;
  if (sample !== undefined) return <SampleBones sample={sample} />;
  if (fallback !== undefined) return fallback;
  return <Skeleton lines={3} />;
}

/** 示例隐藏着排版（占住和真实内容一样的位置），骨架按它量出来的位置叠在上面；尺寸变了重新量 */
function SampleBones({ sample }: { sample: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    setShape(traceShape(el));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setShape(traceShape(el)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="ui-reveal__sample">
      <div ref={content} className="ui-reveal__sample-content" inert>
        {sample}
      </div>
      {shape ? <Bones shape={shape} /> : null}
    </div>
  );
}

/** 画骨架。standalone：没有示例垫在下面（记住的形状），自己撑开高度 */
function Bones({ shape, standalone = false }: { shape: Shape; standalone?: boolean }) {
  return (
    <div className="ui-reveal__bones" data-standalone={standalone || undefined} style={standalone ? ({ "--ui-reveal-height": `${shape.height}px` } as CSSProperties) : undefined}>
      {shape.bones.slice(0, MAX_BONES).map((b, i) => {
        const inset = b.kind === "text" ? b.height * TEXT_INSET : 0;
        const style = {
          "--ui-reveal-x": `${b.x}px`,
          "--ui-reveal-y": `${b.y + inset}px`,
          "--ui-reveal-w": `${b.width}px`,
          "--ui-reveal-h": `${b.height - inset * 2}px`,
        } as CSSProperties;
        return (
          <span key={i} className="ui-reveal__bone" style={style}>
            <Skeleton shape="rect" width="100%" height="100%" radius={b.kind === "text" ? TEXT_RADIUS : b.radius} />
          </span>
        );
      })}
    </div>
  );
}

/** 内容显示着的时候记下它的形状，尺寸变了更新；下次加载按它画（只在写了 id 时） */
function useRememberShape(id: string | undefined, content: { current: HTMLElement | null }, isShown: boolean) {
  useLayoutEffect(() => {
    const node = content.current;
    if (id === undefined || !isShown || !node) return;
    const save = () => {
      const shape = traceShape(node);
      if (shape.bones.length) shapes.set(id, shape);
    };
    save();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(save);
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, content, isShown]);
}
