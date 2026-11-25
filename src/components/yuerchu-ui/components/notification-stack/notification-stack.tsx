"use client";

import { AnimatePresence, motion, useIsPresent } from "motion/react";
import {
  Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactElement, type ReactNode, type Ref,
} from "react";
import { mergeRefs, useFocusRing, useLandmark, useLocale } from "react-aria";
import { createPortal } from "react-dom";
import { announce } from "../../lib/announce";
import { useStrings } from "../../lib/i18n";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "../../lib/icons";
import { useMotionTokens, type MotionTokens } from "../../lib/motion";
import { Button } from "../button/button";
import { Card } from "../card/card";
import { Tooltip, TooltipTrigger } from "../tooltip/tooltip";
import { useNotificationDock } from "./notification-dock";
import { NotificationFocus } from "./notification-focus";
import { notificationStackStrings } from "./notification-stack.strings";
import "./notification-stack.css";

/**
 * 待处理事项以卡片形式显示，用户可以逐条操作，也可以稍后再处理。
 *
 * @packageDocumentation
 * @category 反馈
 * @status 实验中
 */

export interface NotificationStackProps {
  /** 按显示顺序排列的 NotificationCard 或返回卡片的组件。每个直接子项都需要稳定、唯一的 key。 */
  children?: ReactNode;
  /**
   * 通知区域的位置。top 位于顶部中央，bottom-end 位于底部末端，在从左到右的布局中是右下角。
   * @default "top"
   */
  placement?: "top" | "bottom-end";
  /**
   * 多条通知时是否默认折叠成堆叠卡片，只完整展示队首并露出后续卡片边缘；点击按钮可展开全部或重新叠起。
   * @default false
   */
  collapsible?: boolean;
  /** 通知区域的无障碍名称，中文默认为“待处理通知”。 */
  "aria-label"?: string;
  /** 通知滚动区域的类名。 */
  className?: string;
  /** 通知区域的元素引用。最后一条通知退场后为 null。 */
  ref?: Ref<HTMLDivElement>;
}

const MAX_PEEKS = 2;
const PEEK_STEP = 8;
const STACK_SCALE_STEP = 0.04;

interface Item { key: string; child: ReactElement }

function itemsOf(children: ReactNode): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  Children.forEach(children, (child) => {
    if (child == null) return;
    if (!isValidElement(child) || child.key == null) throw new Error("NotificationStack items need a stable React key");
    const key = String(child.key);
    if (seen.has(key)) throw new Error(`Duplicate NotificationStack key: ${key}`);
    seen.add(key);
    items.push({ key, child });
  });
  return items;
}

/** 按 F6 可进入通知区域。新增通知或调整顺序时，焦点会留在当前控件上。 */
export function NotificationStack({ children, placement = "top", collapsible = false, ...props }: NotificationStackProps) {
  const t = useStrings(notificationStackStrings);
  const items = itemsOf(children);
  const keys = items.map((item) => item.key);
  const previous = useRef(new Set(keys));
  const [retained, setRetained] = useState(false);
  const count = items.length;
  useLayoutEffect(() => { if (count && !retained) setRetained(true); }, [count, retained]);
  useEffect(() => {
    const added = keys.filter((key) => !previous.current.has(key)).length;
    previous.current = new Set(keys);
    if (added) announce(t.added({ count: added }));
  }, [keys, t]);
  if (!count && !retained) return null;
  return (
    <StackPortal {...props} placement={placement} collapsible={collapsible} items={items} onEmpty={() => setRetained(false)} />
  );
}

interface RegionProps extends Omit<NotificationStackProps, "children" | "placement" | "collapsible"> {
  items: Item[];
  placement: "top" | "bottom-end";
  collapsible: boolean;
  onEmpty: () => void;
}

function StackPortal(props: RegionProps) {
  const dock = useNotificationDock(props.placement);
  return dock ? createPortal(<StackRegion {...props} dock={dock} />, dock) : null;
}

// 模态不应把待处理操作当作 Toast 一样放行，屏蔽期间也不要把它列作 F6 的目的地。
function useDockHidden(dock: HTMLElement) {
  const hidden = () => !!dock.closest('[inert], [hidden], [aria-hidden="true"]');
  const [value, setValue] = useState(hidden);
  useLayoutEffect(() => {
    const sync = () => setValue(!!dock.closest('[inert], [hidden], [aria-hidden="true"]'));
    sync();
    const observer = new MutationObserver(sync);
    for (let el: HTMLElement | null = dock; el; el = el.parentElement) {
      observer.observe(el, { attributes: true, attributeFilter: ["inert", "hidden", "aria-hidden"] });
    }
    return () => observer.disconnect();
  }, [dock]);
  return value;
}

