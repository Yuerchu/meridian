"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ButtonProps as AriaButtonProps,
  DisclosurePanelProps as AriaDisclosurePanelProps,
  DisclosureProps as AriaDisclosureProps,
} from "react-aria-components";
import { Button as AriaButton, Disclosure, DisclosurePanel, DisclosureStateContext } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { useStrings } from "../../lib/i18n";
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon, ClockIcon } from "../../lib/icons";
import { BUBBLE_BLOCK, BUBBLE_BLOCK_HOVER } from "../chat-bubble/chat-bubble";
import { Spinner } from "../spinner/spinner";
import { Tooltip, TooltipTrigger } from "../tooltip/tooltip";
import { chatToolStrings } from "./chat-tool.strings";
import "./chat-tool.css";

/**
 * 可组合的 AI 工具调用块与结构化参数/结果展示组件，支持独立卡片（card）与气泡内联块（bubble）两种形态、排队状态、审批底栏以及 MCP 内容结构化渲染。
 *
 * @packageDocumentation
 * @category AI
 * @status 实验中
 */

export type ChatToolState =
  | "input-streaming"
  | "input-available"
  | "queued"
  | "output-available"
  | "output-error"
  | "requires-action";

export type ChatToolPresentation = "card" | "bubble";

function joinClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

const ChatToolStateContext = createContext<ChatToolState>("input-available");
const InsideChatToolFooterContext = createContext(false);

/** 当前工具调用形态上下文，默认为 `"card"`。 */
export const ChatToolPresentationContext = createContext<ChatToolPresentation>("card");

export interface ChatToolPresentationProviderProps {
  /** 子树内工具块的展示形态：`card` 为独立卡片，`bubble` 为嵌入 `Bubble` 的直系块。 */
  value: ChatToolPresentation;
  /** 子树内容。 */
  children: ReactNode;
}

/** 为子树内的 `ChatTool` 指定 `card` 或 `bubble` 展示形态。 */
export function ChatToolPresentationProvider({ value, children }: ChatToolPresentationProviderProps) {
  return <ChatToolPresentationContext.Provider value={value}>{children}</ChatToolPresentationContext.Provider>;
}

export interface ChatToolProps extends Omit<AriaDisclosureProps, "className" | "children"> {
  /**
   * 工具调用状态；`queued` 表示排在前方调用之后等待执行，`requires-action` 表示等待用户确认或作答。
   * @default "input-available"
   */
  state?: ChatToolState;
  /** 自定义根元素类名。 */
  className?: string;
  /** 工具块内容，通常包含 `ChatToolTrigger` 与 `ChatToolContent`。 */
  children?: ReactNode;
}

/** 可折叠的工具调用根容器，自动感知上下文中的 `card` 或 `bubble` 形态。 */
export function ChatTool({ state = "input-available", className, children, ...props }: ChatToolProps) {
  const presentation = useContext(ChatToolPresentationContext);
  const active = state === "input-streaming" || state === "input-available";
  const asBubble = presentation === "bubble";
  return (
    <ChatToolStateContext.Provider value={state}>
      <Disclosure
        data-slot="chat-tool"
        data-state={state}
        data-active={active || undefined}
        data-presentation={presentation}
        data-bubble-block={asBubble ? "" : undefined}
        className={withUiClass(asBubble ? `ui-chat-tool ${BUBBLE_BLOCK}` : "ui-chat-tool", className)}
        {...props}
      >
        {children}
      </Disclosure>
    </ChatToolStateContext.Provider>
  );
}

export interface ChatToolTriggerProps extends Omit<AriaButtonProps, "className" | "children" | "style"> {
  /** 自定义类名。 */
  className?: string;
  /** 贴在右侧展开箭头前的补充内容，例如进度计数、耗时或状态徽标。 */
  endContent?: ReactNode;
  /** 标题下方的补充说明；在 `bubble` 形态且未等待确认时自动收纳为悬停 Tooltip。 */
  subtitle?: ReactNode;
  /** 主标签内容，通常包含状态图标、工具名与关键参数摘要。 */
  children?: ReactNode;
}

