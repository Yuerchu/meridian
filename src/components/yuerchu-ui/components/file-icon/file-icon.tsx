"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useId, useState } from "react";
import fileSvg from "../../lib/file-icons/icons/file";
import folderSvg from "../../lib/file-icons/icons/folder";
import folderOpenSvg from "../../lib/file-icons/icons/folder-open";
import type { FileIconSet } from "../../lib/file-icons/resolve";
import { resolveFileIcon, withUniqueIds } from "../../lib/file-icons/resolve";
import "./file-icon.css";

/**
 * 根据文件名、扩展名或文件夹名称匹配并渲染对应的彩色图标，图标素材来自 material-icon-theme，支持精简版、完整版与按需加载三种资源集。
 *
 * @packageDocumentation
 * @category 展示
 * @status 实验中
 */

/**
 * 未配置 FileIconProvider 时仅回退通用文件与文件夹图标，避免默认打入精简版资源。
 */
const genericFileIcons: FileIconSet = {
  map: { file: "file", folder: "folder", extensions: {}, fileNames: {}, folders: {}, light: { extensions: {}, fileNames: {}, folders: {} } },
  icons: { file: fileSvg, folder: folderSvg, "folder-open": folderOpenSvg },
};

const FileIconContext = createContext<FileIconSet>(genericFileIcons);

export interface FileIconProviderProps {
  /**
   * 图标资源集，可分别从 `lib/file-icons/lite`、`full` 或 `lazy` 导入 `liteFileIcons`（精简版，约 37 KB gzip）、
   * `fullFileIcons`（完整版 1100+ 图标，约 300 KB gzip）或 `lazyFileIcons`（仅映射表约 23 KB gzip，按需下载图标）。
   */
  set: FileIconSet;
  /** 应用子树，内部所有 `FileIcon` 将复用该图标集。 */
  children: ReactNode;
}

/**
 * 为子树内的 `FileIcon` 提供统一的图标集上下文，通常放置于应用根节点；未配置时渲染通用图标。
 */
export function FileIconProvider({ set, children }: FileIconProviderProps) {
  return <FileIconContext value={set}>{children}</FileIconContext>;
}

/** 按需加载时下载过的图标，每套各一份缓存 */
const loadedIcons = new WeakMap<FileIconSet, Map<string, string>>();

function useIconSvg(set: FileIconSet, icon: string, fallback: string) {
  const cache = loadedIcons.get(set);
  const ready = set.icons[icon] ?? cache?.get(icon);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (ready || !set.load) return;
    let cancelled = false;
    set.load(icon).then(
      (svg) => {
        let c = loadedIcons.get(set);
        if (!c) loadedIcons.set(set, (c = new Map()));
        c.set(icon, svg);
        if (!cancelled) rerender((n) => n + 1);
      },
      // 下载失败（离线、部署切换）就一直显示默认图标
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [set, icon, ready]);
  return ready ?? set.icons[fallback] ?? "";
}

function Glyph({ set, icon, fallback, variant }: { set: FileIconSet; icon: string; fallback: string; variant?: "dark" | "light" }) {
  const uid = useId();
  const svg = useIconSvg(set, icon, fallback);
  return (
    <span
      className="ui-file-icon__glyph"
      data-variant={variant}
      // 内容来自构建时生成的图标文件（lib/file-icons/icons），不是用户输入
      dangerouslySetInnerHTML={{ __html: withUniqueIds(svg, uid) }}
    />
  );
}

export interface FileIconProps {
  /** 文件或文件夹名称，可包含相对路径（例如 `.github/workflows/ci.yml`）。 */
  name: string;
  /**
   * 节点类型，区分文件或文件夹。
   * @default "file"
   */
  type?: "file" | "folder";
  /** 文件夹是否处于展开状态。 */
  isOpen?: boolean;
  /**
   * 图标尺寸，对应 `--icon-sm`、`--icon-md` 与 `--icon-lg`。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 自定义根元素类名。 */
  className?: string;
}

/**
 * 装饰性文件图标组件，对读屏隐藏，需配合文件名文本使用；深色标志图标会随主题自动切换亮色版本。
 */
export function FileIcon({ name, type = "file", isOpen, size = "md", className }: FileIconProps) {
  const set = useContext(FileIconContext);
  const { icon, lightIcon } = resolveFileIcon(set.map, name, { type, isOpen });
  const fallback = type === "folder" ? (isOpen ? `${set.map.folder}-open` : set.map.folder) : set.map.file;
  return (
    <span className={className ? `ui-file-icon ${className}` : "ui-file-icon"} data-size={size} aria-hidden="true">
      <Glyph set={set} icon={icon} fallback={fallback} variant={lightIcon ? "dark" : undefined} />
      {lightIcon ? <Glyph set={set} icon={lightIcon} fallback={fallback} variant="light" /> : null}
    </span>
  );
}
