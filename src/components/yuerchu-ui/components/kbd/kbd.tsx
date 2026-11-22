"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useStrings } from "../../lib/i18n";
import { kbdStrings } from "./kbd.strings";
import "./kbd.css";

/**
 * 用于在行内说明或文档中展示键盘按键与组合快捷键。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

/** 读屏会将此类符号读成“位置标志”等无意义字符，渲染时替换为标准按键名称 */
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

/** 方向键的名称跟随当前语言环境 */
const ARROWS: Record<string, "up" | "down" | "left" | "right"> = { "↑": "up", "↓": "down", "←": "left", "→": "right" };

export interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** 单个按键文本（如 `Esc`）；传入 `keys` 时会忽略此属性。 */
  children?: ReactNode;
  /** 组合键数组，按按下顺序排列（如 `["⌘", "K"]`），每个键独立渲染为一格。 */
  keys?: string[];
  /** 根元素引用。 */
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
 * 按键展示组件，遵循 HTML 嵌套 `<kbd>` 规范，并将修饰键与方向键符号映射为可读屏识别的按键名称。
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
