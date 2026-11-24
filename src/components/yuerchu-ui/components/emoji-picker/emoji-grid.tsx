"use client";

import type { EmojiPickerListEmojiProps, EmojiPickerListRowProps } from "frimousse";
import { useActiveEmoji } from "frimousse";
import { useLayoutEffect, type RefObject } from "react";

// frimousse 0.4 的内部坐标从 0 起，ARIA 从 1 起。隐藏的测量行没有行号，不给它补一个。
function Row({ "aria-rowindex": index, ...props }: EmojiPickerListRowProps) {
  return <div {...props} {...(index == null ? {} : { "aria-rowindex": index + 1 })} />;
}

function Cell({ emoji, "aria-colindex": index, ...props }: EmojiPickerListEmojiProps) {
  return (
    // eslint-disable-next-line ui/no-raw-interactive -- frimousse 要把 gridcell 的原生指针事件和 tabIndex 交给同一个按钮
    <button {...props} type="button" className="ui-emoji-picker__cell"
      {...(index == null ? {} : { "aria-colindex": index + 1 })}>
      {emoji.emoji}
    </button>
  );
}

export const emojiGridParts = { Row, Emoji: Cell };

/** 0.4 用零基行号查询 DOM，改成一基后可能滚到了上一行。只校正键盘活动格，不滚动页面。 */
function revealActiveEmoji(viewport: HTMLElement | null) {
  if (!viewport) return;
  const cell = viewport.querySelector('[role="row"] [role="gridcell"][data-active]');
  if (!cell) return;
  const clip = viewport.getBoundingClientRect();
  if (!clip.height) return;
  const header = viewport.querySelector("[frimousse-category-header]");
  const top = clip.top + (header?.getBoundingClientRect().height ?? 0);
  const rect = cell.getBoundingClientRect();
  const delta = rect.top < top ? rect.top - top : Math.max(0, rect.bottom - clip.bottom);
  if (Math.abs(delta) > 0.5) viewport.scrollTop += delta * viewport.offsetHeight / clip.height;
}

/** 等活动格提交到 DOM 再量；在 keydown 里排一帧仍可能量到旧格。 */
export function KeyboardScroll({ viewport, keyboard }: {
  viewport: RefObject<HTMLDivElement | null>;
  keyboard: RefObject<boolean>;
}) {
  const active = useActiveEmoji();
  useLayoutEffect(() => {
    if (active && keyboard.current) revealActiveEmoji(viewport.current);
  }, [active, keyboard, viewport]);
  return null;
}
