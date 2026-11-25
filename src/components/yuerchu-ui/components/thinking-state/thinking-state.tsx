"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DisclosureProps as AriaDisclosureProps } from "react-aria-components";
import { Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { ChevronRightIcon } from "../../lib/icons";
import { useFormatDuration } from "../../lib/format";
import { thinkingStateStrings } from "./thinking-state.strings";
import "./thinking-state.css";

/**
 * 展示模型推理过程中的实时思考状态与耗时，并在推理结束后支持展开查看推理细节。
 *
 * @packageDocumentation
 * @category AI
 * @status 实验中
 */

export interface ThinkingStateProps extends Omit<AriaDisclosureProps, "children" | "className" | "style"> {
  /** 当前推理状态：`thinking` 为思考中，`done` 为已完成，`stopped` 为中途停止。 */
  status: "thinking" | "done" | "stopped";
  /** 思考耗时（秒）。未传入时在思考中从挂载起按秒计时，结束时定格。 */
  duration?: number;
  /** 推理过程正文，支持在思考中流式追加；未传入时不显示展开按钮。 */
  children?: ReactNode;
  /** 自定义根元素类名。 */
  className?: string;
}

/**
 * 基于 Disclosure 渲染可展开的思考状态条，支持思考中自动跟随最新内容、完成后自动收起及单次结果播报。
 *
 * @promote status, duration, isExpanded, defaultExpanded, onExpandedChange
 */
export function ThinkingState({ status, duration, children, className, isExpanded, defaultExpanded, onExpandedChange, ...props }: ThinkingStateProps) {
  const t = useStrings(thinkingStateStrings);
  const { formatDuration } = useFormatDuration();
  const isThinking = status === "thinking";
  const elapsed = useElapsed(isThinking, duration);
  const seconds = duration ?? elapsed;
  const label = isThinking
    ? seconds >= 1
      ? t.thinkingFor({ time: formatDuration(seconds) })
      : t.thinking
    : status === "stopped"
      ? t.stoppedWhile
      : seconds >= 1
        ? t.thoughtFor({ time: formatDuration(seconds) })
        : t.thought;

  // 展开：用户手动操作过（manual）以用户为准；否则思考中展开、结束后收起。使用方传了 isExpanded 时完全受控
  const [manual, setManual] = useState<boolean | null>(defaultExpanded ?? null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 只在"思考中 → 结束 / 停止"时播报一次；一出现就是结束状态（历史消息）不播报
  const wasThinking = useRef(isThinking);
  useEffect(() => {
    if (isThinking) wasThinking.current = true;
    else if (wasThinking.current) {
      wasThinking.current = false;
      announce(status === "stopped" ? t.stopped : seconds >= 1 ? t.doneIn({ time: formatDuration(seconds) }) : t.done);
    }
  }, [isThinking, status, seconds]);

  const content = (
    <span className="ui-thinking-state__label" data-shimmer={status === "thinking" ? "" : undefined}>
      {label}
    </span>
  );
  // 推理过程常常是空的，后面才流进来：面板一开始就要渲染，后挂载的面板 React Aria 不会给它加 hidden（收起时也会显示出来）
  const hasReasoning = children !== undefined && children !== null && children !== false && children !== "";
  const expanded = hasReasoning && (isExpanded ?? manual ?? isThinking);
  // 自动展开时只露出最新的几行；手动展开时显示全部
  const clamped = isExpanded === undefined && manual !== true;

  // 思考中推理过程不断追加：保持滚到最新一行；超出 4 行时顶部才淡出（不够 4 行时第一行不该变淡）
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    setOverflowing(clamped && node.scrollHeight > node.clientHeight + 1);
    if (isThinking && clamped) node.scrollTop = node.scrollHeight;
  }, [children, isThinking, clamped, expanded]);

  return (
    <AriaDisclosure
      {...props}
      isExpanded={expanded}
      onExpandedChange={(next) => {
        setManual(next);
        onExpandedChange?.(next);
      }}
      className={className ? `ui-thinking-state ${className}` : "ui-thinking-state"}
      data-status={status}
    >
      {hasReasoning ? (
        <AriaButton slot="trigger" className="ui-thinking-state__trigger">
          {content}
          <span className="ui-thinking-state__chevron" aria-hidden="true">
            <ChevronRightIcon />
          </span>
        </AriaButton>
      ) : (
        <div className="ui-thinking-state__trigger">{content}</div>
      )}
      <DisclosurePanel className="ui-thinking-state__panel">
        {hasReasoning ? (
          <div
            ref={panelRef}
            className="ui-thinking-state__content"
            data-clamped={clamped || undefined}
            data-overflowing={overflowing || undefined}
          >
            {children}
          </div>
        ) : null}
      </DisclosurePanel>
    </AriaDisclosure>
  );
}

/** 思考中且没有给 duration 时，从出现开始每秒计时；结束后停在最后的值 */
function useElapsed(isRunning: boolean, given: number | undefined) {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (given !== undefined || !isRunning) return;
    start.current ??= Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start.current!) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, given]);
  return elapsed;
}
