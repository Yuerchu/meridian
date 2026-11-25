"use client";

/*
 * GridListItem 的滑动操作：触屏、手写笔横向滑一行，露出这一行的操作；滑得够远直接执行最外侧的那个。
 * 鼠标不滑（会和选中、拖动排序、选文字冲突）：所有滑动操作同时出现在行末的"更多操作"菜单里，键盘、鼠标、读屏都从菜单用。
 */
import { animate, motion, useDragControls, useMotionValue } from "motion/react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "react-aria";
import { Button as AriaButton } from "react-aria-components";
import { useMotionTokens } from "../../lib/motion";

export interface SwipeAction {
  /** 操作唯一标识，菜单项也复用该标识。 */
  id: string;
  /** 操作名称，建议使用动词，例如“归档”“删除”。 */
  label: string;
  /** 操作按钮上的装饰性图标，文本标签仍会正常显示。 */
  icon?: ReactNode;
  /**
   * 按钮语义色调，`danger` 用于删除等高风险操作。
   * @default "neutral"
   */
  tone?: "neutral" | "accent" | "danger";
  /** 点击或滑满后执行的回调；通常在此从列表数据中移除当前行。 */
  onAction: () => void;
  /** 执行后若该行仍保留在列表中（例如“标为未读”），设为 true 使行滑满后弹回原位。 */
  keepsRow?: boolean;
}

export interface SwipeActionsConfig {
  /** 从行的开头一侧滑出来的操作（LTR 是往右滑）。第一个在最外侧，滑满时执行它。 */
  leading?: SwipeAction[];
  /** 从行的结尾一侧滑出来的操作（LTR 是往左滑）。第一个在最外侧，滑满时执行它。 */
  trailing?: SwipeAction[];
}

/** 一个滑出来的按钮的宽度（px） */
const ACTION_WIDTH = 72;
/** 滑过行宽的这个比例，松手就执行最外侧的操作 */
const COMMIT_RATIO = 0.6;

/** 同一时间只展开一行：记住当前展开的那一行怎么收回去 */
let closeOpenRow: (() => void) | null = null;

/**
 * 可以横向滑动的一层，盖在操作按钮上面。行的内容都放在这一层里。
 */
export function SwipeRow({ config, children }: { config: SwipeActionsConfig; children: ReactNode }) {
  const m = useMotionTokens();
  const { direction } = useLocale();
  // 逻辑方向：开头一侧在 LTR 是左边。x 为正（往右）时露出的是开头一侧的操作
  const dir = direction === "rtl" ? -1 : 1;
  const ref = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const x = useMotionValue(0);
  // 操作按钮只在滑动、展开时挂载：平时不在 DOM 里，键盘在行里移动焦点时不会走到它们
  const [revealed, setRevealed] = useState<"leading" | "trailing" | null>(null);
  const leading = config.leading ?? [];
  const trailing = config.trailing ?? [];

  const settle = (target: number) => {
    void animate(x, target, m.springGesture).then(() => {
      if (target === 0 && x.get() === 0) setRevealed(null);
    });
  };
  const close = () => {
    if (closeOpenRow === close) closeOpenRow = null;
    settle(0);
  };

  const run = (action: SwipeAction, side: number) => {
    if (closeOpenRow === close) closeOpenRow = null;
    if (action.keepsRow) {
      settle(0);
      action.onAction();
      return;
    }
    // 滑出去，播完再执行（一般会把这一行从数据里去掉）
    const width = ref.current?.offsetWidth ?? 360;
    void animate(x, side * (width + 32), { duration: m.duration.fast, ease: m.ease.exit }).then(() => action.onAction());
  };

  // 展开时点别处：收回去
  useEffect(() => {
    if (!revealed) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  });

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") return;
    controls.start(e);
  };

  const side = revealed === "leading" ? leading : revealed === "trailing" ? trailing : [];
  return (
    <>
      {revealed && side.length ? (
        // 读屏和键盘用行末的菜单：这里对读屏隐藏，按钮不在 Tab 顺序里
        <div className="ui-grid-list-swipe" data-side={revealed} aria-hidden="true">
          {(revealed === "leading" ? side : [...side].reverse()).map((action) => (
            <AriaButton
              key={action.id}
              className="ui-grid-list-swipe__action"
              data-tone={action.tone ?? "neutral"}
              excludeFromTabOrder
              onPress={() => run(action, revealed === "leading" ? dir : -dir)}
            >
              {action.icon}
              <span>{action.label}</span>
            </AriaButton>
          ))}
        </div>
      ) : null}
      {/* 只在触屏、手写笔按下时开始拖动（Motion 的 dragControls），点按和键盘仍由 React Aria 的行处理 */}
      <motion.div
        ref={ref}
        className="ui-grid-list-item__slide"
        style={{ x }}
        drag="x"
        dragListener={false}
        dragControls={controls}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={1}
        dragMomentum={false}
        onPointerDown={onPointerDown}
        onDragStart={(e) => {
          if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
          // 这次是滑动，不是点按：取消 React Aria 行上已经开始的按下（否则松手会选中或打开这一行）
          const row = ref.current?.closest("[role=row]");
          if (row && typeof PointerEvent !== "undefined" && "pointerId" in e) {
            row.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: e.pointerId }));
          }
        }}
        onDrag={() => {
          const logical = x.get() * dir;
          const next = logical > 0 ? "leading" : logical < 0 ? "trailing" : null;
          if (next !== revealed && next) setRevealed(next);
        }}
        onDragEnd={(_, info) => {
          const dx = x.get();
          const logical = dx * dir;
          const actions = logical > 0 ? leading : trailing;
          const width = ref.current?.offsetWidth ?? 360;
          const open = actions.length * ACTION_WIDTH;
          const sign = Math.sign(dx);
          const flung = Math.abs(info.velocity.x) > 800 && Math.sign(info.velocity.x) === sign;
          if (actions.length === 0 || logical === 0) return settle(0);
          if (Math.abs(dx) > width * COMMIT_RATIO || (flung && Math.abs(dx) > open)) return run(actions[0]!, sign);
          if (Math.abs(dx) > open / 2) {
            closeOpenRow = close;
            return settle(sign * open);
          }
          settle(0);
        }}
      >
        {children}
      </motion.div>
    </>
  );
}
