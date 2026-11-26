import { defineStrings } from "../../lib/i18n";

export const pathBarStrings = defineStrings(
  {
    label: "路径",
    edit: "编辑路径",
    input: "路径",
    more: ({ count }: { count: number }) => `显示其余 ${count} 级`,
    children: ({ name }: { name: string }) => `${name} 的子文件夹`,
    empty: "暂无子文件夹",
    loading: "加载中…",
    failed: "加载失败",
  },
  {
    label: "Path",
    edit: "Edit path",
    input: "Path",
    more: ({ count }: { count: number }) => `Show ${count} more ${count === 1 ? "level" : "levels"}`,
    children: ({ name }: { name: string }) => `Subfolders in ${name}`,
    empty: "No subfolders",
    loading: "Loading…",
    failed: "Could not load",
  },
);
