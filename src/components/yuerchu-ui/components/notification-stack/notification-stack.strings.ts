import { defineStrings } from "../../lib/i18n";

export const notificationStackStrings = defineStrings(
  {
    region: "待处理通知",
    dismiss: "收起通知",
    added: (v: { count: number }) => `新增 ${v.count} 条待处理通知`,
  },
  {
    region: "Pending notifications",
    dismiss: "Dismiss notification",
    added: (v: { count: number }) => `${v.count} new pending ${v.count === 1 ? "notification" : "notifications"}`,
  },
);
