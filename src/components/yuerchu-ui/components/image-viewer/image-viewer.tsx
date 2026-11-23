"use client";

import type { ReactNode } from "react";
import { useContext, useEffect, useRef, useState } from "react";
import type { KeyboardEvents } from "react-aria";
import { useKeyboard, useLocale } from "react-aria";
import type { ModalOverlayProps } from "react-aria-components";
import { Dialog, Heading, Modal, ModalOverlay, OverlayTriggerStateContext } from "react-aria-components";
import { announce } from "../../lib/announce";
import { useStrings } from "../../lib/i18n";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, RotateCwIcon, XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { Spinner } from "../spinner/spinner";
import { imageViewerStrings } from "./image-viewer.strings";
import "./image-viewer.css";

/**
 * 全屏查看单张或一组图片的灯箱组件，支持缩放、拖拽平移、旋转、键盘快捷键与触屏手势。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface ImageViewerImage {
  /** 图片唯一标识。 */
  id: string;
  /** 图片资源地址。 */
  src: string;
  /** 替代文本（必填），供读屏描述图片内容；未传 `title` 时也作为标题栏名称。 */
  alt: string;
  /** 标题栏显示的名称，例如文件名。 */
  title?: string;
}

export interface ImageViewerProps extends Omit<ModalOverlayProps, "children" | "className" | "style" | "isDismissable"> {
  /** 要展示的图片列表。 */
  images: readonly ImageViewerImage[];
  /** 当前展示的图片 id（受控）。 */
  selectedKey?: string;
  /** 打开灯箱时默认展示的图片 id，默认从第一张开始，每次打开都会重新读取。 */
  defaultSelectedKey?: string;
  /** 切换图片时的回调，参数为新图片的 id。 */
  onSelectionChange?: (key: string) => void;
  /**
   * 是否开启首尾循环切图。
   * @default false
   */
  loop?: boolean;
  /** 标题栏左侧的自定义操作渲染函数（例如下载、删除），参数为当前图片对象，显示在内置操作按钮之前。 */
  actions?: (image: ImageViewerImage) => ReactNode;
  /** 自定义弹层根元素类名。 */
  className?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.5;
const WHEEL_STEP = 1.2;
const KEY_PAN = 48;

type View = { id: string | undefined; scale: number; x: number; y: number; rotation: number };
type Point = { x: number; y: number };
type Gesture =
  | { kind: "pinch"; distance: number; scale: number }
  | { kind: "pan" | "swipe"; start: Point; x: number; y: number }
  | { kind: "idle" };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const isControl = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest("a, button, input, select, textarea, [contenteditable]:not([contenteditable=false])");
const isEditable = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest("input, select, textarea, [contenteditable]:not([contenteditable=false]), [role=menu], [role=listbox], [role=slider]");

/**
 * 全屏图片灯箱。可通过 `isOpen` / `onOpenChange` 受控，或搭配 `DialogTrigger` 使用；
 * 切换图片时会自动重置缩放与旋转，并预加载前后相邻图片。
 *
 * @promote isOpen, defaultOpen, onOpenChange
 */
export function ImageViewer({ images, selectedKey, defaultSelectedKey, onSelectionChange, loop = false, actions, className, ...props }: ImageViewerProps) {
  return (
    <ModalOverlay {...props} isDismissable className="ui-image-viewer-overlay">
      <Modal className={className ? `ui-image-viewer ${className}` : "ui-image-viewer"}>
        <ViewerContent images={images} selectedKey={selectedKey} defaultSelectedKey={defaultSelectedKey}
          onSelectionChange={onSelectionChange} loop={loop} actions={actions} />
      </Modal>
    </ModalOverlay>
  );
}

type ContentProps = Pick<ImageViewerProps, "images" | "selectedKey" | "defaultSelectedKey" | "onSelectionChange" | "actions"> & {
  loop: boolean;
};

function ViewerContent({ images, selectedKey, defaultSelectedKey, onSelectionChange, loop, actions }: ContentProps) {
  const t = useStrings(imageViewerStrings);
  const overlay = useContext(OverlayTriggerStateContext);
  const close = () => overlay?.close();
  const { direction } = useLocale();
  const [ownKey, setOwnKey] = useState(defaultSelectedKey ?? images[0]?.id ?? "");
  const index = Math.max(0, images.findIndex((item) => item.id === (selectedKey ?? ownKey)));
  const image = images[index];
  const total = images.length;

  // 视图跟图片 id 绑定：换图时直接得到初始视图，不会先用旧的缩放画一帧
  const [stored, setStored] = useState<View>({ id: image?.id, scale: 1, x: 0, y: 0, rotation: 0 });
  const view: View = stored.id === image?.id ? stored : { id: image?.id, scale: 1, x: 0, y: 0, rotation: 0 };
  const viewRef = useRef(view);
  viewRef.current = view;
  const [status, setStatus] = useState<Record<string, "loaded" | "error">>({});
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>({ kind: "idle" });
  const pinched = useRef(false);
  const refocus = useRef<string | null>(null);

  const state = image ? status[image.id] : undefined;
  const ready = state === "loaded";
  const percent = Math.round(view.scale * 100);
  const hasPrevious = total > 1 && (loop || index > 0);
  const hasNext = total > 1 && (loop || index < total - 1);

  const update = (change: (current: View) => Partial<View>) => {
    const current = viewRef.current;
    const merged = { ...current, ...change(current) };
    const scale = clamp(merged.scale, MIN_SCALE, MAX_SCALE);
    const maxX = ((scale - 1) * (stage.current?.clientWidth ?? 0)) / 2;
    const maxY = ((scale - 1) * (stage.current?.clientHeight ?? 0)) / 2;
    const next = { ...merged, scale, x: clamp(merged.x, -maxX, maxX) || 0, y: clamp(merged.y, -maxY, maxY) || 0 };
    viewRef.current = next;
    setStored(next);
  };
  const zoom = (factor: number) => update((current) => ({ scale: current.scale * factor }));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const go = (step: number) => {
    if (total < 2) return;
    const raw = index + step;
    const next = loop ? (raw + total) % total : raw;
    if (next < 0 || next >= total || next === index) return;
    setOwnKey(images[next]!.id);
    onSelectionChange?.(images[next]!.id);
  };

  // 按下的按钮因到达边界被禁用时，焦点移到相反方向的按钮，免得掉回页面开头
  const pressZoom = (factor: number) => {
    const scale = clamp(viewRef.current.scale * factor, MIN_SCALE, MAX_SCALE);
    if (factor > 1 && scale >= MAX_SCALE) refocus.current = ".ui-image-viewer__zoom-out";
    if (factor < 1 && scale <= MIN_SCALE) refocus.current = ".ui-image-viewer__zoom-in";
    zoom(factor);
  };
  const pressStep = (step: number) => {
    const target = index + step;
    if (!loop && (target <= 0 || target >= total - 1)) refocus.current = step > 0 ? ".ui-image-viewer__previous" : ".ui-image-viewer__next";
    go(step);
  };
  useEffect(() => {
    if (!refocus.current) return;
    const button = root.current?.querySelector<HTMLButtonElement>(refocus.current);
    refocus.current = null;
    if (button && !button.disabled) button.focus();
  });

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY) zoomRef.current(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const cancel = () => {
    pointers.current.clear();
    gesture.current = { kind: "idle" };
    pinched.current = false;
    setDragging(false);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onCancel = () => cancelRef.current();
    window.addEventListener("blur", onCancel);
    window.addEventListener("pointercancel", onCancel, true);
    return () => {
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("pointercancel", onCancel, true);
    };
  }, []);