/** 工具调用的折叠触发行。 */
export function ChatToolTrigger({ className, children, endContent, subtitle, ...props }: ChatToolTriggerProps) {
  const state = useContext(ChatToolStateContext);
  const presentation = useContext(ChatToolPresentationContext);
  const requiresAction = state === "requires-action";
  const hasSubtitle = subtitle != null && subtitle !== "";

  const trigger = (
    <AriaButton
      slot="trigger"
      data-slot="chat-tool-trigger"
      data-state={state}
      data-presentation={presentation}
      className={withUiClass(
        presentation === "bubble" ? `ui-chat-tool__trigger ${BUBBLE_BLOCK_HOVER}` : "ui-chat-tool__trigger",
        className,
      )}
      {...props}
    >
      <div data-slot="chat-tool-trigger-lines" data-presentation={presentation} className="ui-chat-tool__trigger-lines">
        <div
          data-slot="chat-tool-trigger-label"
          data-presentation={presentation}
          data-requires-action={requiresAction || undefined}
          className="ui-chat-tool__trigger-label"
        >
          {children}
        </div>
        {(presentation === "card" ? hasSubtitle : requiresAction && hasSubtitle) ? (
          <span data-slot="chat-tool-subtitle" data-presentation={presentation} className="ui-chat-tool__subtitle">
            {subtitle}
          </span>
        ) : null}
      </div>
      <span data-slot="chat-tool-trigger-end" data-presentation={presentation} className="ui-chat-tool__trigger-end">
        {endContent}
        <span data-slot="disclosure-indicator" aria-hidden="true" className="ui-chat-tool__indicator">
          <ChevronRightIcon className="ui-chat-tool__chevron" />
        </span>
      </span>
    </AriaButton>
  );

  if (presentation === "bubble") {
    if (!requiresAction && hasSubtitle) {
      return (
        <TooltipTrigger>
          {trigger}
          <Tooltip placement="top">{subtitle}</Tooltip>
        </TooltipTrigger>
      );
    }
    return trigger;
  }

  return (
    <div data-slot="disclosure-heading" className="ui-chat-tool__heading">
      {trigger}
    </div>
  );
}

export interface ChatToolStatusIconProps {
  /** 自定义类名。 */
  className?: string;
}

/** 跟随当前 `ChatTool` 状态渲染执行中、排队、成功、失败或待确认图标。 */
export function ChatToolStatusIcon({ className }: ChatToolStatusIconProps) {
  const state = useContext(ChatToolStateContext);
  switch (state) {
    case "input-streaming":
    case "input-available":
      return (
        <span aria-hidden="true" data-slot="chat-tool-status-icon">
          <Spinner size="sm" />
        </span>
      );
    case "queued":
      return (
        <ClockIcon
          data-slot="chat-tool-status-icon"
          data-state="queued"
          className={joinClass("ui-chat-tool__status-icon", className)}
        />
      );
    case "output-available":
      return (
        <CircleCheckIcon
          data-slot="chat-tool-status-icon"
          data-state="output-available"
          className={joinClass("ui-chat-tool__status-icon", className)}
        />
      );
    case "output-error":
      return (
        <CircleXIcon
          data-slot="chat-tool-status-icon"
          data-state="output-error"
          className={joinClass("ui-chat-tool__status-icon", className)}
        />
      );
    case "requires-action":
      return (
        <CircleAlertIcon
          data-slot="chat-tool-status-icon"
          data-state="requires-action"
          className={joinClass("ui-chat-tool__status-icon", className)}
        />
      );
  }
}

function isFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function overlayIsOpen(doc: Document): boolean {
  const candidates = doc.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"]');
  for (const el of candidates) {
    if (typeof el.checkVisibility !== "function" || el.checkVisibility()) return true;
  }
  return false;
}

interface ChatToolFooterSlot {
  node: HTMLElement;
  occupy: () => () => void;
}

const ChatToolFooterContext = createContext<ChatToolFooterSlot | undefined>(undefined);

function useFooterOccupancy(footer: ChatToolFooterSlot | undefined) {
  useEffect(() => footer?.occupy(), [footer]);
}

export interface ChatToolContentProps extends Omit<AriaDisclosurePanelProps, "className" | "children"> {
  /** 自定义内容面板类名。 */
  className?: string;
  /** 展开后的面板内容。 */
  children?: ReactNode;
}

