import { defineStrings } from "../../lib/i18n";

export const dataTableStrings = defineStrings(
  {
    retry: "重试",
    loading: "正在加载",
    loadingMore: "正在加载更多",
    bulkHint: "勾选行后可进行批量操作",
    loadingPrefix: "正在加载 · ",
    selectedPrefix: (v: { count: number }) => `已选 ${v.count} 项 · `,
    total: (v: { count: number }) => `共 ${v.count} 条`,
    pagination: (v: { table: string }) => `${v.table}的分页`,
  },
  {
    retry: "Retry",
    loading: "Loading",
    loadingMore: "Loading more",
    bulkHint: "Select rows for bulk actions",
    loadingPrefix: "Loading · ",
    selectedPrefix: (v: { count: number }) => `${v.count} selected · `,
    total: (v: { count: number }) => `${v.count} ${v.count === 1 ? "row" : "rows"}`,
    pagination: (v: { table: string }) => `${v.table} pagination`,
  },
);
