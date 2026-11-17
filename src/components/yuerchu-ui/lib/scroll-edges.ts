"use client";

import type { RefObject } from "react";
import { useLayoutEffect } from "react";

/**
 * 横向滚动容器的"还有内容"提示：内容超出时，在元素上写 data-overflow-start / data-overflow-end
 * （开头 / 结尾那边还有没露出来的内容），CSS 据此给边缘加渐隐。直接改属性，不触发重新渲染。
 * 方向按书写方向算：RTL 时 start 在右边。
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // RTL 时 scrollLeft 是 0 到负数：取绝对值就是离开头的距离
      const fromStart = Math.abs(el.scrollLeft);
      const max = el.scrollWidth - el.clientWidth;
      // 留 1px 余量：缩放时 scrollLeft 可能是小数
      el.toggleAttribute("data-overflow-start", fromStart > 1);
      el.toggleAttribute("data-overflow-end", max - fromStart > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const size = new ResizeObserver(update);
    size.observe(el);
    for (const child of el.children) size.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      size.disconnect();
    };
  }, [ref]);
}

/**
 * 把滚动容器里 selector 匹配的元素滚进可见范围（只动这个容器，不像 scrollIntoView 那样连页面一起滚）。
 * 元素已经完整可见时不动。
 */
export function scrollIntoContainer(container: HTMLElement, item: HTMLElement, margin = 0) {
  const c = container.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  if (r.left < c.left + margin) container.scrollLeft -= c.left + margin - r.left;
  else if (r.right > c.right - margin) container.scrollLeft += r.right - (c.right - margin);
}

/**
 * 横向滚动的选项条（Tabs、SegmentedControl）：放不下时，把选中的、聚焦的选项滚进可见范围，两边留出 margin（渐隐的宽度）。
 * 选中变化包括点击、方向键和受控的值；焦点和选中分开时（手动激活）跟着焦点。
 */
export function useRevealSelected(
  ref: RefObject<HTMLElement | null>,
  { item, selected, attribute, margin = 0 }: { item: string; selected: string; attribute: string; margin?: number },
) {
  useLayoutEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const reveal = (el: Element | null) => {
      if (el instanceof HTMLElement && scroller.scrollWidth > scroller.clientWidth) scrollIntoContainer(scroller, el, margin);
    };
    reveal(scroller.querySelector(selected));
    const selection = new MutationObserver((records) => {
      for (const r of records) if (r.target instanceof Element && r.target.matches(selected)) reveal(r.target);
    });
    selection.observe(scroller, { subtree: true, attributes: true, attributeFilter: [attribute] });
    const onFocus = (e: FocusEvent) => reveal((e.target as Element).closest(item));
    scroller.addEventListener("focusin", onFocus);
    return () => {
      selection.disconnect();
      scroller.removeEventListener("focusin", onFocus);
    };
  }, [ref, item, selected, attribute, margin]);
}
