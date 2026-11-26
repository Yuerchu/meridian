"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DropEvent, DropOperation, DragTypes } from "react-aria";
import { mergeProps, useButton, useDrop, useFocusRing, useHover } from "react-aria";
import { Button } from "../button/button";
import { Menu, MenuItem, MenuTrigger } from "../menu/menu";
import { TextField } from "../text-field/text-field";
import { useStrings } from "../../lib/i18n";
import { ChevronDownIcon, ChevronRightIcon, MoreIcon, PenIcon } from "../../lib/icons";
import { pathBarStrings } from "./path-bar.strings";
import "./path-bar.css";

/**
 * 用于文件管理器或对象存储顶部的路径导航栏，支持点击各级返回、下拉展开子目录、接收文件拖放以及切换为输入框直接编辑路径。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface PathSegment {
  /** 稳定的标识，例如文件夹 id。 */
  id: string;
  /** 显示的名称。 */
  label: string;
  /** 该层级前置的装饰性图标（例如根目录磁盘图标），仅作视觉装饰。 */
  icon?: ReactNode;
}

export interface PathBarProps {
  /** 从根目录到当前位置的路径层级列表，最后一项表示当前位置。 */
  segments: readonly PathSegment[];
  /** 点击某一级路径或在下拉菜单中选择子目录时触发，参数为目标节点的 id。 */
  onNavigate: (id: string) => void;
  /**
   * 获取指定层级的子目录列表；传入后每一级右侧会出现下拉按钮，展开时调用并支持返回 Promise。
   */
  getChildren?: (id: string) => readonly PathSegment[] | Promise<readonly PathSegment[]>;
  /**
   * 提交编辑后的路径文本；传入后点击路径栏空白处或编辑按钮会切换为输入框，回车提交时若返回 `false`（或 `Promise<false>`），输入框会保持打开。
   */
  onPathSubmit?: (path: string) => boolean | void | Promise<boolean | void>;
  /**
   * 进入路径编辑模式时输入框的初始文本。
   * @default 各级名称以“/”拼接
   */
  pathText?: string;
  /** 将文件拖放到某一级路径时触发，参数为目标节点的 id 与 React Aria 的 `DropEvent`。 */
  onDrop?: (id: string, event: DropEvent) => void;
  /** 判断某一级是否允许接收当前拖放内容；默认除当前所在位置外均可拖入。 */
  canDrop?: (id: string, types: DragTypes) => boolean;
  /** 路径导航区域的无障碍名称。 @default "路径"（英文界面 "Path"） */
  "aria-label"?: string;
  /** 自定义类名。 */
  className?: string;
}

/**
 * 显示从根目录到当前位置的路径层级，空间不足时自动保留根目录与靠近当前位置的各级，并将中间层级折叠进“…”菜单。
 */
