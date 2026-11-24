import { defineStrings } from "../../lib/i18n";

export const notificationStackStrings = defineStrings(
  {
    region: "待处理通知",
    dismiss: "收起通知",
    added: (v: { count: number }) => `新增 ${v.count} 条待处理通知`,
    expand: (v: { count: number }) => `展开其余 ${v.count} 条`,
    collapse: "折叠通知",
  },
  {
    region: "Pending notifications",
    dismiss: "Dismiss notification",
    added: (v: { count: number }) => `${v.count} new pending ${v.count === 1 ? "notification" : "notifications"}`,
    expand: (v: { count: number }) => `Show ${v.count} more`,
    collapse: "Collapse notifications",
  },
);
