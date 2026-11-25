/*
 * 边输入边筛选时照顾中文输入（ComboBox、TagField、CommandPalette 共用）。
 *
 * - 输入法组字：组字期间（拼音、注音还没确认）输入框里是"zhou"这样的字母，直接按它筛选会让列表变成"没有匹配的结果"，
 *   每打一个字都闪一下空列表。组字期间改按组字开始前的内容筛选，组字结束时更新状态、重新渲染，再按确认后的文字筛选。
 * - 拼音：不开输入法直接打字母时，也按拼音匹配中文（"sz"找到"设置"，见 lib/pinyin.ts）。
 *   字典第一次输入字母时才加载；加载好之前只按文字本身筛选，加载好以后重新渲染、重新筛选。
 */
import type { CompositionEvent, FormEvent } from "react";
import { useState } from "react";
import { useFilter } from "react-aria-components";
import { loadPinyin, looksLikePinyin, pinyinMatches, usePinyinReady } from "./pinyin";

export function useCompositionFilter() {
  const { contains } = useFilter({ sensitivity: "base" });
  const [beforeComposition, setBeforeComposition] = useState<string | null>(null);
  // 字典加载好时这个值会变：组件重新渲染，下面的 filter 换成新的函数，列表重新筛选
  const pinyinReady = usePinyinReady();
  return {
    /** 按"包含"筛选（不区分大小写），也按拼音匹配；组字期间用组字前的内容 */
    filter: (text: string, input: string) => {
      const query = beforeComposition ?? input;
      return contains(text, query) || (pinyinReady && pinyinMatches(text, query));
    },
    /** 放到输入框上 */
    inputProps: {
      onCompositionStart: (e: CompositionEvent<HTMLInputElement>) => setBeforeComposition(e.currentTarget.value),
      onCompositionEnd: () => setBeforeComposition(null),
      // 第一次输入字母时开始加载拼音字典
      onInput: (e: FormEvent<HTMLInputElement>) => {
        if (looksLikePinyin(e.currentTarget.value)) void loadPinyin();
      },
    },
  };
}
