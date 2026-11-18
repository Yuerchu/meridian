/*
 * 选中指示条（Tabs、SegmentedControl 共用）：容器里唯一一个指示条元素，位置取自选中项的
 * offsetLeft / offsetTop / offsetWidth / offsetHeight，写进 --ui-indicator-x/y/w/h，再由 CSS 过渡滑过去。
 *
 * 没有用 React Aria 的 SelectionIndicator：它在 StrictMode + SSR 下会停在错误位置
 * （adobe/react-spectrum#10570），页面滚动后切换会从斜下方飞进来（#9931）。
 */
import type { RefObject } from "react";
import { useLayoutEffect } from "react";

/**
 * @param containerRef 指示条的定位参照（选中项的 offsetParent），也是观察变化的范围
 * @param indicatorRef 指示条元素
 * @param itemSelector 所有选项
 * @param selectedSelector 选中的那一项
 * @param selectedAttribute 选中状态写在哪个属性上，变化时重新定位
 */
export function useSlidingIndicator(
  containerRef: RefObject<HTMLElement | null>,
  indicatorRef: RefObject<HTMLElement | null>,
  { itemSelector, selectedSelector, selectedAttribute }: { itemSelector: string; selectedSelector: string; selectedAttribute: string },
) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const size = new ResizeObserver(() => update());
    const update = () => {
      // 选项可能是动态增加的：每次都把所有选项交给 ResizeObserver（重复 observe 同一个元素没有副作用）
      for (const item of container.querySelectorAll<HTMLElement>(itemSelector)) size.observe(item);
      const selected = container.querySelector<HTMLElement>(selectedSelector);
      indicator.hidden = !selected;
      if (!selected) return;
      indicator.style.setProperty("--ui-indicator-x", `${selected.offsetLeft}px`);
      indicator.style.setProperty("--ui-indicator-y", `${selected.offsetTop}px`);
      indicator.style.setProperty("--ui-indicator-w", `${selected.offsetWidth}px`);
      indicator.style.setProperty("--ui-indicator-h", `${selected.offsetHeight}px`);
    };
    size.observe(container);
    update();
    // 第一次定位不要过渡，否则页面加载时指示条会从左边滑进来
    const frame = requestAnimationFrame(() => container.setAttribute("data-indicator-ready", ""));

    const selection = new MutationObserver(update);
    selection.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: [selectedAttribute] });

    return () => {
      cancelAnimationFrame(frame);
      selection.disconnect();
      size.disconnect();
    };
  }, [containerRef, indicatorRef, itemSelector, selectedSelector, selectedAttribute]);
}
