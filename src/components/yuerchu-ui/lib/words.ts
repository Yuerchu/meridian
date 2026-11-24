/**
 * 把文字切成词、空白、标点、emoji，给按词比较用（InlineDiff；流式改写的差异 #241 也用它）。
 * 中文按 ICU 的词典切词（Intl.Segmenter，和界面语言无关）；没有 Segmenter 的环境英文按字母数字串、中文按单字切。
 * 切出来的片段拼回去和原文一字不差。
 */
export function splitWords(text: string): string[] {
  if (!text) return [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const out: string[] = [];
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
      // 连续的空白并成一段：改动的边界不落在空白中间
      const last = out.at(-1);
      if (last !== undefined && /^\s+$/.test(segment) && /^\s+$/.test(last)) out[out.length - 1] = last + segment;
      else out.push(segment);
    }
    return out;
  }
  return text.match(/\s+|\p{Script=Han}|[\p{L}\p{N}_]+|\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*\uFE0F?|[\s\S]/gu) ?? [];
}
