"use client";

import type { ReactNode, Ref, RefObject } from "react";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Key } from "react-aria-components";
import type {
  TabListProps as AriaTabListProps,
  TabPanelProps as AriaTabPanelProps,
  TabProps as AriaTabProps,
  TabsProps as AriaTabsProps,
} from "react-aria-components";
import {
  Button as AriaButton,
  Tab as AriaTab,
  TabList as AriaTabList,
  TabListStateContext,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
} from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { useStrings } from "../../lib/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "../../lib/icons";
import { useRevealSelected, useScrollEdges } from "../../lib/scroll-edges";
import { useSlidingIndicator } from "../../lib/sliding-indicator";
import { AnimatedNumber } from "../animated-number/animated-number";
import { ListBoxItem } from "../listbox/listbox";
import { Select } from "../select/select";
import { tabsStrings } from "./tabs.strings";
import "./tabs.css";

/**
 * 在同一区域内切换多块平级内容，每次仅展示其中一块。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface TabsProps extends Omit<AriaTabsProps, "children"> {
  /** 包含 `TabList` 与若干 `TabPanel` 子元素。 */
  children?: ReactNode;
  /**
   * 视觉样式；`underline` 为带下划线的标签栏，适合页面级主要分区，`pill` 为置于底槽上的浮起滑块，适合卡片或面板内的次级切换。
   * @default "underline"
   */
  variant?: "underline" | "pill";
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 标签页容器。基于 React Aria Tabs 实现，支持方向键在标签间移动并即时切换面板（设 `keyboardActivation="manual"` 时需按 `Enter` 确认切换），选中指示条从旧标签平滑滑向新标签。
 *
 * @promote selectedKey, defaultSelectedKey, onSelectionChange, orientation, keyboardActivation, disabledKeys
 */
export function Tabs({ variant = "underline", className, ...props }: TabsProps) {
  return <AriaTabs {...props} className={withUiClass("ui-tabs", className)} data-variant={variant} />;
}

export interface TabListProps<T extends object> extends Omit<AriaTabListProps<T>, "children"> {
  /** 若干 `Tab` 子元素，或配合 `items` 使用的渲染函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /**
   * 窄容器下自动收起为下拉选择器，不再横向滚动；设为 `true` 时在标签溢出时收起，设为数字时在容器宽度小于该像素值时收起。纵向标签栏不收起。
   */
  collapse?: boolean | number;
}

/**
 * 标签页列表容器，必须通过 `aria-label`（例如“项目设置”）或 `aria-labelledby` 提供可读的无障碍名称。
 */
export function TabList<T extends object>({ className, collapse, ...props }: TabListProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const collapsed = useCollapsedTabs(collapse, frameRef, scrollerRef);
  useSlidingIndicator(scrollerRef, indicatorRef, {
    itemSelector: '[role="tab"]',
    selectedSelector: '[role="tab"][aria-selected="true"]',
    selectedAttribute: "aria-selected",
  });
  // 放不下时：两端渐隐提示还有标签；选中的、聚焦的标签自动滚进来（留出渐隐的宽度）
  useScrollEdges(scrollerRef);
  useRevealSelected(scrollerRef, { item: '[role="tab"]', selected: '[role="tab"][aria-selected="true"]', attribute: "aria-selected", margin: FADE });

  // 左右箭头：放不下时出现在两侧，点一下滚大约一屏。不进 Tab 顺序（键盘用方向键，选中的标签会自己滚进来）
  const t = useStrings(tabsStrings);
  const scrollBy = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollBy({ left: direction * rtl * el.clientWidth * 0.8 });
  };

  return (
    <div ref={frameRef} className="ui-tab-list__frame" data-collapsed={collapsed || undefined}>
      {collapsed ? <CollapsedTabs label={props["aria-label"]} /> : null}
      <AriaButton excludeFromTabOrder aria-label={t.scrollStart} className="ui-tab-list__arrow" data-side="start" onPress={() => scrollBy(-1)}>
        <ChevronLeftIcon />
      </AriaButton>
      <div ref={scrollerRef} className={collapsed ? "ui-tab-list__measure" : "ui-tab-list__scroller"} inert={collapsed || undefined}>
        <span ref={indicatorRef} className="ui-tab-list__indicator" aria-hidden="true" hidden />
        <AriaTabList {...(props as AriaTabListProps<T>)} className={withUiClass("ui-tab-list", className)} />
      </div>
      <AriaButton excludeFromTabOrder aria-label={t.scrollEnd} className="ui-tab-list__arrow" data-side="end" onPress={() => scrollBy(1)}>
        <ChevronRightIcon />
      </AriaButton>
    </div>
  );
}

