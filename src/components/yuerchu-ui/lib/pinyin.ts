"use client";

/*
 * 按拼音筛选中文：打"shezhi""sz""dkshez"都能找到"打开设置"，多音字两种读音都认（"重新"打 chongxin、zhongxin 都行）。
 * 匹配交给 pinyin-pro（MIT）的 match。
 *
 * 拼音字典压缩后约 86 KB，不在页面加载时下载：第一次输入字母时才加载（loadPinyin），
 * 加载完成前只按文字本身筛选，加载好以后用到它的组件重新渲染、重新筛选（usePinyinReady）。
 */
import { useSyncExternalStore } from "react";

type Match = (text: string, query: string) => boolean;

let match: Match | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** 只有字母（可以夹空格）的输入才可能是拼音 */
const LETTERS = /^[a-z\s]+$/i;
/** 文字里有汉字才需要按拼音比 */
const HAN = /\p{Script=Han}/u;

/** 输入看起来是拼音（只有字母）时返回 true：用来决定要不要开始加载字典 */
export function looksLikePinyin(query: string): boolean {
  return LETTERS.test(query) && query.trim() !== "";
}

/** 开始加载拼音字典（只加载一次）。加载失败（例如离线）时下次再试，筛选退回到只按文字本身。 */
export function loadPinyin(): Promise<void> {
  loading ??= import("pinyin-pro")
    .then(({ match: pinyinMatch }) => {
      match = (text, query) => pinyinMatch(text, query) !== null;
      for (const listener of listeners) listener();
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/**
 * text 能不能用拼音 query 匹配上（全拼、首字母、混合都行，不区分大小写，忽略空格）。
 * 字典还没加载、query 不是字母、text 里没有汉字时返回 false。
 */
export function pinyinMatches(text: string, query: string): boolean {
  if (!match || !looksLikePinyin(query) || !HAN.test(text)) return false;
  return match(text, query.replace(/\s+/g, "").toLowerCase());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 字典是否已经加载好。加载完成时用到它的组件会重新渲染（重新筛选）。 */
export function usePinyinReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => match !== null,
    () => false,
  );
}