  // 按当前按住的手指数决定手势：两指缩放；一指放大后拖动、未放大时左右滑动切换。从两指退回一指时只拖动不切换。
  const begin = () => {
    const list = [...pointers.current.values()];
    const current = viewRef.current;
    if (list.length >= 2) {
      pinched.current = true;
      gesture.current = { kind: "pinch", distance: distance(list[0]!, list[1]!) || 1, scale: current.scale };
    } else if (list.length === 1) {
      const kind = current.scale > 1 ? "pan" : pinched.current ? "idle" : "swipe";
      gesture.current = kind === "idle" ? { kind } : { kind, start: list[0]!, x: current.x, y: current.y };
    } else {
      gesture.current = { kind: "idle" };
      pinched.current = false;
    }
    setDragging(gesture.current.kind === "pan" || gesture.current.kind === "pinch");
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!ready || isControl(event.target) || (event.pointerType === "mouse" && event.button !== 0)) return;
    stage.current?.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    begin();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (current.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (a && b) update(() => ({ scale: (current.scale * distance(a, b)) / current.distance }));
    } else if (current.kind === "pan") {
      update(() => ({ x: current.x + event.clientX - current.start.x, y: current.y + event.clientY - current.start.y }));
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (current.kind === "swipe" && pointers.current.size === 0) {
      const dx = event.clientX - current.start.x;
      const dy = event.clientY - current.start.y;
      const threshold = Math.max(40, (stage.current?.clientWidth ?? 0) * 0.15);
      if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy)) {
        const forward = direction === "rtl" ? dx > 0 : dx < 0;
        go(forward ? 1 : -1);
      }
    }
    begin();
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (ready && !isControl(event.target)) update((current) => (current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2 }));
  };

  // 舞台是手势区，不是可聚焦控件（键盘和按钮提供同样的操作），所以挂原生监听；处理函数每次渲染更新
  const handlers = useRef({ onPointerDown, onPointerMove, onPointerUp, onDoubleClick, cancel });
  handlers.current = { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, cancel };
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const down = (event: PointerEvent) => handlers.current.onPointerDown(event);
    const move = (event: PointerEvent) => handlers.current.onPointerMove(event);
    const up = (event: PointerEvent) => handlers.current.onPointerUp(event);
    const dbl = (event: MouseEvent) => handlers.current.onDoubleClick(event);
    const stop = () => handlers.current.cancel();
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", stop);
    element.addEventListener("dblclick", dbl);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", stop);
      element.removeEventListener("dblclick", dbl);
    };
  }, []);

  // 切换后播报位置和图片描述（首次打开由对话框标题说明，不重复播报）
  const announced = useRef(image?.id);
  useEffect(() => {
    if (!image || announced.current === image.id) return;
    announced.current = image.id;
    announce(t.position({ position: index + 1, total, label: image.alt }));
  }, [image, index, total, t]);

  const onKeyDown: NonNullable<KeyboardEvents["onKeyDown"]> = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) {
      event.continuePropagation();
      return;
    }
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if ((horizontal || vertical) && viewRef.current.scale > 1) {
      update((current) => ({ x: current.x - horizontal * KEY_PAN, y: current.y - vertical * KEY_PAN }));
    } else if (horizontal) {
      go(direction === "rtl" ? -horizontal : horizontal);
    } else if ((event.key === "+" || event.key === "=") && ready) {
      zoom(ZOOM_STEP);
    } else if ((event.key === "-" || event.key === "_") && ready) {
      zoom(1 / ZOOM_STEP);
    } else if (event.key === "0" && ready) {
      update(() => ({ scale: 1, x: 0, y: 0, rotation: 0 }));
    } else if ((event.key === "r" || event.key === "R") && ready) {
      update((current) => ({ rotation: current.rotation + 90 }));
    } else {
      // 其它按键（Tab、Esc、Enter…）继续交给按钮和对话框处理
      event.continuePropagation();
      return;
    }
    event.preventDefault();
  };
  const { keyboardProps } = useKeyboard({ onKeyDown });

  const neighbors = total > 1
    ? [...new Set([index - 1, index + 1].map((value) => (loop ? (value + total) % total : value)))]
      .filter((value) => value >= 0 && value < total && value !== index)
    : [];

  return (
    // 键盘挂在 Dialog 外面一层：打开时焦点在 Dialog 本身，挂在里层收不到；Dialog 也不转发 onKeyDown
    <div className="ui-image-viewer__keys" {...keyboardProps}>
    <Dialog className="ui-image-viewer__dialog">
    <div ref={root} className="ui-image-viewer__frame">
      <div className="ui-image-viewer__header">
        <div className="ui-image-viewer__heading">
          <Heading slot="title" className="ui-image-viewer__title">{image ? image.title ?? image.alt : t.empty}</Heading>
          {total > 1 ? <span className="ui-image-viewer__counter">{t.counter({ position: index + 1, total })}</span> : null}
        </div>
        <div className="ui-image-viewer__toolbar" role="group" aria-label={t.toolbar}>
          {image && actions ? actions(image) : null}
          <Button className="ui-image-viewer__zoom-out" variant="ghost" size="sm" icon={<MinusIcon />} aria-label={t.zoomOut}
            isDisabled={!ready || view.scale <= MIN_SCALE} onPress={() => pressZoom(1 / ZOOM_STEP)} />
          <Button className="ui-image-viewer__reset" variant="ghost" size="sm" aria-label={t.reset({ percent })}
            isDisabled={!ready} onPress={() => update(() => ({ scale: 1, x: 0, y: 0, rotation: 0 }))}>{`${percent}%`}</Button>
          <Button className="ui-image-viewer__zoom-in" variant="ghost" size="sm" icon={<PlusIcon />} aria-label={t.zoomIn}
            isDisabled={!ready || view.scale >= MAX_SCALE} onPress={() => pressZoom(ZOOM_STEP)} />
          <Button variant="ghost" size="sm" icon={<RotateCwIcon />} aria-label={t.rotate}
            isDisabled={!ready} onPress={() => update((current) => ({ rotation: current.rotation + 90 }))} />
          <Button variant="ghost" size="sm" icon={<XIcon />} aria-label={t.close} onPress={close} />
        </div>
      </div>
      <div ref={stage} className="ui-image-viewer__stage" data-zoomed={view.scale > 1 || undefined} data-dragging={dragging || undefined}>
        {image ? (
          <img key={image.id} className="ui-image-viewer__image" src={image.src} alt={image.alt} draggable={false}
            data-state={state ?? "loading"}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rotation}deg)` }}
            onLoad={() => setStatus((current) => ({ ...current, [image.id]: "loaded" }))}
            onError={() => setStatus((current) => ({ ...current, [image.id]: "error" }))} />
        ) : <p className="ui-image-viewer__message">{t.empty}</p>}
        {image && !state ? <Spinner className="ui-image-viewer__spinner" size="lg" aria-label={t.loading} /> : null}
        {state === "error" ? <p className="ui-image-viewer__message">{t.failed}</p> : null}
        {total > 1 ? (
          <>
            <Button className="ui-image-viewer__previous" variant="secondary" icon={<ChevronLeftIcon />} aria-label={t.previous}
              isDisabled={!hasPrevious} onPress={() => pressStep(-1)} />
            <Button className="ui-image-viewer__next" variant="secondary" icon={<ChevronRightIcon />} aria-label={t.next}
              isDisabled={!hasNext} onPress={() => pressStep(1)} />
          </>
        ) : null}
      </div>
      <div className="ui-image-viewer__preload" aria-hidden="true">
        {neighbors.map((value) => <img key={images[value]!.id} src={images[value]!.src} alt="" />)}
      </div>
    </div>
    </Dialog>
    </div>
  );
}