/** 渐隐区域的宽度（和 tabs.css 里的 --ui-tab-fade 一致） */
const FADE = 32;

export interface TabProps extends Omit<AriaTabProps, "children"> {
  /** 标签文字，通常保持二至四个字。 */
  children?: ReactNode;
  /** 置于标签文字前的装饰性图标。 */
  icon?: ReactNode;
  /** 标签末尾的数量角标（如未读数或待审核数）；超过 99 时显示为“99+”，传入 0 也会展示，读屏会随标签文字一并读取。 */
  count?: number;
}

/**
 * 单个标签项，其 `id` 需与对应 `TabPanel` 一致；传入 `href` 时渲染为链接，用于同步页面路由。
 */
export function Tab({ children, icon, count, className, ...props }: TabProps) {
  return (
    <AriaTab {...props} className={withUiClass("ui-tab", className)}>
      {icon ? (
        <span className="ui-tab__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ui-tab__label">{children}</span>
      {/* 数量变化时只有变了的位滚动；超过 99 显示"99+"，是文字，不滚 */}
      {count != null ? <span className="ui-tab__count">{count > 99 ? "99+" : <AnimatedNumber value={count} />}</span> : null}
    </AriaTab>
  );
}

export interface TabPanelProps extends Omit<AriaTabPanelProps, "children"> {
  /** 面板内容。 */
  children?: ReactNode;
}

/**
 * 标签对应的内容面板。没有可聚焦内容时面板本身可以聚焦，键盘用户 Tab 一下就能进入内容。
 */
export function TabPanel({ className, ...props }: TabPanelProps) {
  return <AriaTabPanel {...props} className={withUiClass("ui-tab-panel", className)} />;
}

/** 收起和展开之间留一点空隙，避免在临界宽度来回跳 */
const COLLAPSE_SLACK = 8;

function useCollapsedTabs(collapse: boolean | number | undefined, frameRef: RefObject<HTMLDivElement | null>, scrollerRef: RefObject<HTMLDivElement | null>) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (collapse == null || collapse === false) return;
    const frame = frameRef.current;
    const scroller = scrollerRef.current;
    if (!frame || !scroller) return;
    const update = () => {
      const width = frame.clientWidth;
      setCollapsed((current) => {
        if (typeof collapse === "number") return width > 0 && width < collapse;
        if (scroller.scrollWidth > width + COLLAPSE_SLACK) return true;
        if (scroller.scrollWidth <= Math.max(0, width - COLLAPSE_SLACK)) return false;
        return current;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [collapse, frameRef, scrollerRef]);
  return collapse != null && collapse !== false && collapsed;
}

/** 收起后的下拉。选中仍走标签页的状态，面板不变 */
function CollapsedTabs({ label }: { label: AriaTabListProps<object>["aria-label"] }) {
  const state = useContext(TabListStateContext);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  // 标签文字在 Tab 里（可能带图标、数量），下拉选项用同样的文字，不用 id
  useLayoutEffect(() => {
    const next = new Map<string, string>();
    for (const el of document.querySelectorAll<HTMLElement>(".ui-tab-list__frame [role=tab]")) {
      const key = el.dataset.key;
      if (key) next.set(key, el.textContent?.trim() || key);
    }
    setLabels(next);
  }, [state]);
  if (!state) return null;
  const items = [...state.collection];
  return (
    <Select
      aria-label={typeof label === "string" ? label : undefined}
      className="ui-tab-list__menu"
      selectedKey={state.selectedKey}
      disabledKeys={state.disabledKeys}
      onSelectionChange={(key) => {
        if (key != null) state.setSelectedKey(key);
      }}
    >
      {items.map((item) => (
        <ListBoxItem key={item.key} id={item.key as Key}>
          {labels.get(String(item.key)) || item.textValue || String(item.key)}
        </ListBoxItem>
      ))}
    </Select>
  );
}
