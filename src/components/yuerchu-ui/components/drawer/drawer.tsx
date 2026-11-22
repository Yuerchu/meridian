"use client";

import type { DragControls } from "motion/react";
import { animate, motion, useDragControls, useMotionValue, useMotionValueEvent } from "motion/react";
import type { ReactNode } from "react";
import { createContext, useContext, useId, useRef } from "react";
import type { ModalOverlayProps } from "react-aria-components";
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { XIcon } from "../../lib/icons";
import { useMotionTokens } from "../../lib/motion";
import { TextBlock } from "../../lib/text-block";
import { Button } from "../button/button";
import { drawerStrings } from "./drawer.strings";
import "./drawer.css";

export { DialogTrigger } from "react-aria-components";

/**
 * 从页面侧边或底部滑出的模态面板，适合展示详情、编辑表单或筛选条件，无需离开当前页面。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface DrawerProps extends Omit<ModalOverlayProps, "children" | "className" | "style"> {
  /** 抽屉标题，打开后作为模态对话框的无障碍名称。 */
  heading: ReactNode;
  /** 标题下方的辅助说明；传入纯文本时渲染为段落，传入元素时渲染为容器。 */
  description?: ReactNode;
  /** 抽屉主体内容，支持滚动；传入渲染函数时可接收 `close` 方法。 */
  children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  /** 固定在底部的操作区（如“取消”与“保存”按钮）；传入渲染函数时可接收 `close` 方法。 */
  footer?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  /**
   * 滑出方向。
   * @default "right"
   */
  side?: "right" | "left" | "bottom";
  /**
   * 面板宽度（左右方向）或最大高度（底部方向）。左右方向下 sm 为 360px、md 为 480px、lg 为 640px；底部方向下对应视口高度的 40%、60%、85%。窄屏下左右抽屉会自动占满宽度。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 附加到抽屉面板根元素的自定义类名。 */
  className?: string;
}

/**
 * 可配合 `DialogTrigger` 使用，或通过 `isOpen` 与 `onOpenChange` 受控显示。
 * 标题与底部操作区固定，仅中间主体区域滚动；点击遮罩或按 Esc 可关闭并恢复焦点。
 *
 * @promote isOpen, defaultOpen, onOpenChange, isDismissable, isKeyboardDismissDisabled
 */
export function Drawer({ heading, description, children, footer, side = "right", size = "md", isDismissable = true, className, ...props }: DrawerProps) {
  const t = useStrings(drawerStrings);
  const descriptionId = useId();
  const swipeable = side === "bottom" && isDismissable;
  const sheetClass = className ? `ui-drawer ${className}` : "ui-drawer";
  const dialog = (
    <AriaDialog className="ui-drawer__dialog" aria-describedby={description ? descriptionId : undefined}>
      {({ close }) => (
        <>
          {swipeable ? <span className="ui-drawer__grip" aria-hidden="true" /> : null}
          <DrawerHeader swipeable={swipeable}>
                <Heading slot="title" className="ui-drawer__title">
                  {heading}
                </Heading>
                {description ? (
                  <TextBlock id={descriptionId} className="ui-drawer__description">
                    {description}
                  </TextBlock>
                ) : null}
          </DrawerHeader>
          <div className="ui-drawer__body">{typeof children === "function" ? children({ close }) : children}</div>
          {footer ? <div className="ui-drawer__footer">{typeof footer === "function" ? footer({ close }) : footer}</div> : null}
          {/* 视觉上在右上角，DOM 里放最后：Tab 先进入内容，最后才到关闭按钮（同 Dialog） */}
          <Button className="ui-drawer__close" variant="ghost" size="sm" icon={<XIcon />} aria-label={t.close} onPress={close} />
        </>
      )}
    </AriaDialog>
  );
  return (
    <ModalOverlay {...props} isDismissable={isDismissable} className="ui-drawer-overlay" data-side={side}>
      {({ state }) =>
        swipeable ? (
          <SwipeSheet className={sheetClass} size={size} onClose={state.close}>
            {dialog}
          </SwipeSheet>
        ) : (
          <Modal className={sheetClass} data-side={side} data-size={size}>
            {dialog}
          </Modal>
        )
      }
    </ModalOverlay>
  );
}

/** 往上拖的阻力：手指移动多少，抽屉只跟着动这么多倍 */
const PULL_ELASTIC = 0.06;

const MotionModal = motion.create(Modal);
const SwipeContext = createContext<DragControls | null>(null);

/**
 * 底部抽屉：可以按住标题区往下拖（Motion 的 drag）。抽屉跟着手指走，遮罩跟着变淡；拖过一半，或者快速往下一甩，松手就关闭，
 * 关闭时从当前位置接着滑出去（退场动画用的是 translate，拖动用的是 transform，两个叠在一起）；否则接着松手时的速度弹回（springGesture）。
 * 往上拖有阻力。只响应指针（键盘用 Esc 或关闭按钮）。
 */
function SwipeSheet({ className, size, onClose, children }: { className: string; size: string; onClose: () => void; children: ReactNode }) {
  const m = useMotionTokens();
  const controls = useDragControls();
  const y = useMotionValue(0);
  const ref = useRef<HTMLDivElement>(null);
  const overlay = () => ref.current?.closest<HTMLElement>(".ui-drawer-overlay") ?? null;
  // 遮罩跟着拖动的距离变淡（只淡化背景色，见 CSS）
  useMotionValueEvent(y, "change", (v) => {
    const sheet = ref.current;
    if (sheet) overlay()?.style.setProperty("--ui-drawer-drag-progress", String(Math.max(0, v) / sheet.offsetHeight));
  });
  const setDragging = (on: boolean) => {
    for (const el of [ref.current, overlay()]) {
      if (on) el?.setAttribute("data-dragging", "");
      else el?.removeAttribute("data-dragging");
    }
  };
  return (
    <SwipeContext value={controls}>
      <MotionModal
        ref={ref}
        className={className}
        data-side="bottom"
        data-size={size}
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: PULL_ELASTIC, bottom: 1 }}
        dragMomentum={false}
        onDragStart={() => setDragging(true)}
        // Motion 松手时先播自己的回弹，下一帧才调这里：在同一个 y 上接着播，接管它
        onDragEnd={(_, info) => {
          setDragging(false);
          const dy = y.get();
          const height = ref.current?.offsetHeight ?? 0;
          if (dy > height / 2 || (info.velocity.y > 500 && dy > 24)) {
            // 停在当前位置，退场动画从这里接着滑出去
            y.stop();
            onClose();
            return;
          }
          void animate(y, 0, m.springGesture);
        }}
      >
        {children}
      </MotionModal>
    </SwipeContext>
  );
}

/** 标题区。底部抽屉时按下就交给 SwipeSheet 开始拖 */
function DrawerHeader({ swipeable, children }: { swipeable: boolean; children: ReactNode }) {
  const controls = useContext(SwipeContext);
  if (!swipeable) return <div className="ui-drawer__header">{children}</div>;
  return (
    // eslint-disable-next-line ui/no-raw-interactive -- 拖动手势的起点，不是按钮；键盘用 Esc 或关闭按钮关掉抽屉
    <div className="ui-drawer__header" data-swipe="" onPointerDown={(e) => controls?.start(e)}>
      {children}
    </div>
  );
}
