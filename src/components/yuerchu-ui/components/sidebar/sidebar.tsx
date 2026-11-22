"use client";

import type { CSSProperties, ReactNode } from "react";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { mergeProps, useFocusRing, useHover, useKeyboard, useLocale, useMove, usePress } from "react-aria";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { useStrings } from "../../lib/i18n";
import { MenuIcon, PanelLeftIcon, XIcon } from "../../lib/icons";
import { Button } from "../button/button";
import { NavCollapsedContext, NavigateContext } from "../nav-list/nav-list";
import { ResizeGrip, useGripDirection } from "../resizable-panels/resize-grip";
import { sidebarStrings } from "./sidebar.strings";
import "./sidebar.css";

/**
 * 适配桌面与移动端的侧边栏导航容器，宽屏下固定在侧边独立滚动，窄屏下自动转为顶栏与左侧滑出抽屉，通常与 SidebarLayout 配合使用。
 *
 * @packageDocumentation
 * @category 导航
 * @status 实验中
 */

export interface SidebarProps {
  /** 顶部区域内容，通常放置产品标志或首页链接，在窄屏模式下会同步展示在顶栏左侧。 */
  header?: ReactNode;
  /** 导航主体内容，通常放置 NavList，内容超出时会在内部独立滚动。 */
  children?: ReactNode;
  /** 底部区域内容，适合放置账户菜单或主题切换控件。 */
  footer?: ReactNode;
  /**
   * 侧边栏的无障碍名称。
   * @default "侧边栏"（英文界面 "Sidebar"）
   */
  "aria-label"?: string;
  /** 是否允许在宽屏下折叠为仅显示图标的窄条；窄屏下仍保持抽屉形态。 */
  isCollapsible?: boolean;
  /** 是否处于收起状态（受控）。 */
  isCollapsed?: boolean;
  /** 初始是否默认收起（非受控）。 */
  defaultCollapsed?: boolean;
  /** 收起或展开状态切换时触发的回调函数。 */
  onCollapsedChange?: (isCollapsed: boolean) => void;
  /** 侧边栏折叠为图标条时顶部显示的内容（例如紧凑图标标志），未传入时折叠后顶部留空。 */
  collapsedHeader?: ReactNode;
  /**
   * 是否允许在宽屏展开状态下拖拽右边缘或通过键盘方向键调整宽度；收起为图标条时不可调整。
   */
  isResizable?: boolean;
  /** 侧边栏的受控宽度（px）。 */
  width?: number;
  /**
   * 初始默认宽度（px）。
   * @default 248
   */
  defaultWidth?: number;
  /** 宽度发生变化时触发的回调函数，参数为新的宽度值（px）。 */
  onWidthChange?: (width: number) => void;
  /**
   * 允许调整的最小宽度（px）。
   * @default 200
   */
  minWidth?: number;
  /**
   * 允许调整的最大宽度（px）。
   * @default 420
   */
  maxWidth?: number;
  /**
   * 窄屏抽屉是否打开（受控）。未传入时由组件自己记，初始为 `defaultDrawerOpen`。
   * 宽屏没有抽屉：一旦确认当前是宽屏且这里仍为打开，会调用 `onDrawerOpenChange(false)`。
   */
  isDrawerOpen?: boolean;
  /** 抽屉打开或关闭时调用。点遮罩、按 Esc、点关闭按钮、点 NavItem，以及离开窄屏收起，都走这里。 */
  onDrawerOpenChange?: (open: boolean) => void;
  /**
   * 非受控时，抽屉是否一开始就打开。
   * @default false
   */
  defaultDrawerOpen?: boolean;
  /**
   * 窄屏是否渲染库自己的顶栏和“打开导航”按钮。应用已有顶栏时设为 false，并由应用控制 `isDrawerOpen`。
   * @default true
   */
  showMobileBar?: boolean;
}

const WIDTH_STEP = 16;

/** SidebarLayout 把断点传给里面的 Sidebar。单独用 Sidebar 时按 768px，和样式一致。 */
const DrawerBelowContext = createContext<"md" | "lg">("md");

const DRAWER_QUERY = {
  md: "(width < 768px)",
  lg: "(width < 1024px)",
} as const;

/**
 * 当前视口是否落在抽屉断点内。null 表示还没量过：不能据此打开，也不能据此关闭。
 * 查询串和 sidebar.css 的媒体查询是同一条，避免差一像素。
 */