/** 工具调用展开面板；在 `bubble` 形态下支持按 `Esc` 收起并归还焦点，并托管底部的审批或操作槽。 */
export function ChatToolContent({ className, children, ...props }: ChatToolContentProps) {
  const presentation = useContext(ChatToolPresentationContext);
  const state = useContext(ChatToolStateContext);
  const disclosure = useContext(DisclosureStateContext);

  const [occupants, setOccupants] = useState(0);
  const [footer] = useState<ChatToolFooterSlot | undefined>(() => {
    if (typeof document === "undefined") return undefined;
    const node = document.createElement("div");
    node.dataset.slot = "chat-tool-footer-host";
    node.className = "ui-chat-tool__footer-host";
    return {
      node,
      occupy: () => {
        setOccupants((n) => n + 1);
        return () => setOccupants((n) => n - 1);
      },
    };
  });

  const adoptFooter = useCallback(
    (host: HTMLDivElement | null) => {
      if (!footer) return;
      if (host) host.appendChild(footer.node);
      else footer.node.remove();
    },
    [footer],
  );

  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || presentation !== "bubble") return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isFormControl(event.target)) return;
      const panel = body.closest<HTMLElement>('[data-slot="chat-tool-content"]');
      if (!panel) return;
      if (overlayIsOpen(panel.ownerDocument)) return;
      if (typeof panel.checkVisibility === "function" && !panel.checkVisibility()) return;
      event.preventDefault();
      event.stopPropagation();
      disclosure?.collapse();
      const id = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(panel.id) : panel.id;
      panel.ownerDocument.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
    };
    body.addEventListener("keydown", onKeyDown);
    return () => body.removeEventListener("keydown", onKeyDown);
  }, [disclosure, presentation]);

  if (presentation === "bubble") {
    return (
      <DisclosurePanel
        data-slot="chat-tool-content"
        data-presentation="bubble"
        className="ui-chat-tool__content"
        {...props}
      >
        <div
          ref={bodyRef}
          data-slot="disclosure-body"
          data-presentation="bubble"
          className="ui-chat-tool__body"
        >
          <ChatToolFooterContext.Provider value={footer}>
            <div
              data-slot="chat-tool-panel"
              data-state={state}
              className={joinClass("ui-chat-tool__panel", className)}
            >
              {children}
              {occupants > 0 ? (
                <div
                  data-slot="chat-tool-panel-footer"
                  data-presentation="bubble"
                  className="ui-chat-tool__panel-footer"
                >
                  <div
                    ref={adoptFooter}
                    data-slot="chat-tool-panel-footer-slot"
                    className="ui-chat-tool__panel-footer-slot"
                  />
                </div>
              ) : null}
            </div>
          </ChatToolFooterContext.Provider>
        </div>
      </DisclosurePanel>
    );
  }

  return (
    <DisclosurePanel data-slot="chat-tool-content" className="ui-chat-tool__content" {...props}>
      <div
        data-slot="disclosure-body"
        data-presentation="card"
        className={joinClass("ui-chat-tool__body", className)}
      >
        {children}
      </div>
    </DisclosurePanel>
  );
}

