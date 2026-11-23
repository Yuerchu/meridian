"use client";

/*
 * 框选：在列表 / 表格里用鼠标拖出一个矩形，选中框住的项（GridList、Table 共用）。
 *
 * - 只响应鼠标左键。触屏拖动要留给滚动；键盘用 Shift + 方向键、Ctrl + A（React Aria 自带）。
 * - 从空白处按下：拖出矩形；只点一下（没拖动）清空选择。
 * - 从行里不可交互的地方按下也可以拖（文件管理器的列表视图就是这样）；按钮、勾选框、链接、输入框和可拖动排序的行不会开始框选。
 * - 按住 Ctrl / ⌘ / Shift 开始：在原来的选择上追加；不按：只保留框住的项。
 * - 拖到滚动区域边缘时自动滚动；拖动中用滚轮滚动也会更新。
 * - Esc、窗口失焦、指针被取消：放弃这次框选，选择回到开始前。
 *
 * 虚拟滚动时屏幕外的行不在 DOM 里：
 * - 每次更新时把已经渲染的行的位置记下来（内容坐标，滚走了也还有效）；
 * - rows 模式（每项占一整行：stack 列表、表格）里，命中的第一行和最后一行之间的项按顺序全部选中，没渲染过的也算。
 *
 * 取消手势的时机：会话在实际按下时就建立并记下“开始前的选择”，之后的失焦一定能取消它（不依赖第一次移动才开始的回调）。
 */

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { Key, Selection } from "react-aria-components";
import "./marquee-selection.css";

/** React Aria 取 key 的方式：item.id，没有时 item.key */
export const keyOfItem = (item: object): Key | undefined => (item as { id?: Key }).id ?? (item as { key?: Key }).key;

type SelectionProps = {
  selectedKeys?: "all" | Iterable<Key>;
  defaultSelectedKeys?: "all" | Iterable<Key>;
  onSelectionChange?: (keys: Selection) => void;
};

function normalize(keys: "all" | Iterable<Key> | undefined): Selection | undefined {
  if (keys === undefined) return undefined;
  return keys === "all" ? "all" : new Set(keys);
}

/**
 * 框选要直接写选择：开启时组件内部受控（使用方受控时用使用方的值），每次变化照常通知 onSelectionChange。
 * 没开启时 props 为空对象，React Aria 照旧自己管理。
 */
export function useOwnedSelection(props: SelectionProps, enabled: boolean) {
  const [own, setOwn] = useState<Selection>(() => normalize(props.defaultSelectedKeys) ?? new Set());
  const selection = normalize(props.selectedKeys) ?? own;
  const latest = useRef(selection);
  latest.current = selection;
  const controlled = props.selectedKeys !== undefined;
  const onChange = useRef(props.onSelectionChange);
  onChange.current = props.onSelectionChange;
  const set = (keys: Selection) => {
    if (!controlled) setOwn(keys);
    latest.current = keys;
    onChange.current?.(keys);
  };
  return {
    get: () => latest.current,
    set,
    props: enabled ? { selectedKeys: selection, defaultSelectedKeys: undefined, onSelectionChange: set } : {},
  };
}

export interface MarqueeSelectionOptions {
  /** 列表元素（GridList 的列表、Table 的滚动容器）。框画在它里面，跟着内容滚动。 */
  ref: RefObject<HTMLElement | null>;
  /** 是否开启。 */
  enabled: boolean;
  /** 列表元素会被换掉时（例如表格切换列宽调整）传当前元素：变了就重新挂监听。 */
  element?: HTMLElement | null;
  /** 可选项的选择器，元素上要有 data-key。 */
  itemSelector: string;
  /** rows：每项占一整行，首尾之间的项全选（包括虚拟滚动时没渲染的）；rects：只选框住的项（卡片网格）。 */
  mode: "rows" | "rects";
  /** 所有项的 key，按显示顺序。虚拟滚动时必须提供；返回 null 时用 DOM 里的顺序。 */
  getKeys: () => readonly Key[] | null;
  /** 不能选的项。 */
  isDisabled: (key: Key) => boolean;
  /** 当前选择。 */
  getSelection: () => Selection;
  /** 写回选择。 */
  setSelection: (keys: Set<Key>) => void;
}

type Box = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };

