"use client";

import type { CSSProperties, ReactNode } from "react";
import type { DragControls } from "motion/react";
import { animate, motion, useDragControls, useMotionValue, useTransform } from "motion/react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "react-aria";
import { flushSync } from "react-dom";
import type { QueuedToast } from "react-stately";
import {
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as AriaToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
} from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from "../../lib/icons";
import { useMotionTokens } from "../../lib/motion";
import { Button } from "../button/button";
import { ProgressBar } from "../progress-bar/progress-bar";
import { Spinner } from "../spinner/spinner";
import { toastStrings } from "./toast.strings";
import "./toast.css";

/**
 * 在屏幕边缘展示操作结果的简短反馈提示（如“已保存”、“复制成功”），支持自动关闭、队列调度与原地更新。
 * 提示区域已由 `UIProvider` 统一挂载，业务侧调用 `toast({ title })` 即可；需要阻断确认或长期提醒请改用 Dialog 与 Alert。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface ToastOptions {
  /**
   * 提示的去重标识。若相同 `id` 的提示仍在显示，则原地更新该条目而不再新增叠加，适合连续失败或“正在导出… → 导出完成”等场景。
   */
  id?: string;
  /** 一句话说明提示结果，例如“已保存”。 */
  title: string;
  /** 补充说明文本，可选。 */
  description?: string;
  /**
   * 语义语气与图标风格；`danger` 与 `loading` 默认不自动关闭，等待用户阅读或后续状态更新。
   * @default "neutral"
   */
  tone?: "neutral" | "success" | "warning" | "danger" | "loading";
  /** 附带的操作按钮，例如“撤销”；带有操作按钮的提示默认不自动关闭。 */
  action?: { label: string; onAction: () => void };
  /** 自动关闭时长（毫秒）。默认 5000，`warning` 默认 8000；带 `action`、`danger` 或 `loading` 时默认不自动关闭；设为 `0` 可禁止自动关闭。标签页切到后台时暂停倒计时。 */
  timeout?: number;
  /** 提示关闭时触发的回调（无论是用户手动关闭还是倒计时结束）。 */
  onClose?: () => void;
  /**
   * 0 到 1 之间的完成进度。仅在 `tone="loading"` 时渲染为进度条，未传入时显示旋转加载图标。
   * 通过 `updateToast(key, { progress })` 仅更新进度时不会触发读屏重播或重置计时；完成后把 `tone` 更新为结果状态即可自动收起进度条。
   */
  progress?: number;
  /** 进度条右侧的自定义数值文案，例如“12 / 40”，未传入时默认格式化为百分比；与 `progress` 一同更新同样不打扰读屏。 */
  progressLabel?: string;
}

/** 只改这些字段时走快速通道：不重新计时、不做过渡、不让读屏重读整条提示 */
const PROGRESS_FIELDS = new Set(["progress", "progressLabel"]);

type Entry = Omit<ToastOptions, "id"> & {
  /** 每次更新加一：重新开始计时 */
  version: number;
};

/** 计时器：悬停、聚焦在提示区域，或标签页切到后台时暂停（由队列统一调度） */
class Timer {
  private id: ReturnType<typeof setTimeout> | null = null;
  private start = 0;
  private remaining = 0;
  private callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  reset(ms: number, paused: boolean) {
    this.pause();
    this.remaining = ms;
    if (!paused) this.resume();
  }
  pause() {
    if (this.id === null) return;
    clearTimeout(this.id);
    this.id = null;
    this.remaining -= Date.now() - this.start;
  }
  resume() {
    if (this.id !== null || this.remaining <= 0) return;
    this.start = Date.now();
    this.id = setTimeout(() => {
      this.id = null;
      this.remaining = 0;
      this.callback();
    }, this.remaining);
  }
  stop() {
    this.pause();
    this.remaining = 0;
  }
}

/**
 * React Aria 的队列只能新增和关闭：提示的内容和计时由这里管理，队列里只放 key。
 * 这样同一条提示可以原地更新，不用关掉再开一条（读屏会读两遍，还会闪一下）。
 */
class Queue extends AriaToastQueue<null> {
  /** 悬停、聚焦在提示区域时（React Aria 调 pauseAll / resumeAll） */
  private held = false;
  /** 标签页切到后台时：用户看不见，不该替他倒计时 */
  private hidden = false;
  /** 计时器现在是否停着 */
  get paused() {
    return this.held || this.hidden;
  }
  pauseAll() {
    super.pauseAll();
    this.held = true;
    this.sync();
  }
  resumeAll() {
    super.resumeAll();
    this.held = false;
    this.sync();
  }
  setHidden(hidden: boolean) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.sync();
  }
  private sync() {
    for (const t of this.visibleToasts) {
      const timer = timers.get(t.key);
      if (this.paused) timer?.pause();
      else timer?.resume();
    }
    // 倒计时细条跟着停
    notify();
  }
}

