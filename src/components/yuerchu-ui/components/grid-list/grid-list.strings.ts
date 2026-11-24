import { defineStrings } from "../../lib/i18n";

export const gridListStrings = defineStrings(
  {
    loading: "正在加载",
    empty: "暂无内容",
    moreFor: (v: { name: string }) => `${v.name} 的更多操作`,
    more: "更多操作",
  },
  {
    loading: "Loading",
    empty: "No items",
    moreFor: (v: { name: string }) => `More actions for ${v.name}`,
    more: "More actions",
  },
);
