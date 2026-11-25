import { defineStrings } from "../../lib/i18n";

export const sidebarStrings = defineStrings(
  {
    label: "侧边栏",
    expand: "展开侧边栏",
    collapse: "收起侧边栏",
    open: "打开导航",
    close: "关闭导航",
    resize: "调整侧边栏宽度",
    width: ({ width }: { width: number }) => `${width} 像素`,
  },
  {
    label: "Sidebar",
    expand: "Expand sidebar",
    collapse: "Collapse sidebar",
    open: "Open navigation",
    close: "Close navigation",
    resize: "Resize sidebar",
    width: ({ width }: { width: number }) => `${width} pixels`,
  },
);