export interface ChatToolPanelHeaderProps extends Omit<ComponentProps<"div">, "title"> {
  /** 面板标题（如完整路径或命令摘要）。 */
  heading?: ReactNode;
  /** 标题下方的补充说明。 */
  description?: ReactNode;
  /** 右侧附加内容（如差异统计或耗时标签）。 */
  end?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 工具调用展开面板的头部区。 */
export function ChatToolPanelHeader({ heading, description, end, className, ref, ...props }: ChatToolPanelHeaderProps) {
  const bare = heading == null && description == null;
  return (
    <div
      ref={ref}
      data-slot="chat-tool-panel-header"
      data-bare={bare || undefined}
      className={joinClass("ui-chat-tool__panel-header", className)}
      {...props}
    >
      <div data-slot="chat-tool-panel-lines" className="ui-chat-tool__panel-lines">
        {heading != null ? (
          <span data-slot="chat-tool-panel-title" className="ui-chat-tool__panel-title">
            {heading}
          </span>
        ) : null}
        {description != null ? (
          <span data-slot="chat-tool-panel-description" className="ui-chat-tool__panel-description">
            {description}
          </span>
        ) : null}
      </div>
      {end != null ? (
        <div data-slot="chat-tool-panel-end" className="ui-chat-tool__panel-end">
          {end}
        </div>
      ) : null}
    </div>
  );
}

export interface ChatToolPanelBodyProps extends ComponentProps<"div"> {
  /** 面板主体内容。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 工具调用展开面板的主体区。 */
export function ChatToolPanelBody({ className, children, ref, ...props }: ChatToolPanelBodyProps) {
  return (
    <div
      ref={ref}
      data-slot="chat-tool-panel-body"
      className={joinClass("ui-chat-tool__panel-body", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ChatToolPanelFooterProps extends ComponentProps<"div"> {
  /** 面板底栏内容；在 `bubble` 形态下会自动传送至面板最底端。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 工具调用展开面板的底栏区。 */
export function ChatToolPanelFooter({ className, children, ref, ...props }: ChatToolPanelFooterProps) {
  const presentation = useContext(ChatToolPresentationContext);
  const footer = useContext(ChatToolFooterContext);
  const inFooter = presentation === "bubble" && footer !== undefined;
  useFooterOccupancy(inFooter ? footer : undefined);
  const wrapped = <InsideChatToolFooterContext.Provider value={true}>{children}</InsideChatToolFooterContext.Provider>;
  if (inFooter) {
    return createPortal(
      <div
        ref={ref}
        data-slot="chat-tool-panel-footer-item"
        className={joinClass("ui-chat-tool__panel-footer-item", className)}
        {...props}
      >
        {wrapped}
      </div>,
      footer.node,
    );
  }
  return (
    <div
      ref={ref}
      data-slot="chat-tool-panel-footer"
      data-presentation="card"
      className={joinClass("ui-chat-tool__panel-footer", className)}
      {...props}
    >
      {wrapped}
    </div>
  );
}

export interface ChatToolErrorProps extends ComponentProps<"div"> {
  /** 错误详情文案。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 工具调用的错误提示区块。 */
export function ChatToolError({ className, ref, ...props }: ChatToolErrorProps) {
  return <div ref={ref} data-slot="chat-tool-error" className={joinClass("ui-chat-tool__error", className)} {...props} />;
}

export interface ChatToolApprovalProps extends ComponentProps<"div"> {
  /** 显示在审批操作按钮上方的说明或风险提示（例如沙箱提权说明）。 */
  notice?: ReactNode;
  /** 审批操作按钮（如拒绝、允许）。 */
  children?: ReactNode;
  /** 自定义类名。 */
  className?: string;
  /** 元素引用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 工具调用的审批操作行；`card` 形态右对齐，`bubble` 形态均分整行并自动置底。 */
export function ChatToolApproval({ notice, className, children, ref, ...props }: ChatToolApprovalProps) {
  const presentation = useContext(ChatToolPresentationContext);
  const footer = useContext(ChatToolFooterContext);
  const insideFooter = useContext(InsideChatToolFooterContext);
  const inFooter = presentation === "bubble" && footer !== undefined && !insideFooter;
  useFooterOccupancy(inFooter ? footer : undefined);
  const row = (
    <div
      ref={ref}
      data-slot="chat-tool-approval"
      data-presentation={presentation}
      className={joinClass("ui-chat-tool__approval", className)}
      {...props}
    >
      {notice ? (
        <div data-slot="chat-tool-approval-notice" className="ui-chat-tool__approval-notice">
          {notice}
        </div>
      ) : null}
      <div
        data-slot="chat-tool-approval-actions"
        data-presentation={presentation}
        className="ui-chat-tool__approval-actions"
      >
        {children}
      </div>
    </div>
  );
  return inFooter ? createPortal(row, footer.node) : row;
}

/* ---------- 结构化参数与结果展示（ToolValue / ToolFields / ToolTextResult） ---------- */

const MAX_DEPTH = 6;
const INLINE_STRING_LIMIT = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断值是否适合和键名同行内联展示（标量或短单行字符串）。 */
export function isInlineToolValue(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") return !value.includes("\n") && value.length <= INLINE_STRING_LIMIT;
  return false;
}

/** 尝试将工具返回的文本解析为结构化 JSON 对象或数组，非结构化文本返回 `null`。 */
export function parseStructuredToolValue(text: string): Record<string, unknown> | unknown[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) || isRecord(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function defaultFormatKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

type McpPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri?: string; text?: string } };

function asMcpContent(value: unknown): McpPart[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ok = value.every(
    (part) =>
      isRecord(part) &&
      ((part.type === "text" && typeof part.text === "string") ||
        (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") ||
        (part.type === "resource" && isRecord(part.resource))),
  );
  return ok ? (value as McpPart[]) : null;
}

function Scalar({ value }: { value: null | number | boolean | string }) {
  const t = useStrings(chatToolStrings);
  if (value === null) {
    return (
      <span data-slot="tool-value-null" className="ui-tool-value__muted">
        {t.none}
      </span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span data-slot="tool-value-boolean" data-value={value} className="ui-tool-value__boolean">
        {value ? t.yes : t.no}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span data-slot="tool-value-number" className="ui-tool-value__number">
        {value}
      </span>
    );
  }
  if (value === "") {
    return (
      <span data-slot="tool-value-empty" className="ui-tool-value__muted">
        {t.empty}
      </span>
    );
  }
  return (
    <span data-slot="tool-value-string" className="ui-tool-value__string">
      {value}
    </span>
  );
}

function LongText({ text }: { text: string }) {
  return (
    <pre data-slot="tool-value-text" className="ui-tool-value__text">
      {text}
    </pre>
  );
}

function tableShape(items: unknown[]): string[] | null {
  if (items.length < 2 || !items.every(isRecord)) return null;
  const keys = Object.keys(items[0] as Record<string, unknown>);
  if (keys.length === 0 || keys.length > 6) return null;
  const same = items.every((item) => {
    const k = Object.keys(item as Record<string, unknown>);
    return k.length === keys.length && keys.every((key) => k.includes(key));
  });
  if (!same) return null;
  const flat = items.every((item) =>
    keys.every((key) => {
      const v = (item as Record<string, unknown>)[key];
      return isInlineToolValue(v) || (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length < 40));
    }),
  );
  return flat ? keys : null;
}

function InlineList({ items }: { items: string[] }) {
  const t = useStrings(chatToolStrings);
  if (items.length === 0) {
    return (
      <span data-slot="tool-value-empty" className="ui-tool-value__muted">
        {t.empty}
      </span>
    );
  }
  return (
    <span data-slot="tool-value-chips" className="ui-tool-value__chips">
      {items.map((item, i) => (
        <span key={i} data-slot="tool-value-chip" className="ui-tool-value__chip">
          {item}
        </span>
      ))}
    </span>
  );
}

function isCompactTableValue(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return true;
  return typeof value === "string" && value.length <= 16;
}

function ValueTable({
  items,
  keys,
  formatKey,
}: {
  items: Record<string, unknown>[];
  keys: string[];
  formatKey: (key: string) => string;
}) {
  return (
    <div data-slot="tool-value-table-scroll" className="ui-tool-value__table-scroll">
      <table data-slot="tool-value-table" className="ui-tool-value__table">
        <thead data-slot="tool-value-table-head">
          <tr data-slot="tool-value-table-row">
            {keys.map((key) => (
              <th key={key} data-slot="tool-value-table-header" className="ui-tool-value__table-header">
                {formatKey(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-slot="tool-value-table-body">
          {items.map((item, i) => (
            <tr key={i} data-slot="tool-value-table-row" className="ui-tool-value__table-row">
              {keys.map((key) => {
                const v = item[key];
                const compact = isCompactTableValue(v);
                return (
                  <td
                    key={key}
                    data-slot="tool-value-table-cell"
                    data-compact={compact || undefined}
                    className="ui-tool-value__table-cell"
                  >
                    {Array.isArray(v) ? (
                      <InlineList items={v as string[]} />
                    ) : (
                      <Scalar value={v as null | number | boolean | string} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function McpContent({ parts, formatKey }: { parts: McpPart[]; formatKey: (key: string) => string }) {
  return (
    <div data-slot="tool-value-mcp" className="ui-tool-value__mcp">
      {parts.map((part, i) => {
        if (part.type === "text") {
          const nested = parseStructuredToolValue(part.text);
          return nested !== null ? (
            <ToolValue key={i} value={nested} depth={1} formatKey={formatKey} />
          ) : (
            <LongText key={i} text={part.text} />
          );
        }
        if (part.type === "image") {
          return (
            <img
              key={i}
              data-slot="tool-value-image"
              alt=""
              src={`data:${part.mimeType};base64,${part.data}`}
              className="ui-tool-value__image"
            />
          );
        }
        return (
          <div key={i} data-slot="tool-value-resource" className="ui-tool-value__resource">
            {part.resource.uri ? (
              <span data-slot="tool-value-resource-uri" className="ui-tool-value__resource-uri">
                {part.resource.uri}
              </span>
            ) : null}
            {part.resource.text ? <LongText text={part.resource.text} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export interface ToolFieldsProps {
  /** 要展示的键值对数组。 */
  entries: [string, unknown][];
  /**
   * 当前嵌套深度，超过上限时以省略号截断。
   * @default 0
   */
  depth?: number;
  /** 字段名格式化函数，默认将下划线或驼峰转为空格分隔文本。 */
  formatKey?: (key: string) => string;
  /** 自定义类名。 */
  className?: string;
}

/** 将工具参数或对象条目渲染为带标签的键值对列表。 */
export function ToolFields({ entries, depth = 0, formatKey = defaultFormatKey, className }: ToolFieldsProps) {
  const t = useStrings(chatToolStrings);
  if (entries.length === 0) {
    return (
      <span data-slot="tool-value-empty" className="ui-tool-value__muted">
        {t.empty}
      </span>
    );
  }
  return (
    <dl data-slot="tool-fields" className={joinClass("ui-tool-value__fields", className)}>
      {entries.map(([key, value]) => {
        const inline = isInlineToolValue(value);
        return (
          <div key={key} data-slot="tool-field" data-inline={inline || undefined} className="ui-tool-value__field">
            <dt data-slot="tool-field-label" className="ui-tool-value__field-label">
              {formatKey(key)}
            </dt>
            <dd data-slot="tool-field-value" className="ui-tool-value__field-value">
              <ToolValue value={value} depth={depth + 1} formatKey={formatKey} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export interface ToolValueProps {
  /** 任意结构化数据值（标量、数组、对象或 MCP 内容块数组）。 */
  value: unknown;
  /**
   * 当前嵌套深度，超过 6 层以省略号截断。
   * @default 0
   */
  depth?: number;
  /** 字段名格式化函数。 */
  formatKey?: (key: string) => string;
}

/** 将任意未知形态的工具参数或返回值按数据结构渲染为可读视图，而非原始 JSON 字符串。 */
export function ToolValue({ value, depth = 0, formatKey = defaultFormatKey }: ToolValueProps) {
  const t = useStrings(chatToolStrings);
  if (depth > MAX_DEPTH) {
    return (
      <span data-slot="tool-value-deep" className="ui-tool-value__muted">
        …
      </span>
    );
  }
  if (value === null || value === undefined) return <Scalar value={null} />;
  if (typeof value === "number" || typeof value === "boolean") return <Scalar value={value} />;
  if (typeof value === "string") return isInlineToolValue(value) ? <Scalar value={value} /> : <LongText text={value} />;
  const mcp = asMcpContent(value);
  if (mcp) return <McpContent parts={mcp} formatKey={formatKey} />;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span data-slot="tool-value-empty" className="ui-tool-value__muted">
          {t.emptyList}
        </span>
      );
    }
    if (value.every((item) => typeof item === "string" && isInlineToolValue(item))) {
      return <InlineList items={value as string[]} />;
    }
    const keys = tableShape(value);
    if (keys) return <ValueTable items={value as Record<string, unknown>[]} keys={keys} formatKey={formatKey} />;
    return (
      <ol data-slot="tool-value-list" className="ui-tool-value__list">
        {value.map((item, i) => (
          <li
            key={i}
            data-slot="tool-value-list-item"
            data-record={isRecord(item) || undefined}
            className="ui-tool-value__list-item"
          >
            <ToolValue value={item} depth={depth + 1} formatKey={formatKey} />
          </li>
        ))}
      </ol>
    );
  }
  if (isRecord(value)) return <ToolFields entries={Object.entries(value)} depth={depth} formatKey={formatKey} />;
  return <Scalar value={String(value)} />;
}

export interface ToolTextResultProps {
  /** 工具返回的原始文本；若为 JSON 对象或数组则自动结构化展示，否则保留原文换行。 */
  text: string;
  /** 字段名格式化函数。 */
  formatKey?: (key: string) => string;
  /** 自定义类名。 */
  className?: string;
}

/** 自动识别工具结果文本是否为结构化 JSON 并以最佳形态渲染。 */
export function ToolTextResult({ text, formatKey, className }: ToolTextResultProps) {
  const structured = useMemo(() => parseStructuredToolValue(text), [text]);
  if (structured !== null) {
    return (
      <div data-slot="tool-structured-result" className={joinClass("ui-tool-value__structured", className)}>
        <ToolValue value={structured} formatKey={formatKey} />
      </div>
    );
  }
  return (
    <pre data-slot="tool-text-result" className={joinClass("ui-tool-value__plain", className)}>
      {text}
    </pre>
  );
}
