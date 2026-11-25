"use client";

/*
 * 文字的增量替换：新旧两段文字里相同的字留下来，平移到新位置；只有不同的字退场或进场。
 * 例如"复制链接"→"已复制"：链、接淡出，已淡入，复制往右挪到新位置。
 *
 * 动画全部交给 Motion（layout 平移、AnimatePresence 进出），这里只负责算"哪些字是同一个字"：
 * 对新旧两串字做最长公共子序列，配上的字沿用原来的 key，其余的字换新 key。
 */
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { Ref } from "react";
import { useState } from "react";
import { VisuallyHidden } from "react-aria";
import type { MotionTokens } from "./motion";

export interface MorphChar {
  /** 一个字（按字素切分：emoji、组合字符不会被拆开） */
  char: string;
  /** 动画用的 key：同一个字在新旧文字里 key 相同 */
  key: string;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/**
 * 给新文字的每个字分配 key：和旧文字的最长公共子序列里配上的字沿用旧 key，其余用 `${version}:${序号}`。
 * version 每次换文字加 1，保证新 key 不和任何旧 key 重复。
 */
export function morphKeys(previous: readonly MorphChar[], text: string, version: number): MorphChar[] {
  const next = graphemes(text);
  const n = previous.length;
  const m = next.length;
  // lcs[i][j]：previous[i..] 和 next[j..] 的最长公共子序列长度
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = previous[i]!.char === next[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: MorphChar[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && previous[i]!.char === next[j]) {
      out.push(previous[i]!);
      i++;
      j++;
    } else if (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i++;
    } else {
      out.push({ char: next[j]!, key: `${version}:${j}` });
      j++;
    }
  }
  return out;
}

/**
 * 每个字进场前等多久（秒）：这一版新出现的字按阅读顺序一个比一个晚 stagger.char（不管它们在词里的哪个位置），
 * 总时长不超过 staggerMax；留下的字不等。减弱模式下 stagger 为 0，一起出现。
 */
export function staggerDelays(chars: readonly MorphChar[], version: number, m: Pick<MotionTokens, "stagger" | "staggerMax">): number[] {
  const fresh = `${version}:`;
  let order = 0;
  return chars.map((c) => (c.key.startsWith(fresh) ? Math.min(order++ * m.stagger.char, m.staggerMax) : 0));
}

/**
 * 增量替换的文字。读屏读的是完整文字（视觉上隐藏的一份），逐字动画的那份对读屏隐藏，所以动画过程中名称始终是新文字。
 * 逐字的那份把字画在 CSS 生成内容里（data-char），DOM 里的真文字只有一份：textContent、复制、页内查找都不会重复。
 * 动效数值由调用方传入（useMotionTokens()），减弱动效时位移和模糊为 0、平移直接到位，只剩淡入淡出。
 */
export function TextMorph({ text, m, className }: { text: string; m: MotionTokens; className?: string }) {
  const [state, setState] = useState(() => ({ text, version: 0, chars: morphKeys([], text, 0) }));
  let { chars, version } = state;
  if (state.text !== text) {
    // 文字变了：在渲染里直接算出新的 key（React 推荐的"根据 props 调整 state"写法），不多渲染一轮旧文字
    version = state.version + 1;
    chars = morphKeys(state.chars, text, version);
    setState({ text, version, chars });
  }
  const delays = staggerDelays(chars, version, m);
  return (
    <span className={className}>
      <VisuallyHidden>{text}</VisuallyHidden>
      {/* 样式在 styles/base.css：字画在 ::before 里，textContent 只有上面那一份真文字 */}
      <span className="ui-text-morph" aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false}>
          {chars.map((c, i) => (
            <Char key={c.key} char={c.char} m={m} delay={delays[i]!} />
          ))}
        </AnimatePresence>
      </span>
    </span>
  );
}

function Char({ char, m, delay, ref }: { char: string; m: MotionTokens; delay: number; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  const blur = `blur(${m.swapBlur}px)`;
  return (
    <motion.span
      ref={ref}
      className="ui-text-morph__char"
      data-char={char}
      // 留下来的字只平移，不跟着容器宽度缩放
      layout={present ? "position" : false}
      initial={{ opacity: 0, y: m.swapDistance, filter: blur }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      // 离开用 standard 曲线：exit 先慢后快，旧字会在原地停留半程
      exit={{ opacity: 0, y: -m.swapDistance, filter: blur, transition: { duration: m.duration.fast, ease: m.ease.standard } }}
      // 新字的透明度和留下的字的平移用同一条弹簧：留下的字让开多少，新字就显出多少，不会叠在一起
      // （透明度用快的补间时，新字已经显出来了，旁边的字才刚开始挪）。模糊不能用弹簧（回弹会变成负值）
      // 再晚半个按下时长（60ms）开始，最初几帧旁边的字还没让开时新字完全不显
      transition={{
        default: m.spring,
        layout: m.spring,
        opacity: { ...m.spring, delay: m.duration.instant / 2 + delay },
        filter: { duration: m.duration.standard, ease: m.ease.standard, delay: m.duration.instant / 2 + delay },
      }}
    />
  );
}