/** 提示的进出场用 View Transitions：React Aria 关闭提示时直接移除元素，CSS 本身做不了退场动画 */
function withTransition(fn: () => void) {
  if (typeof document !== "undefined" && "startViewTransition" in document) {
    document.startViewTransition(() => flushSync(fn));
  } else {
    fn();
  }
}

const queue = new Queue({ maxVisibleToasts: 3, wrapUpdate: withTransition });
const entries = new Map<string, Entry>();
const timers = new Map<string, Timer>();
const keysById = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** 默认停留时间（毫秒）；警告多给一些时间读完 */
const BASE_TIMEOUT = 5000;
const WARNING_FACTOR = 1.6;

function timeoutOf({ timeout, action, tone }: Entry) {
  const persist = action !== undefined || tone === "danger" || tone === "loading";
  return timeout ?? (persist ? 0 : tone === "warning" ? BASE_TIMEOUT * WARNING_FACTOR : BASE_TIMEOUT);
}

/** 显示一条提示，返回它的 key，可以传给 updateToast、closeToast。传了 id 且那条提示还在时，原地更新它。 */
export function toast({ id, ...options }: ToastOptions): string {
  const existing = id === undefined ? undefined : keysById.get(id);
  if (existing !== undefined) {
    replace(existing, options);
    return existing;
  }
  let key = "";
  key = queue.add(null, {
    onClose() {
      const entry = entries.get(key);
      entries.delete(key);
      timers.get(key)?.stop();
      timers.delete(key);
      if (id !== undefined && keysById.get(id) === key) keysById.delete(id);
      entry?.onClose?.();
    },
  });
  // queue.add 时还不知道 key，先没有内容：这时 ToastItem 渲染为空，下面 notify 后再渲染出来
  entries.set(key, { ...options, version: 0 });
  timers.set(key, new Timer(() => queue.close(key)));
  if (id !== undefined) keysById.set(id, key);
  notify();
  return key;
}

function replace(key: string, options: Omit<ToastOptions, "id">) {
  const prev = entries.get(key);
  if (!prev) return;
  entries.set(key, { ...options, version: prev.version + 1 });
  withTransition(notify);
}

function notify() {
  for (const fn of listeners) fn();
}

/**
 * 原地更新一条仍在显示的提示并重置计时；例如将“正在导出…”（`tone: "loading"`）更新为“导出完成”（`tone: "success"`）。
 */
export function updateToast(key: string, patch: Partial<Omit<ToastOptions, "id">>) {
  const prev = entries.get(key);
  if (!prev) return;
  // 只更新进度：原地改，版本不变（计时不重来、细线不重播），也不做 View Transition（每秒几十次会卡）
  if (Object.keys(patch).every((field) => PROGRESS_FIELDS.has(field))) {
    entries.set(key, { ...prev, ...patch });
    notify();
    return;
  }
  replace(key, { ...prev, ...patch });
}

/** 关闭一条提示。 */
export function closeToast(key: string) {
  queue.close(key);
}

type Message<T> = string | Omit<ToastOptions, "id" | "tone"> | ((value: T) => string | Omit<ToastOptions, "id" | "tone">);

export interface ToastPromiseMessages<T> {
  /** 进行中的提示，例如“正在导出…”。 */
  loading: string | Omit<ToastOptions, "id" | "tone">;
  /** 成功后的提示，支持传入函数接收异步结果。 */
  success: Message<T>;
  /** 失败后的提示，支持传入函数接收错误对象。 */
  error: Message<unknown>;
  /** 用于原地更新去重的标识，含义同 `ToastOptions.id`。 */
  id?: string;
}

/**
 * 跟着一个 promise 显示提示：进行中是 loading，完成后原地变成 success 或 danger。返回原来的 promise。
 * 用户提前关掉了提示，结果就不再显示。
 */
export function toastPromise<T>(promise: Promise<T>, { loading, success, error, id }: ToastPromiseMessages<T>): Promise<T> {
  const asOptions = (m: string | Omit<ToastOptions, "id" | "tone">) => (typeof m === "string" ? { title: m } : m);
  const key = toast({ ...asOptions(loading), id, tone: "loading" });
  const settle = <V,>(m: Message<V>, value: V, tone: "success" | "danger") => {
    if (entries.has(key)) replace(key, { ...asOptions(typeof m === "function" ? m(value) : m), tone });
  };
  promise.then(
    (value) => settle(success, value, "success"),
    (reason: unknown) => settle(error, reason, "danger"),
  );
  return promise;
}

