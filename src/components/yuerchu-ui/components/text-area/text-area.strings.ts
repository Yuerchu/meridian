import { defineStrings } from "../../lib/i18n";

export const textAreaStrings = defineStrings(
  {
    hint: (v: { suggestion: string }) => `续写建议：${v.suggestion}。按 Tab 接受，Ctrl + 右方向键接受一个词，Esc 取消`,
    announce: (v: { suggestion: string }) => `有续写建议：${v.suggestion}。按 Tab 接受`,
  },
  {
    hint: (v: { suggestion: string }) => `Suggestion: ${v.suggestion}. Tab to accept, Ctrl + Right Arrow to accept a word, Escape to dismiss`,
    announce: (v: { suggestion: string }) => `Suggestion: ${v.suggestion}. Press Tab to accept`,
  },
);