const THRESHOLD = 4;
const EDGE = 40;
const MAX_SPEED = 18;
const INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [role=button], [role=checkbox], [role=switch], [role=link], [role=menuitem], [role=slider], [role=columnheader], [contenteditable]:not([contenteditable=false]), [draggable=true], .ui-table__resizer";

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const page = () => (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
const isPage = (element: HTMLElement) => element === page() || element === document.documentElement || element === document.body;

function scrollable(node: HTMLElement, axis: "x" | "y") {
  const style = getComputedStyle(node);
  return axis === "y"
    ? /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight
    : /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
}

/** 某个方向上最近的能滚动的元素（包括自己）；都不能滚时是页面。横向和纵向可能不是同一个（表格横向滚、页面纵向滚） */
function scrollParent(element: HTMLElement, axis: "x" | "y"): HTMLElement {
  for (let node: HTMLElement | null = element; node && !isPage(node); node = node.parentElement) {
    if (scrollable(node, axis)) return node;
  }
  return page();
}

/**
 * 框画在哪个元素里、坐标相对谁：一般是列表自己；虚拟滚动的表格是里面那个自己滚动的 grid（行的位置相对它）
 */
function frameOf(list: HTMLElement) {
  const inner = list.querySelector<HTMLElement>("[role=grid], [role=treegrid]");
  return inner && inner !== list && (scrollable(inner, "y") || scrollable(inner, "x")) ? inner : list;
}

/** 离边缘越近滚得越快；在边缘外（拖出了区域）按最快速度 */
function edgeSpeed(value: number, min: number, max: number) {
  if (value < min + EDGE) return -Math.ceil(Math.min(1, (min + EDGE - value) / EDGE) * MAX_SPEED);
  if (value > max - EDGE) return Math.ceil(Math.min(1, (value - (max - EDGE)) / EDGE) * MAX_SPEED);
  return 0;
}

export function useMarqueeSelection(options: MarqueeSelectionOptions) {
  const latest = useRef(options);
  latest.current = options;
  const { ref, enabled, element } = options;

  useEffect(() => {
    const list = ref.current;
    if (!enabled || !list) return;

    let session: {
      pointerId: number;
      anchor: Point;
      start: Point;
      client: Point;
      additive: boolean;
      blank: boolean;
      moved: boolean;
      original: Set<Key>;
      base: Set<Key>;
      cache: Map<string, { box: Box; disabled: boolean }>;
      last: string;
      overlay: HTMLDivElement | null;
      box: HTMLElement;
      /** 按下时内容的尺寸（还没有框） */
      content: Point;
      scrollX: HTMLElement;
      scrollY: HTMLElement;
      frame: number;
    } | null = null;

    /** 视口坐标 → 框所在元素的内容坐标（它自己滚动时加上滚动距离；外层滚动时它的位置已经变了） */
    const local = (x: number, y: number, box = session?.box ?? frameOf(list)): Point => {
      const rect = box.getBoundingClientRect();
      return { x: x - rect.left - box.clientLeft + box.scrollLeft, y: y - rect.top - box.clientTop + box.scrollTop };
    };
    const items = () => [...list.querySelectorAll<HTMLElement>(latest.current.itemSelector)].filter((el) => el.dataset.key != null);
    const order = () => latest.current.getKeys() ?? items().map((el) => el.dataset.key!);

    const write = (keys: Set<Key>) => {
      const signature = [...keys].map(String).sort().join("\n");
      if (!session || signature === session.last) return;
      session.last = signature;
      latest.current.setSelection(keys);
    };

    const refresh = () => {
      const s = session;
      if (!s?.moved) return;
      // 框不超出内容：框本身绝对定位在滚动区域里，超出会把可滚动范围撑大，自动滚动就停不下来
      const raw = local(s.client.x, s.client.y);
      const point = { x: Math.min(Math.max(raw.x, 0), s.content.x), y: Math.min(Math.max(raw.y, 0), s.content.y) };
      const box: Box = {
        left: Math.min(s.anchor.x, point.x),
        top: Math.min(s.anchor.y, point.y),
        right: Math.max(s.anchor.x, point.x),
        bottom: Math.max(s.anchor.y, point.y),
      };
      if (s.overlay) {
        Object.assign(s.overlay.style, {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.right - box.left}px`,
          height: `${box.bottom - box.top}px`,
        });
      }
      for (const el of items()) {
        const rect = el.getBoundingClientRect();
        const topLeft = local(rect.left, rect.top);
        s.cache.set(el.dataset.key!, {
          box: { left: topLeft.x, top: topLeft.y, right: topLeft.x + rect.width, bottom: topLeft.y + rect.height },
          disabled: el.hasAttribute("data-disabled") || el.getAttribute("aria-disabled") === "true",
        });
      }
      const keys = order();
      const byName = new Map(keys.map((key) => [String(key), key]));
      const allowed = (name: string) => {
        const key = byName.get(name);
        return key !== undefined && !s.cache.get(name)?.disabled && !latest.current.isDisabled(key);
      };
      // rows 模式只看纵向：整行都算这一项，从行右边的空白处竖着拖也能选中
      const rows = latest.current.mode === "rows";
      const hit = (item: Box) => (rows ? box.top < item.bottom && box.bottom > item.top : overlaps(box, item));
      const hits = [...s.cache].filter(([name, item]) => hit(item.box) && byName.has(name)).map(([name]) => name);
      const selected = new Set(s.base);
      if (latest.current.mode === "rows" && hits.length) {
        const indexes = hits.map((name) => keys.findIndex((key) => String(key) === name));
        const from = Math.min(...indexes);
        const to = Math.max(...indexes);
        for (let i = from; i <= to; i++) if (allowed(String(keys[i]))) selected.add(keys[i]!);
      } else {
        for (const name of hits) if (allowed(name)) selected.add(byName.get(name)!);
      }
      write(selected);
    };

    const tick = () => {
      const s = session;
      if (!s) return;
      const bounds = (element: HTMLElement) =>
        isPage(element) ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight } : element.getBoundingClientRect();
      const x = bounds(s.scrollX);
      const y = bounds(s.scrollY);
      const dx = edgeSpeed(s.client.x, x.left, x.right);
      const dy = edgeSpeed(s.client.y, y.top, y.bottom);
      if (dx) s.scrollX.scrollBy?.(dx, 0);
      if (dy) s.scrollY.scrollBy?.(0, dy);
      if (dx || dy) refresh();
      s.frame = requestAnimationFrame(tick);
    };

    const finish = () => {
      const s = session;
      session = null;
      if (!s) return;
      cancelAnimationFrame(s.frame);
      s.overlay?.remove();
      list.removeAttribute("data-marquee-active");
      s.box.removeAttribute("data-marquee-frame");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("scroll", refresh, true);
    };

    const onCancel = () => {
      const s = session;
      if (s?.moved) {
        s.last = "";
        latest.current.setSelection(new Set(s.original));
      }
      finish();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !session?.moved) return;
      // 只取消框选，不让 Esc 再关掉外面的对话框
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };

    const onMove = (event: PointerEvent) => {
      const s = session;
      if (!s || event.pointerId !== s.pointerId) return;
      s.client = { x: event.clientX, y: event.clientY };
      if (!s.moved) {
        if (Math.hypot(event.clientX - s.start.x, event.clientY - s.start.y) < THRESHOLD) return;
        s.moved = true;
        const overlay = document.createElement("div");
        overlay.className = "ui-marquee";
        overlay.setAttribute("aria-hidden", "true");
        s.box.setAttribute("data-marquee-frame", "");
        s.box.append(overlay);
        s.overlay = overlay;
        list.setAttribute("data-marquee-active", "");
        s.frame = requestAnimationFrame(tick);
      }
      refresh();
    };

    const onUp = (event: PointerEvent) => {
      const s = session;
      if (!s || event.pointerId !== s.pointerId) return;
      // 在空白处点一下（没拖动、没按修饰键）：清空选择
      if (!s.moved && s.blank && !s.additive && s.original.size) latest.current.setSelection(new Set());
      finish();
      if (!s.moved) return;
      // 拖出过框：这次松手不能再被 React Aria 当成对某一行的点击（会把起点那一行再切换一次）。
      // 在 window 捕获阶段拦下松手和随后的 click，再补一个 pointercancel 让行的按下状态收尾（取消不改变选择）
      event.stopPropagation();
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      event.target?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: event.pointerId, pointerType: "mouse", bubbles: true }));
    };

    const onDown = (event: PointerEvent) => {
      if (session || event.pointerType !== "mouse" || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element) || !list.contains(target) || target.closest(INTERACTIVE)) return;
      const item = target.closest<HTMLElement>(latest.current.itemSelector);
      // 表头行、空状态这类不是可选项的行，不开始
      const row = target.closest("[role=row]");
      if (row && !item) return;
      // 点在滚动条上
      const box = frameOf(list);
      for (const element of new Set([list, box])) {
        const rect = element.getBoundingClientRect();
        if (event.clientX - rect.left - element.clientLeft >= element.clientWidth || event.clientY - rect.top - element.clientTop >= element.clientHeight) return;
      }
      const current = latest.current.getSelection();
      const original = new Set<Key>(current === "all" ? order().filter((key) => !latest.current.isDisabled(key)) : current);
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      // 空白处不让浏览器开始选中文字；行里的按下交给 React Aria（它自己处理选中和焦点）
      if (!item) event.preventDefault();
      session = {
        pointerId: event.pointerId,
        anchor: local(event.clientX, event.clientY, box),
        start: { x: event.clientX, y: event.clientY },
        client: { x: event.clientX, y: event.clientY },
        additive,
        blank: !item,
        moved: false,
        original,
        base: additive ? new Set(original) : new Set(),
        cache: new Map(),
        last: [...original].map(String).sort().join("\n"),
        overlay: null,
        box,
        content: { x: Math.max(box.scrollWidth, box.clientWidth), y: Math.max(box.scrollHeight, box.clientHeight) },
        scrollX: scrollParent(box, "x"),
        scrollY: scrollParent(box, "y"),
        frame: 0,
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onCancel);
      window.addEventListener("scroll", refresh, true);
    };

    list.addEventListener("pointerdown", onDown);
    list.setAttribute("data-marquee", "");
    return () => {
      finish();
      list.removeEventListener("pointerdown", onDown);
      list.removeAttribute("data-marquee");
    };
  }, [ref, enabled, element]);
}
