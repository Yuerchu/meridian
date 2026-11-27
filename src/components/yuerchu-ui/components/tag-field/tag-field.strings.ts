import { defineStrings } from "../../lib/i18n";

export const tagFieldStrings = defineStrings(
  {
    added: (v: { names: string }) => `已添加 ${v.names}`,
    removed: (v: { names: string }) => `已移除 ${v.names}`,
    selected: (v: { field: string }) => (v.field ? `已选的${v.field}` : "已选项"),
    create: (v: { text: string }) => `按 Enter 添加“${v.text}”`,
    empty: "没有匹配的选项",
    other: "其他",
    max: (v: { count: number }) => `最多选 ${v.count} 个`,
    count: (v: { count: number; max: number }) => `已选 ${v.count} / ${v.max}`,
    sep: "，",
    loading: "正在加载选项",
    loadingList: "加载中…",
  },
  {
    added: (v: { names: string }) => `Added ${v.names}`,
    removed: (v: { names: string }) => `Removed ${v.names}`,
    selected: (v: { field: string }) => (v.field ? `Selected ${v.field}` : "Selected"),
    create: (v: { text: string }) => `Press Enter to add "${v.text}"`,
    empty: "No matching options",
    other: "Other",
    max: (v: { count: number }) => `You can select up to ${v.count}`,
    count: (v: { count: number; max: number }) => `${v.count} of ${v.max} selected`,
    sep: ". ",
    loading: "Loading options",
    loadingList: "Loading…",
  },
);
