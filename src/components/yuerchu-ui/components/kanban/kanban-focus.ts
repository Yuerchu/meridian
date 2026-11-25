/** 等受控更新或 RAC 拖放收尾时，一旦有新的用户操作就放弃还焦。 */
export function claimFocus(root: HTMLElement) {
  const doc = root.ownerDocument;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const options = { capture: true, signal: controller.signal };
  doc.addEventListener("keydown", cancel, options);
  doc.addEventListener("pointerdown", cancel, options);
  return { controller, origin: doc.activeElement };
}

export type FocusClaim = ReturnType<typeof claimFocus>;

export function focusKanbanCard(root: HTMLElement, columnId: string, cardId: string, claim: FocusClaim) {
  const { controller, origin } = claim;
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win || controller.signal.aborted) return;
  const lane = [...root.querySelectorAll<HTMLElement>("[data-kanban-column]")].find((el) =>
    el.closest(".ui-kanban") === root && el.dataset.kanbanColumn === columnId);
  if (!lane) { controller.abort(); return; }
  let frame = 0;
  const schedule = () => {
    if (controller.signal.aborted || frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      const active = doc.activeElement;
      const movedOutside = active && active !== doc.body && active !== origin && !root.contains(active);
      if (!lane.isConnected || movedOutside) { controller.abort(); return; }
      const row = [...lane.querySelectorAll<HTMLElement>('[role="row"][data-key]')].find((el) =>
        el.closest("[data-kanban-column]") === lane && el.dataset.key === cardId);
      const target = lane.hasAttribute("data-collapsed") ? lane.querySelector<HTMLElement>(".ui-kanban-column__toggle")
        : row?.querySelector<HTMLElement>('button[slot="drag"]');
      if (!target || target.closest('[inert], [hidden], [aria-hidden="true"]')) return;
      // RAC 在放下时可能临时聚焦行或集合；保留业务代码主动交给输入框等控件的焦点。
      if (active && active !== origin && active !== target && root.contains(active)
        && active.matches('input, textarea, select, a[href], button:not([slot="drag"]), [contenteditable="true"]')) {
        controller.abort();
        return;
      }
      target.focus({ preventScroll: true });
      if (doc.activeElement !== target) return;
      const clip = root.getBoundingClientRect();
      const column = lane.getBoundingClientRect();
      const box = column.width <= clip.width ? column : target.getBoundingClientRect();
      const delta = box.left < clip.left ? box.left - clip.left : Math.max(0, box.right - clip.right);
      if (delta && clip.width) root.scrollLeft += delta * root.offsetWidth / clip.width;
      controller.abort();
    });
  };
  // RAC 集合可能在下一次提交才出现；只观察目标列，不扫描页面或用固定延时猜焦点时机。
  const observer = new MutationObserver(schedule);
  observer.observe(lane, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden", "inert"],
  });
  controller.signal.addEventListener("abort", () => {
    win.cancelAnimationFrame(frame);
    observer.disconnect();
  }, { once: true });
  schedule();
}
