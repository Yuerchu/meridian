"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mergeProps, useFocusWithin, useHover } from "react-aria";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "../../lib/icons";
import { useCopy } from "../../lib/copy";
import { Button } from "../button/button";
import { HoverCard } from "../hover-card/hover-card";
import { Link } from "../link/link";
import { useStrings } from "../../lib/i18n";
import { citationStrings } from "./citation.strings";
import "./citation.css";

/**
 * 在回复正文中插入编号角标，悬停或聚焦时弹出预览卡片，并与下方来源列表联动高亮。
 * 使用 `Sources` 包裹正文与 `SourceList` 共享来源数据；配合 `CitedSentence` 可按句标注出处并高亮引文中的支撑词。
 *
 * @packageDocumentation
 * @category AI
 * @status 实验中
 */

export interface Source {
  /** 来源的唯一标识，供 `CitedSentence` 的 `cite` 按标识引用。 */
  id?: string;
  /** 来源标题。 */
  title: string;
  /** 来源链接地址。 */
  url: string;
  /** 简短摘要，展示在角标的悬浮预览卡片中。 */
  snippet?: string;
  /** 原文引文；配置后可在预览卡片与来源列表展开的“摘录”中展示。 */
  quote?: string;
  /** 需要在引文中标出的关键词；未传入时自动高亮引文与引用句共用的词。 */
  highlight?: string[];
  /** 发布日期，例如“2026-10-12”，展示在展开的摘录面板中。 */
  date?: string;
}

interface SentenceInfo {
  cites: number[];
  text: string;
}

interface SourcesState {
  sources: Source[];
  /** 当前悬停或聚焦的来源编号 */
  active: number | null;
  /** 当前悬停或聚焦角标所属的句子 ID（位于来源列表时为 null） */
  activeSentence: string | null;
  setActive: (n: number | null, sentence?: string | null) => void;
  sentences: Map<string, SentenceInfo>;
  register: (id: string, info: SentenceInfo) => void;
  unregister: (id: string) => void;
}

const SourcesContext = createContext<SourcesState | null>(null);

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export interface SourcesProps {
  /** 来源列表，按顺序对应角标 `[1]`、`[2]`……。 */
  sources: Source[];
  /** 正文（含 `Citation`、`CitedSentence` 或 `Markdown`）与 `SourceList`。 */
  children?: ReactNode;
}

