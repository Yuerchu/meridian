import { defineStrings } from "../../lib/i18n";

export const attachmentPreviewStrings = defineStrings(
  {
    uploading: (v: { percent?: string }) => `上传中${v.percent !== undefined ? ` ${v.percent}` : "…"}`,
    failed: "上传失败",
    view: (v: { name: string }) => `查看大图：${v.name}`,
    progress: (v: { name: string }) => `${v.name} 上传进度`,
    remove: (v: { name: string }) => `移除 ${v.name}`,
    list: "附件",
  },
  {
    uploading: (v: { percent?: string }) => `Uploading${v.percent !== undefined ? ` ${v.percent}` : "…"}`,
    failed: "Upload failed",
    view: (v: { name: string }) => `View full size: ${v.name}`,
    progress: (v: { name: string }) => `${v.name} upload progress`,
    remove: (v: { name: string }) => `Remove ${v.name}`,
    list: "Attachments",
  },
);
