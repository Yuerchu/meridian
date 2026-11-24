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
 * 管理数据区域在占位骨架与真实内容之间的加载切换，自动处理延迟显示、交叉淡化与高度过渡。
 * 占位骨架可以通过 `sample` 从真实组件排版自动测量，也可以由 `fallback` 手动指定；标题与操作栏建议留在外层照常渲染。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface RevealProps {
  /** 是否处于加载中。从 `true` 变为 `false` 时切换到真实内容，再次设为 `true` 时重新进入加载流程。 */
  isLoading: boolean;
  /**
   * 用于自动测量骨架的示例节点（如 `<MemberRows members={SAMPLE} />`）。会在隐藏的 `inert` 容器中排版并按文字与控件尺寸生成骨架，示例内部请勿发起请求或订阅。
   * 对难以自动拆解的元素可加 `data-skeleton="block"` 或 `data-skeleton="ignore"`；图表和画布类元素建议使用 `fallback`。
   */
  sample?: ReactNode;
  /** 手动指定的占位内容（通常为若干 Skeleton 组合），对读屏隐藏。传入 `sample` 时可省略；两者都未传入时默认显示三行文本骨架。 */
  fallback?: ReactNode;
  /**
   * 用于记住布局形状的唯一标识（如 `"project-members"`）。内容渲染完成后会记住各元素位置与尺寸，在当前会话内再次加载时优先按上次布局绘制骨架。
   */
  id?: string;
  /** 加载完成后展示的真实内容，加载中不会挂载渲染。 */
  children?: ReactNode;
  /** 加载过程中提供给屏幕阅读器的状态提示，例如“正在加载成员列表”。 */
  loadingLabel: string;
  /** 加载完成切换到真实内容时通过读屏播报的提示语，例如“成员列表已加载”；未传入时不额外播报。 */
  loadedLabel?: string;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/** `waiting` 表示正在加载但尚未达到骨架显示延迟（已占位但透明）；`placeholder` 表示骨架可见；`content` 表示展示真实内容。 */
export type LoadingPhase = "waiting" | "placeholder" | "content";
/** `fromPlaceholder` 标记本次是否从可见的骨架切换为真实内容，仅在此情况下播放交叉淡化与高度过渡。 */
export type LoadingState = { phase: LoadingPhase; fromPlaceholder: boolean };

/**
 * 统一计算加载阶段状态机：进入加载后先经历静默等待期，超过显示阈值再露出占位，且占位露出后至少停留最小时长再切换内容。
 * 需要自行绘制骨架的复合组件（如表格骨架行或长文档占位）可复用此 Hook 保持一致的等待节奏。
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
 * 在占位骨架与真实内容之间平滑切换；短时间加载不闪出骨架，慢加载在占位后交叉淡化并过渡容器高度。
 * 加载期间标记 `aria-busy` 并提供读屏说明，占位元素本身对辅助技术隐藏。
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

/** 骨架来源优先级：已记忆的形状（传入 `id`）→ 示例测量结果 → 自定义 `fallback` → 默认三行文本 */
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

/** 在真实内容显示期间记录布局形状并在尺寸变化时更新，仅在传入 `id` 时启用 */
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