export function PathBar({
  segments,
  onNavigate,
  getChildren,
  onPathSubmit,
  pathText,
  onDrop,
  canDrop,
  "aria-label": ariaLabel,
  className,
}: PathBarProps) {
  const t = useStrings(pathBarStrings);
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const measure = useRef<HTMLOListElement>(null);
  const editButton = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);
  const editable = onPathSubmit !== undefined;

  // 量出每一级的宽度（看不见的那一份），决定中间折叠几级：第一级和当前位置总是显示，从当前位置往前尽量多放
  useLayoutEffect(() => {
    const el = list.current;
    const ruler = measure.current;
    if (!el || !ruler || editing) return;
    const update = () => {
      // 最后一个是"…"按钮和它后面的分隔符
      const all = [...ruler.children].map((item) => item.getBoundingClientRect().width);
      const more = all.pop() ?? 0;
      const widths = all;
      const available = el.clientWidth;
      const total = widths.reduce((sum, w) => sum + w, 0);
      if (total <= available || segments.length <= 2) {
        setHidden((prev) => (prev.length ? [] : prev));
        return;
      }
      let used = (widths[0] ?? 0) + (widths.at(-1) ?? 0) + more;
      let first = segments.length - 1;
      while (first > 1 && used + (widths[first - 1] ?? 0) <= available) {
        used += widths[first - 1] ?? 0;
        first--;
      }
      const next = Array.from({ length: first - 1 }, (_, i) => i + 1);
      setHidden((prev) => (prev.join() === next.join() ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(ruler);
    return () => observer.disconnect();
  }, [segments, editing]);

  // 点路径栏的空白处进入输入：不是可以聚焦的控件（键盘用"编辑路径"按钮），挂原生监听
  useEffect(() => {
    const el = list.current;
    if (!el || !editable || editing) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("button, a, [role=button]")) return;
      setEditing(true);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [editable, editing]);

  const finish = (refocus: boolean) => {
    setEditing(false);
    // 输入框消失：焦点回到"编辑路径"按钮，不掉到页面开头
    if (refocus) requestAnimationFrame(() => editButton.current?.querySelector("button")?.focus());
  };

  const visible = segments.map((segment, index) => ({ segment, index })).filter(({ index }) => !hidden.includes(index));
  const current = segments.length - 1;

  return (
    <nav ref={root} aria-label={ariaLabel ?? t.label} className={className ? `ui-path-bar ${className}` : "ui-path-bar"} data-editing={editing || undefined} data-editable={editable || undefined}>
      {editing ? (
        <PathInput
          initial={pathText ?? segments.map((s) => s.label).join("/")}
          label={t.input}
          onCancel={() => finish(true)}
          onSubmit={async (value) => {
            const ok = await onPathSubmit?.(value);
            if (ok !== false) finish(true);
          }}
        />
      ) : (
        <>
          <ol ref={list} className="ui-path-bar__list">
            {visible.map(({ segment, index }, position) => (
              <li key={segment.id} className="ui-path-bar__item">
                {position === 1 && hidden.length ? (
                  <MenuTrigger>
                    <Button variant="ghost" size="sm" icon={<MoreIcon />} aria-label={t.more({ count: hidden.length })} className="ui-path-bar__more" />
                    <Menu onAction={(key) => onNavigate(String(key))}>
                      {hidden.map((i) => (
                        <MenuItem key={segments[i]!.id} id={segments[i]!.id} icon={segments[i]!.icon}>{segments[i]!.label}</MenuItem>
                      ))}
                    </Menu>
                  </MenuTrigger>
                ) : null}
                {position === 1 && hidden.length ? <ChevronRightIcon className="ui-path-bar__separator" /> : null}
                <Segment segment={segment} isCurrent={index === current} onNavigate={onNavigate}
                  onDrop={onDrop} canDrop={canDrop} />
                {getChildren ? <ChildrenMenu segment={segment} getChildren={getChildren} onNavigate={onNavigate} /> : null}
                {index === current ? null : <ChevronRightIcon className="ui-path-bar__separator" />}
              </li>
            ))}
          </ol>
          {editable ? (
            <div ref={editButton} className="ui-path-bar__edit">
              <Button variant="ghost" size="sm" icon={<PenIcon />} aria-label={t.edit} onPress={() => setEditing(true)} />
            </div>
          ) : null}
        </>
      )}
      {/* 量宽度用的一份：看不见、读屏和焦点都碰不到 */}
      {!editing ? (
        <div className="ui-path-bar__ruler" aria-hidden="true" inert>
        <ol ref={measure} className="ui-path-bar__list ui-path-bar__measure">
          {segments.map((segment, index) => (
            <li key={segment.id} className="ui-path-bar__item">
              <span className="ui-path-bar__segment" data-current={index === current || undefined}>
                {segment.icon}
                <span className="ui-path-bar__label">{segment.label}</span>
              </span>
              {getChildren ? <span className="ui-path-bar__children-measure" /> : null}
              {index === current ? null : <ChevronRightIcon className="ui-path-bar__separator" />}
            </li>
          ))}
          <li className="ui-path-bar__item">
            <span className="ui-path-bar__more-measure" />
            <ChevronRightIcon className="ui-path-bar__separator" />
          </li>
        </ol>
        </div>
      ) : null}
    </nav>
  );
}

function Segment({ segment, isCurrent, onNavigate, onDrop, canDrop }: {
  segment: PathSegment;
  isCurrent: boolean;
  onNavigate: (id: string) => void;
  onDrop?: PathBarProps["onDrop"];
  canDrop?: PathBarProps["canDrop"];
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { dropProps, isDropTarget } = useDrop({
    // 只拖到上面才算，键盘拖放（React Aria）也能选中这一级
    ref,
    isDisabled: !onDrop,
    getDropOperation: (types, allowed): DropOperation => {
      const ok = canDrop ? canDrop(segment.id, types) : !isCurrent;
      return ok ? (allowed.includes("move") ? "move" : allowed[0] ?? "cancel") : "cancel";
    },
    onDrop: (event) => onDrop?.(segment.id, event),
  });
  // React Aria 的 Button 组件不把拖放事件（dragenter / dragover / drop）转给 DOM，放下会悄悄失效：
  // 这里用 useButton 和 useDrop 两个 hook 合在同一个原生按钮上，悬停和焦点环的 data 属性自己补上
  const { buttonProps } = useButton({ onPress: () => onNavigate(segment.id) }, ref);
  const { hoverProps, isHovered } = useHover({});
  const { focusProps, isFocusVisible } = useFocusRing();
  return (
    // eslint-disable-next-line ui/no-raw-interactive -- 按下、键盘由 React Aria 的 useButton 处理；Button 组件不转发拖放事件
    <button
      {...mergeProps(buttonProps, dropProps, hoverProps, focusProps)}
      ref={ref}
      className="ui-path-bar__segment"
      aria-current={isCurrent ? "location" : undefined}
      data-drop-target={isDropTarget || undefined}
      data-hovered={isHovered || undefined}
      data-focus-visible={isFocusVisible || undefined}
    >
      {segment.icon}
      <span className="ui-path-bar__label">{segment.label}</span>
    </button>
  );
}

function ChildrenMenu({ segment, getChildren, onNavigate }: {
  segment: PathSegment;
  getChildren: NonNullable<PathBarProps["getChildren"]>;
  onNavigate: (id: string) => void;
}) {
  const t = useStrings(pathBarStrings);
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; items: readonly PathSegment[] }>({ status: "idle", items: [] });
  const load = async () => {
    setState({ status: "loading", items: [] });
    try {
      const items = await getChildren(segment.id);
      setState({ status: "ready", items });
    } catch {
      setState({ status: "error", items: [] });
    }
  };
  const placeholder = state.status === "loading" ? t.loading : state.status === "error" ? t.failed : t.empty;
  return (
    <MenuTrigger onOpenChange={(open) => { if (open) void load(); }}>
      <Button variant="ghost" size="sm" icon={<ChevronDownIcon />} aria-label={t.children({ name: segment.label })} className="ui-path-bar__children" />
      <Menu onAction={(key) => onNavigate(String(key))} disabledKeys={["placeholder"]}>
        {state.items.length
          ? state.items.map((child) => <MenuItem key={child.id} id={child.id} icon={child.icon}>{child.label}</MenuItem>)
          : <MenuItem id="placeholder">{placeholder}</MenuItem>}
      </Menu>
    </MenuTrigger>
  );
}

function PathInput({ initial, label, onSubmit, onCancel }: { initial: string; label: string; onSubmit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const submitting = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  // 用户刚点了空白处或"编辑路径"，输入框替换了路径：把焦点放进去，整段选中，直接输入就替换
  useEffect(() => {
    const input = box.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, []);
  return (
    <div ref={box} className="ui-path-bar__input">
    <TextField
      aria-label={label}
      size="sm"
      value={value}
      onChange={setValue}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          submitting.current = true;
          Promise.resolve(onSubmit(value.trim())).finally(() => { submitting.current = false; });
        } else if (event.key === "Escape") {
          onCancel();
        } else {
          event.continuePropagation();
        }
      }}
      onBlur={() => { if (!submitting.current) onCancel(); }}
    />
    </div>
  );
}
