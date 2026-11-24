import { defineStrings } from "../../lib/i18n";

export const inlineEditStrings = defineStrings(
  {
    empty: "未填写",
    saveFailed: "保存失败",
    saving: "正在保存",
    edit: (v: { label: string }) => `，编辑${v.label}`,
  },
  {
    empty: "Empty",
    saveFailed: "Couldn't save",
    saving: "Saving",
    edit: (v: { label: string }) => `, edit ${v.label}`,
  },
);
