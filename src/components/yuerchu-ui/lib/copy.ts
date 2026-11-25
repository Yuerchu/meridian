"use client";

/*
 * 复制到剪贴板。组件里需要"复制"按钮时用 useCopy，不要各自调用 navigator.clipboard：
 * - navigator.clipboard 只在 HTTPS 和 localhost 上有，其他情况（内网 http、部分 WebView）要退回 execCommand；
 * - 成功和失败都要让人知道：按钮换图标 / 文字，并且读屏播报（失败用 assertive）。
 */
import { useEffect, useRef, useState } from "react";
import { announce } from "./announce";
import { copyStrings } from "./copy.strings";
import { useStrings } from "./i18n";

/**
 * 写入剪贴板。优先用 navigator.clipboard（非安全上下文里浏览器不提供它）；没有它、或者它被拒绝（权限、焦点不在页面）时，
 * 退回 execCommand("copy")；都失败时抛错。
 */
export async function copyText(text: string): Promise<void> {
  // eslint-disable-next-line ui/no-direct-clipboard -- 这里就是统一的复制实现
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // 继续尝试 execCommand
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand?.("copy")) throw new Error("复制失败");
  } finally {
    area.remove();
  }
}

export type CopyState = "idle" | "copied" | "error";

/**
 * 复制按钮的状态：copy() 之后 state 是 copied 或 error，过 resetAfter 毫秒回到 idle；同时播报结果。
 * text 可以是函数（复制时才取，可以返回 Promise）。
 */
export function useCopy({ resetAfter = 1600 }: { resetAfter?: number } = {}) {
  const [state, setState] = useState<CopyState>("idle");
  const t = useStrings(copyStrings);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (
    text: string | (() => string | Promise<string>),
    messages: { done?: string; failed?: string } = {},
  ): Promise<boolean> => {
    clearTimeout(timer.current);
    let ok = true;
    try {
      await copyText(typeof text === "function" ? await text() : text);
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "error");
    if (ok) announce(messages.done ?? t.done);
    else announce(messages.failed ?? t.failed, "assertive");
    timer.current = setTimeout(() => setState("idle"), resetAfter);
    return ok;
  };

  return { state, copy };
}