function StackRegion({ items, placement, collapsible, className, "aria-label": label, ref, onEmpty, dock }:
  RegionProps & { dock: HTMLElement }) {
  const t = useStrings(notificationStackStrings);
  const { direction } = useLocale();
  const motionTokens = useMotionTokens();
  const viewName = `ui-pending-${useId().replace(/[^\w-]/g, "")}`;
  const region = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const absent = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const hidden = useDockHidden(dock);
  const active = items.length > 0 && !hidden;
  const [expanded, setExpanded] = useState(false);
  const canCollapse = collapsible && items.length > 1;
  const collapsed = canCollapse && !expanded;
  const [frontHeight, setFrontHeight] = useState<number | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const { landmarkProps } = useLandmark({ role: "region", "aria-label": label ?? t.region }, active ? region : absent);
  const { isFocusVisible, focusProps } = useFocusRing();
  const frontKey = items[0]?.key ?? null;

  useEffect(() => {
    if (items.length <= 1 && expanded) setExpanded(false);
  }, [items.length, expanded]);

  useLayoutEffect(() => {
    if (!items.length && !region.current?.querySelector("[data-notification-key]")) onEmpty();
  }, [items, onEmpty]);

  // 折叠态测量队首卡片高度，让背后露出的卡片边缘无论自身高低都严格对齐。
  useLayoutEffect(() => {
    if (!collapsed || !listRef.current || !frontKey) {
      setFrontHeight(null);
      return;
    }
    const front = [...listRef.current.querySelectorAll<HTMLElement>("[data-notification-key]")].find(
      (el) => el.dataset.notificationKey === frontKey && !el.hasAttribute("data-exiting"),
    );
    if (!front) return;
    const sync = () => setFrontHeight(front.offsetHeight || null);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(front);
    return () => observer.disconnect();
  }, [collapsed, frontKey]);

  // 仅当非退场子项的自然高度超出 dock 可用高度时才启用内部滚动，
  // 避免卡片阴影被裁切，也避免退场或补位动画期间因临时 transform 溢出闪出滚动条。
  useLayoutEffect(() => {
    const list = listRef.current;
    if (collapsed || !list || !items.length) {
      setScrollable(false);
      return;
    }
    const sync = () => {
      const available = dock.clientHeight;
      if (available <= 0) {
        setScrollable(false);
        return;
      }
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const rows = [...list.querySelectorAll<HTMLElement>("[data-notification-key]:not([data-exiting])")];
      let content = rows.reduce((sum, el, i) => sum + el.offsetHeight + (i > 0 ? gap : 0), 0);
      if (barRef.current) content += barRef.current.offsetHeight + gap;
      setScrollable(content > available + 1);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    observer.observe(list);
    for (const el of list.querySelectorAll<HTMLElement>("[data-notification-key]:not([data-exiting])")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [collapsed, dock, items]);

  const peeks = collapsed ? Math.min(items.length - 1, MAX_PEEKS) : 0;
  const listStyle = {
    ...(frontHeight ? { "--ui-notification-front-height": `${frontHeight}px` } : {}),
    ...(peeks ? { "--ui-notification-peeks": String(peeks) } : {}),
  } as CSSProperties;
  const ToggleIcon = placement === "top" ? (collapsed ? ChevronDownIcon : ChevronUpIcon) : (collapsed ? ChevronUpIcon : ChevronDownIcon);

  return (
    <NotificationFocus keys={items.map((item) => item.key)} origin={origin} region={region}>
      <motion.div {...(active ? { role: landmarkProps.role, "aria-label": landmarkProps["aria-label"] } : {})}
        onFocus={focusProps.onFocus} onBlur={focusProps.onBlur} ref={mergeRefs(region, ref ?? null)}
        className={className ? `ui-notification-stack ${className}` : "ui-notification-stack"}
        data-placement={placement} data-collapsible={collapsible || null} data-collapsed={collapsed || null}
        data-scrollable={scrollable || null} data-focus-visible={isFocusVisible || null} tabIndex={-1} dir={direction}
        style={{ viewTransitionName: viewName }} layoutScroll layoutRoot aria-hidden={!active} inert={!active}
        onFocusCapture={(e) => {
          const from = e.relatedTarget;
          if (!(from instanceof HTMLElement) || from === e.currentTarget.ownerDocument.body) return;
          if (!e.currentTarget.contains(from)) origin.current = from;
        }}
        onBlurCapture={(e) => {
          if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) origin.current = null;
        }}>
        <div ref={listRef} className="ui-notification-stack__list" style={listStyle}>
          <AnimatePresence initial={false} mode="popLayout" onExitComplete={() => { if (!items.length) onEmpty(); }}>
            {items.map(({ key, child }, index) => (
              <StackItem key={key} itemKey={key} index={index} total={items.length} collapsed={collapsed}
                placement={placement} tokens={motionTokens}>{child}</StackItem>
            ))}
          </AnimatePresence>
        </div>
        {canCollapse ? (
          <div ref={barRef} className="ui-notification-stack__bar">
            <Button variant="secondary" size="sm" icon={<ToggleIcon />} className="ui-notification-stack__toggle"
              aria-expanded={!collapsed} onPress={() => setExpanded((prev) => !prev)}>
              {collapsed ? t.expand({ count: items.length - 1 }) : t.collapse}
            </Button>
          </div>
        ) : null}
      </motion.div>
    </NotificationFocus>
  );
}

function StackItem({ itemKey, index, total, collapsed, placement, tokens: m, children, ref }: {
  itemKey: string;
  index: number;
  total: number;
  collapsed: boolean;
  placement: RegionProps["placement"];
  tokens: MotionTokens;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  const present = useIsPresent();
  const stacked = collapsed && index > 0;
  const shift = placement === "top" ? -m.enterDistance : m.enterDistance;
  const dir = placement === "top" ? 1 : -1;
  const depth = Math.min(index, MAX_PEEKS);
  const stackY = dir * depth * PEEK_STEP;
  const stackScale = 1 - depth * STACK_SCALE_STEP;
  const stackOpacity = index === 1 ? 0.92 : index === 2 ? 0.72 : 0;
  const zIndex = stacked ? Math.max(0, MAX_PEEKS + 1 - index) : collapsed ? MAX_PEEKS + 1 : total - index;
  const inactive = !present || stacked;
  return (
    <motion.div ref={ref} layout="position" className="ui-notification-stack__item" data-notification-key={itemKey}
      data-exiting={present ? null : ""} data-stacked={stacked ? "" : null} inert={inactive} aria-hidden={inactive}
      style={{ zIndex }}
      initial={stacked ? { opacity: 0, y: stackY, scale: stackScale } : { opacity: 0, y: shift, scale: 1 }}
      animate={stacked ? { opacity: stackOpacity, y: stackY, scale: stackScale } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: stacked ? stackY : shift, scale: stacked ? stackScale : 1, transition: { duration: m.duration.fast, ease: m.ease.exit } }}
      transition={{ layout: m.spring, y: m.spring, scale: m.spring, duration: m.duration.standard, ease: m.ease.enter }}>
      {children}
    </motion.div>
  );
}

export interface NotificationCardProps {
  /** 通知标题，也是卡片的无障碍名称。可以包含行内元素。 */
  heading: ReactNode;
  /** 通知正文，可以包含段落、列表或代码。 */
  description?: ReactNode;
  /** 卡片底部的操作按钮或链接，例如“批准”和“查看详情”。 */
  actions?: ReactNode;
  /** 传入时显示收起按钮，用户按下该按钮时调用。 */
  onDismiss?: () => void;
  /** 收起按钮的无障碍名称和提示文字，中文默认为“收起通知”。 */
  dismissLabel?: string;
  /** 通知标题的层级，默认为三级标题。 */
  headingLevel?: 1 | 2 | 3 | 4;
  /** 卡片上的类名。 */
  className?: string;
  /** 指向卡片元素。 */
  ref?: Ref<HTMLElement>;
}

/** 展示一条待处理通知的详情和可用操作。卡片不会自动关闭。 */
export function NotificationCard({ heading, description, actions, onDismiss, dismissLabel, headingLevel = 3,
  className, ref }: NotificationCardProps) {
  const t = useStrings(notificationStackStrings);
  const close = dismissLabel ?? t.dismiss;
  return (
    <Card ref={ref} tabIndex={-1} className={className ? `ui-notification-card ${className}` : "ui-notification-card"}
      heading={heading} headingLevel={headingLevel} footer={actions} actions={onDismiss ? (
        <TooltipTrigger>
          <Button variant="ghost" size="sm" icon={<XIcon />} aria-label={close} onPress={onDismiss} />
          <Tooltip>{close}</Tooltip>
        </TooltipTrigger>
      ) : null}>
      {description == null ? null : <div className="ui-notification-card__description">{description}</div>}
    </Card>
  );
}