function useIsNarrow(below: "md" | "lg"): boolean | null {
  const query = DRAWER_QUERY[below];
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * 应用侧边栏组件，宽屏下作为固定侧栏渲染，窄屏下切换为顶栏与模态抽屉；点击抽屉内的 NavItem 跳转后会自动关闭抽屉。
 */
export function Sidebar({
  header,
  children,
  footer,
  "aria-label": ariaLabelProp,
  isCollapsible = false,
  isCollapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  collapsedHeader,
  isResizable = false,
  width: widthProp,
  defaultWidth = 248,
  onWidthChange,
  minWidth = 200,
  maxWidth = 420,
  isDrawerOpen,
  onDrawerOpenChange,
  defaultDrawerOpen = false,
  showMobileBar = true,
}: SidebarProps) {
  const t = useStrings(sidebarStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const [ownOpen, setOwnOpen] = useState(defaultDrawerOpen);
  const drawerOpen = isDrawerOpen ?? ownOpen;
  const setDrawerOpen = (open: boolean) => {
    if (isDrawerOpen === undefined) setOwnOpen(open);
    onDrawerOpenChange?.(open);
  };
  const drawerBelow = useContext(DrawerBelowContext);
  const isNarrow = useIsNarrow(drawerBelow);
  // 宽屏没有抽屉。确认是宽屏且还开着时通知一次关闭，避免状态和画面分叉，拉回窄屏自己弹开。
  // 还没量到视口时不通知，避免首帧把窄屏误判成宽屏。已经关着的不多发一次 false。
  const dismissedOnWide = useRef(false);
  useEffect(() => {
    if (isNarrow !== false || !drawerOpen) {
      dismissedOnWide.current = false;
      return;
    }
    if (dismissedOnWide.current) return;
    dismissedOnWide.current = true;
    if (isDrawerOpen === undefined) setOwnOpen(false);
    onDrawerOpenChange?.(false);
  }, [isNarrow, drawerOpen, isDrawerOpen, onDrawerOpenChange]);
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed);
  const collapsed = isCollapsible && (isCollapsed ?? ownCollapsed);
  const toggle = () => {
    if (isCollapsed === undefined) setOwnCollapsed(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const panelId = useId();
  const [ownWidth, setOwnWidth] = useState(defaultWidth);
  const clampWidth = (px: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(px)));
  const width = clampWidth(widthProp ?? ownWidth);
  const setWidth = (px: number) => {
    const next = clampWidth(px);
    if (widthProp === undefined) setOwnWidth(next);
    onWidthChange?.(next);
  };
  const resizable = isResizable && !collapsed;
  const content = (
    <>
      {header ? <div className="ui-sidebar__header">{header}</div> : null}
      <div className="ui-sidebar__body">{children}</div>
      {footer ? <div className="ui-sidebar__footer">{footer}</div> : null}
    </>
  );

  return (
    // 可拖宽度时把宽度写在自己身上；布局的那一栏跟着它（见 CSS 的 :has）
    <div className="ui-sidebar" data-resizable={resizable || undefined}
      style={resizable ? ({ "--ui-sidebar-width": `${width}px` } as CSSProperties) : undefined}>
      {/* 宽屏：固定在左边；可以收起成图标条 */}
      <aside id={panelId} className="ui-sidebar__panel" aria-label={ariaLabel} data-collapsed={collapsed || undefined}>
        {collapsed ? (
          <>
            {collapsedHeader ? <div className="ui-sidebar__header">{collapsedHeader}</div> : null}
            <div className="ui-sidebar__body">
              <NavCollapsedContext.Provider value={true}>{children}</NavCollapsedContext.Provider>
            </div>
          </>
        ) : (
          content
        )}
        {isCollapsible ? (
          <div className="ui-sidebar__collapse">
            <Button
              variant="ghost"
              size="sm"
              icon={<PanelLeftIcon />}
              aria-label={collapsed ? t.expand : t.collapse}
              aria-expanded={!collapsed}
              aria-controls={panelId}
              onPress={toggle}
            />
          </div>
        ) : null}
        {resizable ? (
          <WidthHandle panelId={panelId} width={width} minWidth={minWidth} maxWidth={maxWidth} defaultWidth={defaultWidth} onChange={setWidth} />
        ) : null}
      </aside>

      {/* 窄屏：顶栏 + 抽屉。宽屏不挂 Modal，否则即使用样式藏住，也会锁滚动、圈焦点 */}
      {showMobileBar ? (
        <div className="ui-sidebar__bar">
          {header ? <div className="ui-sidebar__bar-header">{header}</div> : null}
          <Button variant="ghost" icon={<MenuIcon />} aria-label={t.open} aria-expanded={drawerOpen} onPress={() => setDrawerOpen(true)} />
        </div>
      ) : null}
      {isNarrow ? (
        <ModalOverlay isOpen={drawerOpen} onOpenChange={setDrawerOpen} isDismissable className="ui-sidebar__overlay">
          <Modal className="ui-sidebar__drawer">
            <Dialog aria-label={ariaLabel} className="ui-sidebar__dialog">
              <NavigateContext.Provider value={() => setDrawerOpen(false)}>{content}</NavigateContext.Provider>
              <Button className="ui-sidebar__close" variant="ghost" size="sm" icon={<XIcon />} aria-label={t.close} onPress={() => setDrawerOpen(false)} />
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
    </div>
  );
}

export interface SidebarLayoutProps {
  /** 传入 Sidebar 组件实例作为侧边栏。 */
  sidebar: ReactNode;
  /** 右侧或下方的主内容区域。 */
  children?: ReactNode;
  /**
   * 触发侧边栏收起为顶栏抽屉的视口宽度阈值；`md` 为 768px，`lg` 为 1024px，主内容较宽的文档或长文页面建议使用 `lg`。
   * @default "md"
   */
  drawerBelow?: "md" | "lg";
  /**
   * 嵌入其他容器（如文档预览、分栏或弹窗）时开启；开启后将铺满父容器并在内部滚动，主内容区不再渲染为 `<main>` 地标。
   * @default false
   */
  embedded?: boolean;
}

/**
 * 侧边栏布局容器，宽屏下呈侧栏与主区双栏排布，窄屏下切换为顶栏加主区单栏排布。
 */
export function SidebarLayout({ sidebar, children, drawerBelow = "md", embedded = false }: SidebarLayoutProps) {
  const Main = embedded ? "div" : "main";
  return (
    <DrawerBelowContext.Provider value={drawerBelow}>
      <div className="ui-sidebar-layout" data-drawer-below={drawerBelow} data-embedded={embedded || undefined}>
        {sidebar}
        <Main className="ui-sidebar-layout__main">{children}</Main>
      </div>
    </DrawerBelowContext.Provider>
  );
}

/**
 * 侧边栏边缘的宽度把手：可以聚焦的 role="separator"（带 aria-valuenow，单位 px）。基于 useMove，鼠标、触屏、键盘一样处理；
 * 从右到左的语言里把手在左边缘，拖动方向反过来。
 */
function WidthHandle({ panelId, width, minWidth, maxWidth, defaultWidth, onChange }: {
  panelId: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  onChange: (width: number) => void;
}) {
  const t = useStrings(sidebarStrings);
  const { direction: textDirection } = useLocale();
  const sign = textDirection === "rtl" ? -1 : 1;
  const start = useRef(width);
  const moved = useRef(0);
  const lastTap = useRef(0);
  const [isDragging, setDragging] = useState(false);
  const { moveProps } = useMove({
    onMoveStart(e) {
      start.current = width;
      moved.current = 0;
      if (e.pointerType !== "keyboard") setDragging(true);
    },
    onMoveEnd() {
      setDragging(false);
    },
    onMove(e) {
      if (e.pointerType === "keyboard") {
        // 只认左右方向键
        if (e.deltaX !== 0) onChange(width + Math.sign(e.deltaX) * sign * WIDTH_STEP);
        return;
      }
      moved.current += e.deltaX * sign;
      onChange(start.current + moved.current);
    },
  });
  const { keyboardProps } = useKeyboard({
    onKeyDown(e) {
      if (e.key === "Home") onChange(minWidth);
      else if (e.key === "End") onChange(maxWidth);
      else e.continuePropagation();
    },
  });
  // 双击（两次按下没有移动、间隔不到 300 毫秒）回到默认宽度
  const { pressProps } = usePress({
    onPress(e) {
      if (e.pointerType === "keyboard") return;
      const now = performance.now();
      if (now - lastTap.current < 300) {
        onChange(defaultWidth);
        lastTap.current = 0;
      } else lastTap.current = now;
    },
  });
  const { focusProps, isFocusVisible } = useFocusRing();
  const { hoverProps, isHovered } = useHover({});
  const grip = useGripDirection(isDragging || isFocusVisible);
  const limit = width <= minWidth ? (sign > 0 ? "start" : "end") : width >= maxWidth ? (sign > 0 ? "end" : "start") : undefined;
  return (
    <div
      {...mergeProps(moveProps, pressProps, keyboardProps, focusProps, hoverProps)}
      role="separator"
      tabIndex={0}
      aria-label={t.resize}
      aria-orientation="vertical"
      aria-controls={panelId}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuetext={t.width({ width })}
      className="ui-sidebar__resizer"
      data-resizing={isDragging || undefined}
      data-focus-visible={isFocusVisible || undefined}
    >
      <ResizeGrip isVisible={isHovered || isFocusVisible} isActive={isDragging || isFocusVisible} direction={grip} limit={limit} />
    </div>
  );
}
