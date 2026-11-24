"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { useState } from "react";
import { Link as AriaLink } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { ArrowUpRightIcon, CircleCheckIcon, CircleDashedIcon, LinkIcon, MinusIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { FileIcon } from "../file-icon/file-icon";
import { toolViewsStrings } from "./tool-views.strings";
import "./tool-views.css";

/**
 * 面向 AI 编程与检索类工具的专用内容视图集合，包含路径标签、文件差异、代码搜索结果、文件/目录列表、命令输出、待办清单与网页来源列表。
 *
 * @packageDocumentation
 * @category AI
 * @status 实验中
 */

function joinClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

/** 将路径拆分为目录前缀与末级名称，兼容 POSIX 与 Windows 分隔符。 */
export function splitFilePath(path: string): { dir: string; name: string } {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastSlash < 0) return { dir: "", name: path };
  return { dir: path.slice(0, lastSlash + 1), name: path.slice(lastSlash + 1) };
}

/* ---------- 1. PathLabel ---------- */

export interface PathLabelProps extends Omit<ComponentProps<"span">, "children"> {
  /** 文件或目录路径。 */
  path: string;
  /**
   * 设为 `true` 时不省略目录前缀，按整段路径自动换行；默认优先截断目录前缀并始终完整保留文件名。
   * @default false
   */
  wrap?: boolean;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLSpanElement>;
}

/** 优先完整保留文件名的路径展示组件，窄空间下从目录前缀末尾省略。 */
export function PathLabel({ path, wrap = false, className, ref, ...props }: PathLabelProps) {
  const { dir, name } = splitFilePath(path);
  return (
    <span
      ref={ref}
      data-slot="path-label"
      data-wrap={wrap || undefined}
      className={joinClass("ui-path-label", className)}
      {...props}
    >
      {dir !== "" ? (
        <span data-slot="path-dir" className="ui-path-label__dir">
          {dir}
        </span>
      ) : null}
      <span data-slot="path-name" className="ui-path-label__name">
        {name}
      </span>
    </span>
  );
}

/* ---------- 2. ToolDiffStats / ToolDiffView ---------- */

export type ToolDiffLineKind = "context" | "add" | "remove" | "hunk";

export interface ToolDiffLine {
  /** 行类型：上下文、新增、删除或变更区块头。 */
  kind: ToolDiffLineKind;
  /** 不含 `+`/`-` 前缀的行正文。 */
  text: string;
  /** 原文件行号。 */
  oldNo?: number;
  /** 新文件行号。 */
  newNo?: number;
}

export interface ToolDiffStatsProps {
  /** 新增行数。 */
  added: number;
  /** 删除行数。 */
  removed: number;
  /** 自定义类名。 */
  className?: string;
}

/** 彩色的 `+N -M` 变更行数统计。 */
export function ToolDiffStats({ added, removed, className }: ToolDiffStatsProps) {
  if (added === 0 && removed === 0) return null;
  return (
    <span data-slot="file-diff-stats" className={joinClass("ui-tool-diff__stats", className)}>
      {added > 0 ? (
        <span data-slot="file-diff-added" className="ui-tool-diff__added">
          +{added}
        </span>
      ) : null}
      {added > 0 && removed > 0 ? " " : null}
      {removed > 0 ? (
        <span data-slot="file-diff-removed" className="ui-tool-diff__removed">
          -{removed}
        </span>
      ) : null}
    </span>
  );
}

function diffLinePrefix(kind: ToolDiffLineKind): string {
  switch (kind) {
    case "add":
      return "+ ";
    case "remove":
      return "- ";
    case "hunk":
      return "";
    default:
      return "  ";
  }
}

