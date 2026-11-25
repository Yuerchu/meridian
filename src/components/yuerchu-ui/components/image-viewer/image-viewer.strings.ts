import { defineStrings } from "../../lib/i18n";

export const imageViewerStrings = defineStrings(
  {
    close: "关闭",
    previous: "上一张",
    next: "下一张",
    zoomIn: "放大",
    zoomOut: "缩小",
    rotate: "顺时针旋转 90 度",
    reset: ({ percent }: { percent: number }) => `还原缩放和旋转，当前 ${percent}%`,
    toolbar: "图片操作",
    loading: "正在加载图片",
    failed: "图片加载失败",
    empty: "没有可显示的图片",
    counter: ({ position, total }: { position: number; total: number }) => `${position} / ${total}`,
    position: ({ position, total, label }: { position: number; total: number; label: string }) =>
      `第 ${position} 张，共 ${total} 张：${label}`,
  },
  {
    close: "Close",
    previous: "Previous image",
    next: "Next image",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    rotate: "Rotate 90 degrees clockwise",
    reset: ({ percent }: { percent: number }) => `Reset zoom and rotation, currently ${percent}%`,
    toolbar: "Image actions",
    loading: "Loading image",
    failed: "Failed to load image",
    empty: "No images to display",
    counter: ({ position, total }: { position: number; total: number }) => `${position} / ${total}`,
    position: ({ position, total, label }: { position: number; total: number; label: string }) =>
      `Image ${position} of ${total}: ${label}`,
  },
);