const ICONS = {
  neutral: <InfoIcon />,
  success: <CircleCheckIcon />,
  warning: <TriangleAlertIcon />,
  danger: <CircleAlertIcon />,
  loading: <Spinner />,
};

/** 提示出现的位置：top 是顶部居中，bottom-end 是右下角（从右往左的语言里是左下角）。 */
export type ToastPlacement = "top" | "bottom-end";

const PlacementContext = createContext<ToastPlacement>("top");
const subscribeToVisibility = (listener: () => void) => queue.subscribe(listener);
const hasVisibleToasts = () => queue.visibleToasts.length > 0;

export interface ToastRegionProps {
  /**
   * 读屏读出的区域名称。
   * @default "通知"（英文界面 "Notifications"）
   */
  "aria-label"?: string;
  /**
   * 提示出现的位置。默认顶部居中：用户正在看的地方附近，一眼能看到；右下角容易被忽略，适合不打扰的后台通知。
   * 最新的一条总是离屏幕边缘最近。
   * @default "top"
   */
  placement?: ToastPlacement;
}

/**
 * 提示区域容器，默认固定在屏幕顶部居中并最多同时展示 3 条提示；通常已由 `UIProvider` 内置渲染。
 * 基于 React Aria `ToastRegion` 封装，作为地标区域支持 `F6` 快速跳转、悬停或聚焦暂停计时，并在关闭最后一条后自动归还焦点。
 */
export function ToastRegion({ "aria-label": ariaLabel, placement = "top" }: ToastRegionProps) {
  const t = useStrings(toastStrings);
  const visible = useSyncExternalStore(subscribeToVisibility, hasVisibleToasts, () => false);
  // 标签页切到后台时暂停计时，回来接着倒数：用户没看到的提示不该在后台悄悄消失
  useEffect(() => {
    const sync = () => queue.setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => {
    // 被聚焦或悬停的最后一条卸载时不一定有 blur/leave；不要让下一批继承交互暂停。后台暂停仍由 hidden 保留。
    if (!visible) queue.resumeAll();
  }, [visible]);
  // RAC 挂载时按 DOM ref 登记 F6 地标；空队列没有 DOM，之后出现第一条也不会因同名而重新登记。
  if (!visible) return null;
  return (
    <PlacementContext value={placement}>
      <AriaToastRegion queue={queue} aria-label={ariaLabel ?? t.region} className="ui-toast-region" data-placement={placement}>
        {({ toast: item }) => <ToastItem item={item} />}
      </AriaToastRegion>
    </PlacementContext>
  );
}

function ToastItem({ item }: { item: QueuedToast<null> }) {
  const t = useStrings(toastStrings);
  const placement = useContext(PlacementContext);
  const entry = useSyncExternalStore(
    subscribe,
    () => entries.get(item.key),
    () => entries.get(item.key),
  );
  const ms = entry ? timeoutOf(entry) : 0;
  const paused = useSyncExternalStore(
    subscribe,
    () => queue.paused,
    () => false,
  );
  const version = entry?.version;

  // 显示出来才开始计时；内容更新后重新计时
  useEffect(() => {
    const timer = timers.get(item.key);
    if (!timer || version === undefined) return;
    timer.reset(ms, queue.paused);
    return () => timer.pause();
  }, [item.key, ms, version]);

  if (!entry) return null;
  const { title, description, tone = "neutral", action, progress, progressLabel } = entry;
  const showProgress = tone === "loading" && progress !== undefined && Number.isFinite(progress);
  // 进场方向跟着位置：在顶部时从上往下落，在底部时从下往上升（view-transition 伪元素只能按类区分）
  const enterFrom = placement === "top" ? "ui-toast-from-top" : "ui-toast-from-bottom";
  return (
    <AriaToast
      toast={item}
      className="ui-toast-slot"
      // 每条提示一个独立的 view-transition-name，进出场和其他提示的位移都能动起来
      style={{ viewTransitionName: `ui-toast-${item.key.replace(/[^\w-]/g, "")}`, viewTransitionClass: `ui-toast ${enterFrom}` } as CSSProperties}
    >
      <SwipeCard itemKey={item.key} placement={placement} tone={tone} paused={paused}>
      <DragHandle>
        <span className="ui-toast__icon" aria-hidden="true">
          {ICONS[tone]}
        </span>
        <div className="ui-toast__body">
          <AriaToastContent className="ui-toast__content">
            <Text slot="title" className="ui-toast__title">
              {title}
            </Text>
            {description ? (
              <Text slot="description" className="ui-toast__description">
                {description}
              </Text>
            ) : null}
          </AriaToastContent>
          {/* 进度条放在会播报的内容外面：数值每变一次读屏都读一遍会很吵；需要时读屏用户可以自己去读进度条 */}
          {showProgress ? (
            <ProgressBar className="ui-toast__progress" aria-label={title}
              value={Math.min(1, Math.max(0, progress)) * 100} valueLabel={progressLabel} />
          ) : null}
        </div>
      </DragHandle>
      {action ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            action.onAction();
            queue.close(item.key);
          }}
        >
          {action.label}
        </Button>
      ) : null}
      <Button slot="close" className="ui-toast__close" variant="ghost" size="sm" icon={<XIcon />} aria-label={t.close} />
      {/* 还有多久自动关闭：一条细线从满缩到空，和计时一起暂停；内容更新后重新开始。不会自动关闭的提示没有 */}
      {ms > 0 ? <span key={version} className="ui-toast__countdown" aria-hidden="true" style={{ "--ui-toast-timeout": `${ms}ms` } as CSSProperties} /> : null}
      </SwipeCard>
    </AriaToast>
  );
}

