import { defineStrings } from "../../lib/i18n";

export const selectionBarStrings = defineStrings(
  {
    selected: (v: { count: number }) => `已选 ${v.count} 项`,
    selectionCleared: "已清除选择",
    label: "批量操作",
    clearSelection: "清除选择",
  },
  {
    selected: (v: { count: number }) => `${v.count} selected`,
    selectionCleared: "Selection cleared",
    label: "Bulk actions",
    clearSelection: "Clear selection",
  },
);
