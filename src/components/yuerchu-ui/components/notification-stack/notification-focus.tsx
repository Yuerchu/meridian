"use client";

import { Component, type ReactNode, type RefObject } from "react";

interface FocusProps {
  region: RefObject<HTMLDivElement | null>;
  origin: RefObject<HTMLElement | null>;
  keys: readonly string[];
  children: ReactNode;
}

interface FocusSnapshot {
  node: HTMLElement;
  key: string | null;
  origin: HTMLElement | null;
}

function canFocus(node: HTMLElement | null): node is HTMLElement {
  return !!node?.isConnected &&
    !node.closest('[inert], [hidden], [aria-hidden="true"], :disabled, [aria-disabled="true"]');
}

/** 在 DOM 移动、置 inert 或卸载前取焦点；提交后的 activeElement 可能已经是 body。 */
export class NotificationFocus extends Component<FocusProps, unknown, FocusSnapshot | null> {
  getSnapshotBeforeUpdate(prev: FocusProps): FocusSnapshot | null {
    const { keys, region, origin } = this.props;
    if (keys.length === prev.keys.length && keys.every((key, i) => key === prev.keys[i])) return null;
    const root = region.current;
    const node = root?.ownerDocument.activeElement;
    if (!root || !(node instanceof HTMLElement) || !root.contains(node)) return null;
    const key = node.closest<HTMLElement>("[data-notification-key]")?.dataset.notificationKey ?? null;
    return { node, key, origin: origin.current };
  }

  componentDidUpdate(prev: FocusProps, _state: unknown, snapshot?: FocusSnapshot | null) {
    const { keys, region, origin } = this.props;
    const root = region.current;
    if (!snapshot || !root) return;
    const doc = root.ownerDocument;
    const active = doc.activeElement;
    if (active && active !== doc.body && !root.contains(active)) return;
    if (!keys.length) {
      if (canFocus(snapshot.origin)) snapshot.origin.focus({ preventScroll: true });
      return;
    }
    if (snapshot.key === null) {
      if (active !== snapshot.node && canFocus(snapshot.node)) snapshot.node.focus({ preventScroll: true });
      return;
    }
    if (keys.includes(snapshot.key) && canFocus(snapshot.node)) {
      if (active !== snapshot.node) snapshot.node.focus({ preventScroll: true });
      return;
    }
    const i = prev.keys.indexOf(snapshot.key);
    const neighbor = keys.includes(snapshot.key)
      ? keys[0]
      : [...prev.keys.slice(i + 1), ...prev.keys.slice(0, i).reverse()].find((key) => keys.includes(key));
    const targetKey = neighbor ?? keys[0];
    const row = [...root.querySelectorAll<HTMLElement>("[data-notification-key]")].find(
      (el) => el.dataset.notificationKey === targetKey,
    );
    const target = row?.querySelector<HTMLElement>('article[tabindex="-1"]') ?? root;
    origin.current = snapshot.origin;
    if (canFocus(target)) target.focus({ preventScroll: true });
  }

  componentWillUnmount() {
    const { region, origin } = this.props;
    const root = region.current;
    if (root?.contains(root.ownerDocument.activeElement) && canFocus(origin.current)) {
      origin.current.focus({ preventScroll: true });
    }
  }

  render() { return this.props.children; }
}
