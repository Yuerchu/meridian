import { defineStrings } from "../../lib/i18n";

export const paginationStrings = defineStrings(
  {
    label: "分页",
    previous: "上一页",
    next: "下一页",
    page: (v: { page: number }) => `第 ${v.page} 页`,
    compact: (v: { page: number; total: number }) => `${v.page} / ${v.total} 页`,
    position: (v: { page: number; total: number }) => `第 ${v.page} 页，共 ${v.total} 页`,
  },
  {
    label: "Pagination",
    previous: "Previous page",
    next: "Next page",
    page: (v: { page: number }) => `Page ${v.page}`,
    compact: (v: { page: number; total: number }) => `${v.page} / ${v.total}`,
    position: (v: { page: number; total: number }) => `Page ${v.page} of ${v.total}`,
  },
);
