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
 * 标签页：在同一位置切换几块平级的内容，一次只看一块。
 * 切换的是数据的不同视图（列表 / 看板）、且不需要面板时用 SegmentedControl；切换页面用导航链接。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface TabsProps extends Omit<AriaTabsProps, "children"> {
  /** TabList 和若干 TabPanel。 */
  children?: ReactNode;
  /**
   * 外观。underline 是带下划线的标签，用于页面里的主要分区；pill 是灰底上的白色块，用于卡片、面板里的次级切换。
   * @default "underline"
   */
  variant?: "underline" | "pill";
  /** 指向根元素。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 标签页容器。基于 React Aria Tabs：方向键在标签之间移动并立即切换（keyboardActivation="manual" 时按 Enter 才切换）。
 * 选中指示条从旧标签滑到新标签；颜色走 --control-on，区域上写 data-control="accent" 变蓝。
 *
 * @promote selectedKey, defaultSelectedKey, onSelectionChange, orientation, keyboardActivation, disabledKeys
 */
export function Tabs({ variant = "underline", className, ...props }: TabsProps) {
  return <AriaTabs {...props} className={withUiClass("ui-tabs", className)} data-variant={variant} />;
}

export interface TabListProps<T extends object> extends Omit<AriaTabListProps<T>, "children"> {
  /** 若干 Tab；或者配合 items 写成函数。 */
  children?: ReactNode | ((item: T) => ReactNode);
  /**
   * 窄的时候收成下拉，不再横向滚动。不写时一直是标签栏。
   * true：标签放不下就收起。数字：容器比这个像素窄时收起（按标签栏自己的宽度，不是视口）。
   * 收起后是一个下拉选择，选中仍切换同一个面板。纵向标签栏不收起。
   */
  collapse?: boolean | number;
}

/**
 * 标签列表。必须有可读的名称：写 aria-label，例如"项目设置"。
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
  /** 标签文字，两到四个字为宜。 */
  children?: ReactNode;
  /** 文字前的图标，只做装饰。 */
  icon?: ReactNode;
  /** 文字后面的数量角标，例如未读数、待处理数。超过 99 显示"99+"；0 也会显示，不想显示时不传。读屏会和标签文字一起读出。 */
  count?: number;
}

/**
 * 一个标签。id 和对应 TabPanel 的 id 相同。写了 href 时是链接（配合 Next.js 路由做 URL 同步的标签页）。
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