/** 来源上下文容器，向正文角标与来源列表提供来源数据并同步悬停或聚焦高亮状态。 */
export function Sources({ sources, children }: SourcesProps) {
  const [pointer, setPointer] = useState<{ active: number | null; sentence: string | null }>({ active: null, sentence: null });
  const [sentences, setSentences] = useState<Map<string, SentenceInfo>>(() => new Map());
  const setActive = useCallback((active: number | null, sentence: string | null = null) => setPointer({ active, sentence: active === null ? null : sentence }), []);
  const register = useCallback((id: string, info: SentenceInfo) => {
    // 文字和出处都没变时不更新，免得每次渲染都让所有角标重新渲染
    setSentences((m) => {
      const old = m.get(id);
      return old && old.text === info.text && old.cites.join() === info.cites.join() ? m : new Map(m).set(id, info);
    });
  }, []);
  const unregister = useCallback((id: string) => {
    setSentences((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({ sources, active: pointer.active, activeSentence: pointer.sentence, setActive, sentences, register, unregister }),
    [sources, pointer, setActive, sentences, register, unregister],
  );
  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>;
}

/** 悬停或聚焦时把 n 设为当前（在句子里时连同这一句），离开时清掉 */
function useActivate(n: number, sentence: string | null = null) {
  const ctx = useContext(SourcesContext);
  const leave = () => ctx?.setActive(null);
  const { hoverProps } = useHover({ onHoverStart: () => ctx?.setActive(n, sentence), onHoverEnd: leave });
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: (f) => (f ? ctx?.setActive(n, sentence) : leave()) });
  return { props: mergeProps(hoverProps, focusWithinProps), isActive: ctx?.active === n };
}

/** cite 里的编号或 id 换成编号（从 1 开始）；找不到的是 0 */
const indexOf = (sources: Source[], cite: number | string) => (typeof cite === "number" ? cite : sources.findIndex((s) => s.id === cite) + 1);

const SentenceContext = createContext<string | null>(null);

export interface CitedSentenceProps {
  /** 本句引用的来源编号（从 1 开始）或来源 `id` 列表，角标按顺序紧跟在句子末尾。 */
  cite: (number | string)[];
  /** 句子正文内容。 */
  children: ReactNode;
}

/**
 * 带出处的句子容器，在句末渲染对应角标；悬停或聚焦角标与来源项时联动高亮相关句子，并在预览与摘录中标记共用的支撑词。
 */
export function CitedSentence({ cite, children }: CitedSentenceProps) {
  const ctx = useContext(SourcesContext);
  const id = useId();
  const textRef = useRef<HTMLSpanElement>(null);
  const indexes = cite.map((c) => indexOf(ctx?.sources ?? [], c)).filter((n) => n > 0);
  const key = indexes.join(",");
  const register = ctx?.register;
  // 记下这一句的文字和出处：来源列表要知道哪些句子引用了它
  useLayoutEffect(() => {
    register?.(id, { cites: key ? key.split(",").map(Number) : [], text: textRef.current?.textContent ?? "" });
  }, [register, id, key, children]);
  const unregister = ctx?.unregister;
  useLayoutEffect(() => () => unregister?.(id), [unregister, id]);
  const lit = Boolean(ctx && ctx.active !== null && (ctx.activeSentence === id || (ctx.activeSentence === null && indexes.includes(ctx.active))));
  return (
    <SentenceContext.Provider value={id}>
      <span className="ui-cited" data-active={lit || undefined}>
        <span ref={textRef} className="ui-cited__text">
          {children}
        </span>
        {indexes.map((n) => (
          <Citation key={n} index={n} />
        ))}
      </span>
    </SentenceContext.Provider>
  );
}

/** 文字切成词（ICU 的分词：中文按词典切，和界面语言无关；英文按单词），只留像词的部分 */
function segments(text: string): { word: string; index: number }[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)].filter((s) => s.isWordLike).map((s) => ({ word: s.segment, index: s.index }));
  }
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ word: m[0], index: m.index }));
}

/** 值得标的词：两个字以上的中文，三个字母以上的英文或数字 */
const meaningful = (word: string) => (/\p{Script=Han}/u.test(word) ? word.length >= 2 : word.length >= 3);

