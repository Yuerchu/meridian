import { defineStrings } from "../../lib/i18n";

export const citationStrings = defineStrings(
  {
    source: (v: { index: number; title: string }) => `来源 ${v.index}：${v.title}（在新窗口打开）`,
    heading: "来源",
    excerpt: "摘录",
    excerptOf: (v: { index: number }) => `来源 ${v.index} 的摘录`,
    open: "打开来源",
    copy: "复制摘录",
    copied: "已复制摘录",
  },
  {
    source: (v: { index: number; title: string }) => `Source ${v.index}: ${v.title} (opens in a new window)`,
    heading: "Sources",
    excerpt: "Excerpt",
    excerptOf: (v: { index: number }) => `Excerpt from source ${v.index}`,
    open: "Open source",
    copy: "Copy excerpt",
    copied: "Excerpt copied",
  },
);
