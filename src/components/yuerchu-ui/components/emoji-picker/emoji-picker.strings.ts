import { defineStrings } from "../../lib/i18n";

export const emojiPickerStrings = defineStrings(
  {
    panel: "选择表情",
    search: "搜索表情",
    grid: "表情列表",
    recent: "最近使用",
    empty: "没有匹配的表情，试试别的关键词。",
    loading: "正在加载表情",
    failed: "表情加载失败",
    retry: "重试",
    defaultTone: "默认肤色",
    tone: (v: { current: string; next: string }) => `肤色：${v.current}，切换为${v.next}`,
    variant: (v: { label: string; tone: string }) => `${v.label}（${v.tone}）`,
    packs: "表情包",
    builtin: "表情",
  },
  {
    panel: "Choose an emoji",
    search: "Search emojis",
    grid: "Emojis",
    recent: "Recently used",
    empty: "No matching emojis. Try a different keyword.",
    loading: "Loading emojis",
    failed: "Could not load emojis",
    retry: "Retry",
    defaultTone: "Default skin tone",
    tone: (v: { current: string; next: string }) => `Skin tone: ${v.current}. Switch to ${v.next}`,
    variant: (v: { label: string; tone: string }) => `${v.label} (${v.tone})`,
    packs: "Emoji packs",
    builtin: "Emoji",
  },
);
