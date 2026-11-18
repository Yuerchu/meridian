"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useStrings } from "../../lib/i18n";
import { kbdStrings } from "./kbd.strings";
import "./kbd.css";

/**
 * 按键：在说明文字里展示键盘按键或组合键，例如"按 ⌘ K 打开搜索"。
 * 菜单项里的快捷键提示用 MenuItem 的 shortcut，不用自己放 Kbd。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

/** 读屏会把这些符号读成"位置标志"之类，换成按键名称 */
const KEY_NAMES: Record<string, string> = {
  "⌘": "Command",
  "⌥": "Option",
  "⇧": "Shift",
  "⌃": "Control",
  "↵": "Enter",
  "⏎": "Enter",
  "⌫": "Backspace",
  "⌦": "Delete",
  "⎋": "Esc",
  "⇥": "Tab",
};

/** 方向键的名称跟着语言 */
const ARROWS: Record<string, "up" | "down" | "left" | "right"> = { "↑": "up", "↓": "down", "←": "left", "→": "right" };

export interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** 单个按键，例如 "Esc"。写了 keys 时忽略。 */
  children?: ReactNode;
  /** 组合键，按顺序列出，例如 ["⌘", "K"]。每个键单独一格。 */
  keys?: string[];
  /** 指向外层的 kbd 元素。 */
  ref?: Ref<HTMLElement>;
}

function Key({ value }: { value: string }) {
  const t = useStrings(kbdStrings);
  const arrow = ARROWS[value];
  const name = arrow ? t[arrow] : KEY_NAMES[value];
  return (
    <kbd className="ui-kbd__key">
      {name ? (
        <>
          <span aria-hidden="true">{value}</span>
          <span className="ui-kbd__name">{name}</span>
        </>
      ) : (
        value
      )}
    </kbd>
  );
}

/**
 * 按键。组合键按 HTML 规范写成嵌套的 kbd；⌘ ⇧ ⌥ 这类符号对读屏换成按键名称。
 */
export function Kbd({ keys, children, className, ...props }: KbdProps) {
  const cls = className ? `ui-kbd ${className}` : "ui-kbd";
  if (!keys) {
    return (
      <kbd {...props} className={cls}>
        {typeof children === "string" ? <Key value={children} /> : <kbd className="ui-kbd__key">{children}</kbd>}
      </kbd>
    );
  }
  return (
    <kbd {...props} className={cls}>
      {keys.map((k, i) => (
        <Key key={`${k}-${i}`} value={k} />
      ))}
    </kbd>
  );
}