export interface ToolDiffViewProps {
  /** 变更后的文件路径。 */
  path: string;
  /** 按顺序排列的差异行列表。 */
  lines: readonly ToolDiffLine[];
  /** 文件变更类型：`edit` / `modify` 修改、`create` 新建、`delete` 删除。 */
  op?: "edit" | "modify" | "create" | "delete";
  /** 重命名或移动前的原路径。 */
  movedFrom?: string;
  /** 是否为全文替换操作。 */
  replaceAll?: boolean;
  /**
   * 是否展示顶部文件头栏；在面板标题已包含单文件路径时可设为 `false`。
   * @default true
   */
  header?: boolean;
  /**
   * 折叠前默认展示的最大行数。
   * @default 300
   */
  maxLines?: number;
  /** 自定义单行代码渲染函数（如接入语法高亮）。 */
  renderLine?: (text: string, line: ToolDiffLine) => ReactNode;
  /** 是否已完成外部语法高亮（为真时新增/删除行正文改用中性文字色，由高亮色值区分）。 */
  highlighted?: boolean;
  /** 自定义文件图标渲染函数；默认使用库内 `FileIcon`。 */
  renderIcon?: (path: string) => ReactNode;
  /** 自定义类名。 */
  className?: string;
}

/** 嵌入工具调用面板的文件差异视图，支持双列行号、重命名展示、增删统计与超长行折叠。 */
export function ToolDiffView({
  path,
  lines,
  op,
  movedFrom,
  replaceAll = false,
  header = true,
  maxLines = 300,
  renderLine,
  highlighted = false,
  renderIcon,
  className,
}: ToolDiffViewProps) {
  const t = useStrings(toolViewsStrings);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? lines : lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;
  const numbered = lines.some((line) => line.oldNo !== undefined || line.newNo !== undefined);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  return (
    <div
      data-slot="file-diff"
      data-numbered={numbered || undefined}
      className={joinClass("ui-tool-diff", className)}
    >
      {header && path !== "" ? (
        <div data-slot="file-diff-header" className="ui-tool-diff__header">
          {renderIcon ? renderIcon(path) : <FileIcon name={path} size="sm" />}
          {movedFrom ? (
            <>
              <PathLabel path={movedFrom} wrap className="ui-tool-diff__moved-from" />
              <span aria-hidden="true" className="ui-tool-diff__move-arrow">
                →
              </span>
            </>
          ) : null}
          <PathLabel path={path} wrap />
          {op === "create" ? (
            <span data-slot="file-diff-new-file" className="ui-tool-diff__new-file">
              {t.newFile}
            </span>
          ) : null}
          {op === "delete" ? (
            <span data-slot="file-diff-deleted-file" className="ui-tool-diff__deleted-file">
              {t.deletedFile}
            </span>
          ) : null}
          {replaceAll ? (
            <span data-slot="file-diff-replace-all" className="ui-tool-diff__replace-all">
              {t.replaceAll}
            </span>
          ) : null}
          <span data-slot="file-diff-header-end" className="ui-tool-diff__header-end">
            <ToolDiffStats added={added} removed={removed} />
          </span>
        </div>
      ) : null}
      <div data-slot="file-diff-content" className="ui-tool-diff__content">
        <div data-slot="file-diff-lines" className="ui-tool-diff__lines">
          {shown.map((line, i) => (
            <div
              key={i}
              data-slot="file-diff-line"
              data-kind={line.kind}
              data-highlighted={highlighted || undefined}
              className="ui-tool-diff__line"
            >
              {numbered ? (
                <span aria-hidden="true" data-slot="file-diff-gutter" className="ui-tool-diff__gutter">
                  <span data-slot="file-diff-old-no" className="ui-tool-diff__old-no">
                    {line.oldNo ?? ""}
                  </span>
                  <span data-slot="file-diff-new-no" className="ui-tool-diff__new-no">
                    {line.newNo ?? ""}
                  </span>
                </span>
              ) : null}
              <span data-slot="file-diff-sign" className="ui-tool-diff__sign">
                {diffLinePrefix(line.kind)}
              </span>
              <span data-slot="file-diff-text" className="ui-tool-diff__text">
                {renderLine ? renderLine(line.text, line) : line.text || " "}
              </span>
            </div>
          ))}
          {lines.length > maxLines ? (
            <div data-slot="file-diff-more" className="ui-tool-diff__more">
              {!expanded ? (
                <span data-slot="file-diff-hidden-count">{t.moreLines({ count: hidden })}</span>
              ) : null}
              <Button variant="ghost" size="sm" onPress={() => setExpanded((current) => !current)}>
                {expanded ? t.showLess : t.showAll}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- 3. ToolSearchResult ---------- */

export interface ToolSearchMatch {
  /** 命中的行号。 */
  line: number;
  /** 该行内容。 */
  text: string;
}

export interface ToolSearchFileGroup {
  /** 文件路径。 */
  file: string;
  /** 该文件下的全部命中行。 */
  matches: readonly ToolSearchMatch[];
}

export interface ToolSearchResultProps {
  /** 按文件分组的搜索命中列表。 */
  groups: readonly ToolSearchFileGroup[];
  /** 无匹配结果时的空态说明。 */
  emptyMessage?: string;
  /** 列表底部的截断脚注（例如“仅显示前 100 条”）。 */
  footnote?: ReactNode;
  /** 自定义文件图标渲染函数。 */
  renderIcon?: (path: string) => ReactNode;
  /** 自定义类名。 */
  className?: string;
}

/** 按文件分组展示代码或文本搜索命中的工具结果视图。 */
export function ToolSearchResult({ groups, emptyMessage, footnote, renderIcon, className }: ToolSearchResultProps) {
  const t = useStrings(toolViewsStrings);
  if (groups.length === 0) {
    return (
      <div data-slot="tool-empty" className={joinClass("ui-tool-views__empty", className)}>
        {emptyMessage ?? t.noMatches}
      </div>
    );
  }
  return (
    <div data-slot="search-result" className={className}>
      <div data-slot="search-result-scroll" className="ui-tool-views__scroll-lg">
        {groups.map(({ file, matches }) => (
          <div key={file} data-slot="search-result-file" className="ui-tool-views__search-file">
            <div data-slot="search-result-file-header" className="ui-tool-views__search-file-header">
              {renderIcon ? renderIcon(file) : <FileIcon name={file} size="sm" />}
              <PathLabel path={file} className="ui-tool-views__flex-1" />
              <span data-slot="search-result-count" className="ui-tool-views__search-count">
                {matches.length}
              </span>
            </div>
            {matches.map((item, i) => (
              <div key={i} data-slot="search-result-match" className="ui-tool-views__search-match">
                <span data-slot="search-result-line-no" className="ui-tool-views__search-line-no">
                  {item.line}
                </span>
                <span data-slot="search-result-text" className="ui-tool-views__search-text">
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {footnote ? (
        <div data-slot="tool-footnote" className="ui-tool-views__footnote">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 4. ToolFileList ---------- */

export interface ToolFileEntry {
  /** 文件路径或目录项名称。 */
  path: string;
  /** 条目类型：`file` 文件、`dir` 目录、`link` 符号链接。 */
  kind?: "file" | "dir" | "link";
  /** 可选的文件大小文案（如 `"4.2 KB"`）。 */
  size?: string | null;
}

export interface ToolFileListProps {
  /** 要展示的文件或目录条目列表。 */
  entries: readonly ToolFileEntry[];
  /** 列表为空时的提示文案。 */
  emptyMessage?: string;
  /** 底部的截断脚注。 */
  footnote?: ReactNode;
  /** 自定义图标渲染函数。 */
  renderIcon?: (entry: ToolFileEntry) => ReactNode;
  /** 自定义类名。 */
  className?: string;
}

/** 展示文件匹配（glob）或目录列表的工具结果视图。 */
export function ToolFileList({ entries, emptyMessage, footnote, renderIcon, className }: ToolFileListProps) {
  const t = useStrings(toolViewsStrings);
  if (entries.length === 0) {
    return (
      <div data-slot="tool-empty" className={joinClass("ui-tool-views__empty", className)}>
        {emptyMessage ?? t.emptyList}
      </div>
    );
  }
  return (
    <div data-slot="file-list-result" className={className}>
      <div data-slot="file-list-scroll" className="ui-tool-views__list-scroll">
        {entries.map((entry) => {
          const kind = entry.kind ?? "file";
          return (
            <div key={`${kind}:${entry.path}`} data-slot="file-list-entry" className="ui-tool-views__list-row">
              {renderIcon ? (
                renderIcon(entry)
              ) : kind === "dir" ? (
                <FileIcon name={entry.path} type="folder" size="sm" />
              ) : kind === "link" ? (
                <LinkIcon className="ui-tool-views__icon-sm" />
              ) : (
                <FileIcon name={entry.path} size="sm" />
              )}
              <PathLabel path={entry.path} className="ui-tool-views__flex-1" />
              {entry.size ? (
                <span data-slot="file-list-size" className="ui-tool-views__entry-size">
                  {entry.size}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {footnote ? (
        <div data-slot="tool-footnote" className="ui-tool-views__footnote">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 5. ToolCommandView ---------- */

export interface ToolCommandViewProps {
  /** 标准输出文本。 */
  stdout?: string;
  /** 标准错误文本，以醒目淡红区块独立展示。 */
  stderr?: string;
  /** 明确表示命令没有任何输出。 */
  noOutput?: boolean;
  /**
   * 折叠前展示的最大字符数。
   * @default 2000
   */
  maxLength?: number;
  /** 无输出时的提示文案。 */
  emptyMessage?: string;
  /** 标准错误区块的小标题。 */
  stderrLabel?: string;
  /** 自定义类名。 */
  className?: string;
}

/** 终端命令输出视图，支持超长标准输出折叠以及独立着色的标准错误区块。 */
export function ToolCommandView({
  stdout = "",
  stderr = "",
  noOutput = false,
  maxLength = 2000,
  emptyMessage,
  stderrLabel,
  className,
}: ToolCommandViewProps) {
  const t = useStrings(toolViewsStrings);
  const [expanded, setExpanded] = useState(false);
  if (noOutput || (stdout === "" && stderr === "")) {
    return (
      <div data-slot="tool-empty" className={joinClass("ui-tool-views__empty", className)}>
        {emptyMessage ?? t.noOutput}
      </div>
    );
  }
  const long = stdout.length > maxLength;
  const shown = long && !expanded ? `${stdout.slice(0, maxLength)}…` : stdout;
  return (
    <div data-slot="command-output" className={className}>
      {stdout !== "" ? (
        <pre data-slot="plain-text" className="ui-tool-views__plain-text">
          {shown}
        </pre>
      ) : null}
      {long ? (
        <div data-slot="result-toggle" className="ui-tool-views__result-toggle">
          <Button variant="secondary" size="sm" onPress={() => setExpanded((current) => !current)}>
            {expanded ? t.showLess : t.showAll}
          </Button>
        </div>
      ) : null}
      {stderr !== "" ? (
        <div data-slot="command-stderr" className="ui-tool-views__stderr">
          <div data-slot="command-stderr-label" className="ui-tool-views__stderr-label">
            {stderrLabel ?? t.stderr}
          </div>
          <pre data-slot="plain-text" className="ui-tool-views__stderr-text">
            {stderr}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 6. ToolChecklist ---------- */

export type ToolChecklistStatus = "pending" | "in_progress" | "completed";

export interface ToolChecklistItem {
  /** 步骤文本。 */
  content: string;
  /** 当前状态。 */
  status: ToolChecklistStatus;
}

export interface ToolChecklistStatusIconProps {
  /** 步骤状态。 */
  status: ToolChecklistStatus;
  /** 自定义类名。 */
  className?: string;
}

/** 带无障碍状态名称的任务步骤图标。 */
export function ToolChecklistStatusIcon({ status, className }: ToolChecklistStatusIconProps) {
  const t = useStrings(toolViewsStrings);
  const label =
    status === "completed" ? t.statusCompleted : status === "in_progress" ? t.statusInProgress : t.statusPending;
  const icon =
    status === "completed" ? (
      <CircleCheckIcon />
    ) : status === "in_progress" ? (
      <MinusIcon />
    ) : (
      <CircleDashedIcon />
    );
  return (
    <span
      role="img"
      aria-label={label}
      data-slot="todo-status-icon"
      data-status={status}
      className={joinClass("ui-tool-checklist__icon", className)}
    >
      {icon}
    </span>
  );
}

export interface ToolChecklistRowProps {
  /** 单条步骤数据。 */
  item: ToolChecklistItem;
  /** 自定义类名。 */
  className?: string;
}

/** 单条任务清单行。 */
export function ToolChecklistRow({ item, className }: ToolChecklistRowProps) {
  return (
    <div
      role="listitem"
      data-slot="todo-item"
      data-status={item.status}
      className={joinClass("ui-tool-checklist__item", className)}
    >
      <ToolChecklistStatusIcon status={item.status} className="ui-tool-checklist__item-icon" />
      <span data-slot="todo-item-content" data-status={item.status} className="ui-tool-checklist__content">
        {item.content}
      </span>
    </div>
  );
}

export interface ToolChecklistProps {
  /** 任务步骤数组。 */
  items: readonly ToolChecklistItem[];
  /** 自定义类名。 */
  className?: string;
}

/** 助手任务清单工具视图，清晰呈现已完成、进行中与待处理步骤。 */
export function ToolChecklist({ items, className }: ToolChecklistProps) {
  return (
    <div role="list" data-slot="todo-item-list" className={joinClass("ui-tool-checklist", className)}>
      {items.map((item, i) => (
        <ToolChecklistRow key={i} item={item} />
      ))}
    </div>
  );
}

/* ---------- 7. ToolWebSources ---------- */

export interface ToolWebSource {
  /** 来源网页标题。 */
  title: string;
  /** 来源链接地址。 */
  url?: string;
  /** 可选摘要片段。 */
  snippet?: string;
  /** 可选来源域名或站点名称。 */
  domain?: string;
}

export interface ToolWebSourcesProps {
  /** 网页检索结果列表。 */
  sources: readonly ToolWebSource[];
  /** 点击外部链接时的自定义打开回调（如桌面端调用系统浏览器）；未传入时以新标签页打开。 */
  onOpen?: (url: string) => void;
  /** 自定义类名。 */
  className?: string;
}

function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** 联网搜索工具的来源引用列表视图。 */
export function ToolWebSources({ sources, onOpen, className }: ToolWebSourcesProps) {
  return (
    <div data-slot="web-sources" className={joinClass("ui-tool-web", className)}>
      {sources.map((src, i) => {
        const host = src.domain ?? hostOf(src.url);
        const content = (
          <>
            <span className="ui-tool-web__head">
              <span className="ui-tool-web__title">{src.title}</span>
              {src.url ? <ArrowUpRightIcon className="ui-tool-web__arrow" /> : null}
            </span>
            {host ? <span className="ui-tool-web__domain">{host}</span> : null}
            {src.snippet ? <span className="ui-tool-web__snippet">{src.snippet}</span> : null}
          </>
        );
        if (src.url) {
          return (
            <AriaLink
              key={`${src.url}-${i}`}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              onPress={
                onOpen
                  ? (event) => {
                      event.continuePropagation();
                      onOpen(src.url!);
                    }
                  : undefined
              }
              onClick={
                onOpen
                  ? (event) => {
                      event.preventDefault();
                    }
                  : undefined
              }
              className="ui-tool-web__item"
            >
              {content}
            </AriaLink>
          );
        }
        return (
          <div key={`${src.title}-${i}`} className="ui-tool-web__item">
            {content}
          </div>
        );
      })}
    </div>
  );
}