/** 引文里要标出的区间：给了 highlight 就找这些词，否则找和句子共用的词。相邻的区间合并 */
function markRanges(quote: string, { highlight, against }: { highlight?: string[]; against?: string[] }): [number, number][] {
  const ranges: [number, number][] = [];
  if (highlight?.length) {
    const lower = quote.toLowerCase();
    for (const term of highlight) {
      const needle = term.toLowerCase();
      if (!needle) continue;
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) ranges.push([at, at + needle.length]);
    }
  } else if (against?.length) {
    const words = new Set(against.flatMap((text) => segments(text).map((s) => s.word.toLowerCase())).filter(meaningful));
    for (const s of segments(quote)) if (meaningful(s.word) && words.has(s.word.toLowerCase())) ranges.push([s.index, s.index + s.word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    // 中间只隔着空白时也并成一段
    if (last && /^\s*$/.test(quote.slice(last[1], r[0]))) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** 引文，标出的词用 <mark> */
function Quote({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="ui-citation__mark">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export interface CitationProps {
  /** 来源编号，从 1 开始。 */
  index: number;
}

/**
 * 正文角标链接（在新标签页打开来源），读屏名称为“来源 1：标题”，悬停或聚焦时弹出预览；若编号无对应来源则仅显示文本 `[n]`。
 */
export function Citation({ index }: CitationProps) {
  const t = useStrings(citationStrings);
  const ctx = useContext(SourcesContext);
  const sentence = useContext(SentenceContext);
  const source = ctx?.sources[index - 1];
  const { props, isActive } = useActivate(index, sentence);
  const sentenceText = sentence ? ctx?.sentences.get(sentence)?.text : undefined;
  if (!source) return <span className="ui-citation" data-missing="">[{index}]</span>;
  return (
    <span {...props} className="ui-citation-wrap">
      <HoverCard
        placement="top start"
        content={
          <>
            <span className="ui-citation__preview-domain">{domainOf(source.url)}</span>
            <strong className="ui-citation__preview-title">{source.title}</strong>
            {source.quote && sentenceText !== undefined ? (
              <span className="ui-citation__preview-snippet">
                <Quote text={source.quote} ranges={markRanges(source.quote, { highlight: source.highlight, against: [sentenceText] })} />
              </span>
            ) : source.snippet ? (
              <span className="ui-citation__preview-snippet">{source.snippet}</span>
            ) : null}
          </>
        }
      >
        {/* 角标太小，放不下 Link 的外部链接图标：用 React Aria 的 Link，"在新窗口打开"写进读屏名称 */}
        <AriaLink
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-citation"
          data-active={isActive || undefined}
          aria-label={t.source({ index, title: source.title })}
        >
          {index}
        </AriaLink>
      </HoverCard>
    </span>
  );
}

export interface SourceListProps {
  /**
   * 列表区域的读屏名称与可见标题。
   * @default "来源"（英文界面 "Sources"）
   */
  heading?: string;
}

/** 来源列表，展示编号、标题链接与域名；悬停或聚焦任一项时联动高亮正文中的对应角标与句子。 */
export function SourceList({ heading: headingProp }: SourceListProps) {
  const t = useStrings(citationStrings);
  const heading = headingProp === undefined ? t.heading : headingProp;
  const ctx = useContext(SourcesContext);
  // 同时只展开一条摘录
  const [open, setOpen] = useState<number | null>(null);
  if (!ctx?.sources.length) return null;
  return (
    <section className="ui-source-list" aria-label={heading} data-has-active={ctx.active !== null || undefined}>
      <div className="ui-source-list__heading" aria-hidden="true">
        {heading}
      </div>
      <ol className="ui-source-list__items">
        {ctx.sources.map((source, i) => (
          <SourceItem key={source.url + i} source={source} index={i + 1} isOpen={open === i + 1} onOpenChange={(o) => setOpen(o ? i + 1 : null)} />
        ))}
      </ol>
    </section>
  );
}

function SourceItem({ source, index, isOpen, onOpenChange }: { source: Source; index: number; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useStrings(citationStrings);
  const ctx = useContext(SourcesContext);
  const { props, isActive } = useActivate(index);
  const regionId = useId();
  const copy = useCopy();
  // 没写 highlight 时，标出和引用这个来源的句子共用的词
  const against = ctx ? [...ctx.sentences.values()].filter((s) => s.cites.includes(index)).map((s) => s.text) : [];
  return (
    <li {...props} className="ui-source-list__item" data-active={isActive || undefined} data-open={isOpen || undefined}>
      <span className="ui-source-list__index" aria-hidden="true">
        {index}
      </span>
      <span className="ui-source-list__body">
        <Link href={source.url} isExternal variant="standalone">
          {source.title}
        </Link>
        <span className="ui-source-list__domain">{domainOf(source.url)}</span>
        {source.quote ? (
          <>
            <AriaButton
              className="ui-source-list__toggle"
              aria-expanded={isOpen}
              aria-controls={isOpen ? regionId : undefined}
              aria-label={t.excerptOf({ index })}
              onPress={() => onOpenChange(!isOpen)}
            >
              {t.excerpt}
              <ChevronDownIcon aria-hidden="true" />
            </AriaButton>
            {isOpen ? (
              <div id={regionId} role="region" aria-label={t.excerptOf({ index })} className="ui-source-list__excerpt">
                <span className="ui-source-list__domain">{[domainOf(source.url), source.date].filter(Boolean).join(" · ")}</span>
                <blockquote cite={source.url} className="ui-source-list__quote">
                  <Quote text={source.quote} ranges={markRanges(source.quote, { highlight: source.highlight, against })} />
                </blockquote>
                <div className="ui-source-list__actions">
                  <Link href={source.url} isExternal variant="standalone">
                    {t.open}
                  </Link>
                  <Button size="sm" variant="ghost" icon={copy.state === "copied" ? <CheckIcon /> : <CopyIcon />} onPress={() => copy.copy(source.quote!, { done: t.copied })}>
                    {t.copy}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </span>
    </li>
  );
}
