/*
 * 文件图标的映射规则：文件名 / 扩展名 / 文件夹名 → 图标名。精简版、完整版、按需加载共用这一份规则，
 * 只是映射表和图标的来源不同（lite.ts / full.ts / lazy.ts，由 pnpm file-icons 生成）。
 */

type Table = Record<string, string>;

/** 映射表：值都是图标名（icons/ 下的文件名）。light 是亮色背景下要换掉的图标 */
export interface FileIconMap {
  /** 默认的文件图标 */
  file: string;
  /** 默认的文件夹图标（展开的是它加 "-open"） */
  folder: string;
  /** 扩展名，不带点，可以有多段（d.ts、spec.ts） */
  extensions: Table;
  /** 特殊文件名，可以带路径（.github/funding.yml） */
  fileNames: Table;
  /** 文件夹的基本名（src 同时匹配 .src、_src、-src、__src__） */
  folders: Table;
  light: { extensions: Table; fileNames: Table; folders: Table };
}

/** 一套图标：映射表 + 图标（SVG 字符串）；按需加载时没打包进来的图标通过 load 下载 */
export interface FileIconSet {
  map: FileIconMap;
  icons: Record<string, string>;
  load?: (icon: string) => Promise<string>;
}

export interface ResolvedFileIcon {
  /** 默认（暗色背景）的图标名 */
  icon: string;
  /** 亮色背景下换成这个；没有就是同一个 */
  lightIcon?: string;
}

/** 只查自己的键：文件夹名可能叫 __proto__、constructor，普通的 obj[key] 会拿到 Object.prototype 上的东西 */
function get(table: Table, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** 展开的文件夹：folder-src → folder-src-open；folder-cursor_light → folder-cursor-open_light */
export function openFolderIcon(icon: string) {
  return icon.endsWith("_light") ? `${icon.slice(0, -"_light".length)}-open_light` : `${icon}-open`;
}

/** 文件夹的基本名：.src / _src / -src / __src__ → src */
function folderBase(name: string) {
  const dunder = /^__(.+)__$/.exec(name);
  if (dunder) return dunder[1]!;
  return /^[._-]/.test(name) ? name.slice(1) : name;
}

/** 命中的是哪张表的哪个键：亮色版本只看同一张表的同一个键（Cargo.toml 命中文件名，不能因为扩展名 toml 有亮色版本就换掉） */
interface Match {
  table: "extensions" | "fileNames" | "folders";
  key: string;
  icon: string;
}

function lookupMatch(tables: Partial<Record<Match["table"], Table>>, table: Match["table"], key: string): Match | undefined {
  const t = tables[table];
  if (!t) return undefined;
  const exact = get(t, key);
  if (exact) return { table, key, icon: exact };
  const lower = get(t, key.toLowerCase());
  return lower ? { table, key: key.toLowerCase(), icon: lower } : undefined;
}

function matchFile(map: FileIconMap, path: string): Match | undefined {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? "";
  // 文件名：带路径的键优先（.github/funding.yml），再查文件名本身
  for (let i = 0; i < segments.length; i++) {
    const hit = lookupMatch(map, "fileNames", segments.slice(i).join("/"));
    if (hit) return hit;
  }
  // 扩展名：最长的优先（component.spec.ts → spec.ts，再 → ts）；以点开头的文件（.env）也算一段扩展名
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const hit = lookupMatch(map, "extensions", name.slice(dot + 1));
    if (hit) return hit;
  }
  return undefined;
}

function matchFolder(map: FileIconMap, path: string): Match | undefined {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return lookupMatch(map, "folders", name) ?? lookupMatch(map, "folders", folderBase(name));
}

/**
 * 找图标。path 可以只是名字（package.json），也可以带路径（.github/workflows/ci.yml）。
 * 找不到时用默认的文件 / 文件夹图标。
 */
export function resolveFileIcon(map: FileIconMap, path: string, options: { type?: "file" | "folder"; isOpen?: boolean } = {}): ResolvedFileIcon {
  const isFolder = options.type === "folder";
  const match = isFolder ? matchFolder(map, path) : matchFile(map, path);
  let icon = match?.icon ?? (isFolder ? map.folder : map.file);
  let light = match ? get(map.light[match.table], match.key) : undefined;
  if (isFolder && options.isOpen) {
    icon = openFolderIcon(icon);
    light = light && openFolderIcon(light);
  }
  return light && light !== icon ? { icon, lightIcon: light } : { icon };
}

/** 生成的 SVG 里 id 都带 __UID__ 前缀（渐变、裁剪路径要用），换成每个实例自己的前缀，同一个图标出现多次也不冲突 */
export function withUniqueIds(svg: string, uid: string) {
  return svg.includes("__UID__") ? svg.replaceAll("__UID__", uid.replace(/[^A-Za-z0-9_-]/g, "")) : svg;
}
