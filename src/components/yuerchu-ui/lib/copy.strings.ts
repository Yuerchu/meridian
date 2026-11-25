import { defineStrings } from "./i18n";

export const copyStrings = defineStrings(
  { done: "已复制", failed: "复制失败，请手动选择文字复制" },
  { done: "Copied", failed: "Couldn't copy. Select the text and copy it manually." },
);
