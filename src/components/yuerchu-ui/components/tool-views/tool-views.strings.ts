import { defineStrings } from "../../lib/i18n";

export const toolViewsStrings = defineStrings(
  {
    newFile: "新文件",
    deletedFile: "已删除",
    replaceAll: "全部替换",
    moreLines: (v: { count: number }) => `还有 ${v.count} 行`,
    showAll: "展开全部",
    showLess: "收起",
    noOutput: "无输出",
    stderr: "标准错误",
    noMatches: "没有匹配结果",
    emptyList: "空目录",
    statusPending: "待处理",
    statusInProgress: "进行中",
    statusCompleted: "已完成",
  },
  {
    newFile: "New file",
    deletedFile: "Deleted",
    replaceAll: "Replace all",
    moreLines: (v: { count: number }) => `${v.count} more lines`,
    showAll: "Show all",
    showLess: "Show less",
    noOutput: "No output",
    stderr: "stderr",
    noMatches: "No matches",
    emptyList: "Empty directory",
    statusPending: "Pending",
    statusInProgress: "In progress",
    statusCompleted: "Completed",
  },
);
