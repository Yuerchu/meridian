"use client";

import type { ReactNode } from "react";
import { Sidebar, SidebarLayout } from "../../components/sidebar/sidebar";
import "./app-shell.css";

/**
 * 应用登录后的整页布局框架，由可调整宽度的侧边栏、顶栏与主内容区组成，窄屏下侧边栏会自动收起为抽屉菜单。
 *
 * @packageDocumentation
 * @category 应用
 * @status 实验中
 */

export interface AppShellProps {
  /** 侧边栏顶部的品牌标识或标题，窄屏时也会显示在顶栏上。 */
  brand: ReactNode;
  /** 侧边栏主体导航内容，通常传入 NavList 或 Tree。 */
  navigation: ReactNode;
  /** 侧边栏底部区域，常用于展示用量指标或账户信息。 */
  sidebarFooter?: ReactNode;
  /** 侧边栏的无障碍名称。 @default "侧边栏" */
  sidebarLabel?: string;
  /** 顶栏左侧区域，通常放置搜索框（SearchField）。 */
  search?: ReactNode;
  /** 顶栏右侧的操作按钮组。 */
  actions?: ReactNode;
  /** 顶栏最右侧的用户菜单或通知入口。 */
  user?: ReactNode;
  /** 主内容区内容，通常搭配概览页或列表页等模板使用。 */
  children?: ReactNode;
  /** 受控模式下的侧边栏宽度（单位 px）。 */
  sidebarWidth?: number;
  /** 非受控模式下的侧边栏默认宽度（单位 px）。 @default 248 */
  defaultSidebarWidth?: number;
  /** 侧边栏宽度变化时的回调，可用于持久化保存用户调整后的宽度。 */
  onSidebarWidthChange?: (width: number) => void;
  /** 宽屏下是否可收成图标栏。窄屏仍是抽屉。 */
  isCollapsible?: boolean;
  /** 宽屏图标栏是否收起（受控）。 */
  isCollapsed?: boolean;
  /**
   * 非受控时，图标栏是否一开始就收起。
   * @default false
   */
  defaultCollapsed?: boolean;
  /** 图标栏收起或展开时调用。 */
  onCollapsedChange?: (isCollapsed: boolean) => void;
  /** 收成图标栏后顶部显示的内容。未传入时顶部留空。 */
  collapsedHeader?: ReactNode;
  /**
   * 是否以嵌入模式渲染。开启后将填满外层容器并在主区内滚动，不再占满视口或输出 main 地标。
   * @default false
   */
  embedded?: boolean;
  /**
   * 传给 SidebarLayout。`inset` 时主区收成圆角卡片，侧栏与卡片共用下沉底。
   */
  variant?: "inset";
  /**
   * 窄屏抽屉是否打开（受控）。未传入时由侧边栏自己记。自己管理返回栈的应用用这个接自己的历史层级，库不写浏览器历史。
   */
  isDrawerOpen?: boolean;
  /** 抽屉打开或关闭时调用，包括离开窄屏时收起。 */
  onDrawerOpenChange?: (open: boolean) => void;
  /**
   * 非受控时，抽屉是否一开始就打开。
   * @default false
   */
  defaultDrawerOpen?: boolean;
  /**
   * 窄屏是否渲染库自己的顶栏和“打开导航”按钮。应用已有标题栏时设为 false，并由应用控制 `isDrawerOpen`。
   * @default true
   */
  showMobileBar?: boolean;
  /**
   * 传给 SidebarLayout，决定多窄时收进抽屉。
   * @default "md"
   */
  drawerBelow?: "md" | "lg";
  /** 自定义根元素类名。 */
  className?: string;
}

/**
 * 编排侧边栏、顶栏与主内容区的应用外壳容器，支持侧边栏拖拽调宽与窄屏抽屉收起。
 */
export function AppShell({
  brand,
  navigation,
  sidebarFooter,
  sidebarLabel,
  search,
  actions,
  user,
  children,
  sidebarWidth,
  defaultSidebarWidth,
  onSidebarWidthChange,
  isCollapsible,
  isCollapsed,
  defaultCollapsed,
  onCollapsedChange,
  collapsedHeader,
  embedded = false,
  variant,
  isDrawerOpen,
  onDrawerOpenChange,
  defaultDrawerOpen,
  showMobileBar,
  drawerBelow,
  className,
}: AppShellProps) {
  const hasTopbar = Boolean(search || actions || user);
  return (
    <div className={className ? `ui-template-app-shell ${className}` : "ui-template-app-shell"} data-embedded={embedded || undefined}>
      <SidebarLayout
        embedded={embedded}
        variant={variant}
        drawerBelow={drawerBelow}
        sidebar={
          <Sidebar aria-label={sidebarLabel} header={brand} footer={sidebarFooter} isResizable
            width={sidebarWidth} defaultWidth={defaultSidebarWidth} onWidthChange={onSidebarWidthChange}
            isCollapsible={isCollapsible} isCollapsed={isCollapsed} defaultCollapsed={defaultCollapsed}
            onCollapsedChange={onCollapsedChange} collapsedHeader={collapsedHeader}
            isDrawerOpen={isDrawerOpen} onDrawerOpenChange={onDrawerOpenChange} defaultDrawerOpen={defaultDrawerOpen}
            showMobileBar={showMobileBar}>
            {navigation}
          </Sidebar>
        }
      >
        <div className="ui-template-app-shell__frame" data-topbar={hasTopbar || undefined}>
          {hasTopbar ? (
            <div className="ui-template-app-shell__top">
              <div className="ui-template-app-shell__search">{search}</div>
              <div className="ui-template-app-shell__actions">
                {actions}
                {user}
              </div>
            </div>
          ) : null}
          <div className="ui-template-app-shell__content">{children}</div>
        </div>
      </SidebarLayout>
    </div>
  );
}