/** 往里拖（只有在屏幕角落时才分“里外”）的阻力：只跟手这么多比例 */
const INWARD_ELASTIC = 0.08;

const DragContext = createContext<DragControls | null>(null);

/**
 * 能横着拖走的卡片（Motion 的 drag）：跟手、渐隐；拖过 40% 宽度或快速一甩，松手就飞出去关掉，否则用弹簧弹回。
 * 顶部居中时往左往右都能甩；在角落时只有往屏幕边缘甩才关，往里拖有阻力。拖动期间这条提示暂停计时。
 * 只有图标和文字那一块（DragHandle）能开始拖，点按钮不会触发拖动。键盘用关闭按钮或 Esc（React Aria 处理）。
 */
function SwipeCard({
  itemKey,
  placement,
  tone,
  paused,
  children,
}: {
  itemKey: string;
  placement: ToastPlacement;
  tone: NonNullable<ToastOptions["tone"]>;
  paused: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const m = useMotionTokens();
  const { direction } = useLocale();
  const controls = useDragControls();
  const x = useMotionValue(0);
  const [swiping, setSwiping] = useState(false);
  const width = () => ref.current?.offsetWidth || 360;
  const opacity = useTransform(x, (v) => 1 - Math.min(1, Math.abs(v) / width()));
  // 角落里的提示："往外"是 inline-end 一侧（LTR 往右）
  const out = direction === "rtl" ? -1 : 1;
  const bothWays = placement === "top";
  const elastic = bothWays ? 1 : out === 1 ? { left: INWARD_ELASTIC, right: 1 } : { left: 1, right: INWARD_ELASTIC };
  return (
    <DragContext value={controls}>
      <motion.div
        ref={ref}
        className="ui-toast"
        data-tone={tone}
        data-paused={paused || undefined}
        data-swiping={swiping || undefined}
        style={{ x, opacity }}
        drag="x"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={elastic}
        dragMomentum={false}
        onDragStart={() => {
          setSwiping(true);
          timers.get(itemKey)?.pause();
        }}
        // Motion 松手时先播自己的回弹，下一帧才调这里：在同一个 x 上接着播，接管它
        onDragEnd={(_, info) => {
          setSwiping(false);
          const dx = x.get();
          const side = Math.sign(dx);
          const allowed = bothWays || side === out;
          const flung = Math.abs(info.velocity.x) > 500 && Math.sign(info.velocity.x) === side && Math.abs(dx) > 24;
          if (side !== 0 && allowed && (Math.abs(dx) > width() * 0.4 || flung)) {
            // 飞出去：从当前位置接着往同一边滑、淡出，播完再关掉
            void animate(x, side * (width() + 32), { duration: m.duration.fast, ease: m.ease.exit }).then(() => queue.close(itemKey));
            return;
          }
          // 弹回原位：接着松手时的速度走（springGesture），不从静止重新起步
          void animate(x, 0, m.springGesture);
          if (!queue.paused) timers.get(itemKey)?.resume();
        }}
      >
        {children}
      </motion.div>
    </DragContext>
  );
}

/** 图标和文字这一块：按下就交给 SwipeCard 开始拖 */
function DragHandle({ children }: { children: ReactNode }) {
  const controls = useContext(DragContext);
  return (
    // eslint-disable-next-line ui/no-raw-interactive -- 拖动手势的起点，不是按钮；键盘用关闭按钮或 Esc 关掉提示
    <div className="ui-toast__main" onPointerDown={(e) => controls?.start(e)}>
      {children}
    </div>
  );
}

/** 文档站示例和测试用：清空所有提示（包括排队的）。 */
export function clearToasts() {
  while (queue.visibleToasts.length > 0) {
    for (const t of [...queue.visibleToasts]) queue.close(t.key);
  }
}
