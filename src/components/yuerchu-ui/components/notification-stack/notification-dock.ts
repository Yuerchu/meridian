import { useLayoutEffect, useState } from "react";
import { useLocale, useUNSAFE_PortalContext } from "react-aria";

type Placement = "top" | "bottom-end";
interface Dock {
  node: HTMLDivElement;
  users: number;
  dispose: () => void;
}

// 只共享同一 portal 容器、同一边的布局节点，不保存通知内容、动作或顺序。
const docks = new WeakMap<HTMLElement, Map<string, Dock>>();

function makeDock(container: HTMLElement, placement: Placement, direction: string): Dock {
  const node = container.ownerDocument.createElement("div");
  node.className = "ui-notification-dock";
  node.dataset.placement = placement;
  node.dir = direction;
  container.appendChild(node);

  let neighbors: HTMLElement[] = [];
  const measure = () => {
    const height = Math.max(0, ...neighbors.map((region) => region.offsetHeight));
    node.style.setProperty("--ui-notification-toast-height", `${height}px`);
    node.toggleAttribute("data-with-toast", height > 0);
  };
  const size = new ResizeObserver(measure);
  const changes = new MutationObserver(sync);
  function sync() {
    changes.disconnect();
    size.disconnect();
    changes.observe(container, { childList: true });
    neighbors = [];
    for (const el of container.children) {
      if (!(el instanceof HTMLElement) || !el.classList.contains("ui-toast-region")) continue;
      changes.observe(el, { attributes: true, attributeFilter: ["data-placement", "dir"] });
      if (el.dataset.placement !== placement) continue;
      if (placement === "bottom-end" && el.dir && el.dir !== direction) continue;
      neighbors.push(el);
      size.observe(el, { box: "border-box" });
    }
    measure();
  }
  sync();
  return { node, users: 0, dispose: () => { changes.disconnect(); size.disconnect(); node.remove(); } };
}

export function useNotificationDock(placement: Placement) {
  const { getContainer } = useUNSAFE_PortalContext();
  const { direction } = useLocale();
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const parent = getContainer ? getContainer() : document.body;
    if (!parent) { setNode(null); return; }
    const key = placement === "top" ? placement : `${placement}:${direction}`;
    const group = docks.get(parent) ?? new Map<string, Dock>();
    docks.set(parent, group);
    const dock = group.get(key) ?? makeDock(parent, placement, direction);
    group.set(key, dock);
    dock.users++;
    setNode(dock.node);
    return () => {
      if (--dock.users > 0) return;
      // React 先清理父级 layout effect，再卸载 portal 子树。等子树检查并归还焦点后才拆宿主。
      queueMicrotask(() => {
        if (dock.users || group.get(key) !== dock) return;
        dock.dispose();
        group.delete(key);
        if (!group.size) docks.delete(parent);
      });
    };
  }, [direction, getContainer, placement]);
  return node;
}
