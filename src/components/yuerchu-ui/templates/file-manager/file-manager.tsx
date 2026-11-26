"use client";

import type { ReactNode } from "react";
import { Pagination } from "../../components/pagination/pagination";
import "./file-manager.css";

/**
 * 文件与资源管理页模板，将标题操作栏、提示区、文件浏览器、详情侧栏和分页组合为统一布局，可用于素材库、共享目录、回收站及对外交付页等场景。
 *
 * @packageDocumentation
 * @category 应用
 * @status 实验中
 */

export interface FileManagerProps {
  /** 页面主标题，例如“版权素材库”或“素材回收站”。 */
  heading: ReactNode;
  /** 标题下方的补充说明。 */
  description?: ReactNode;
  /** 头部右侧的页面级操作区，例如新建目录、上传原片或清空回收站。 */
  actions?: ReactNode;
  /** 文件区上方的提示条，通常传入 `Alert`，用于说明清理周期或授权有效期。 */
  notice?: ReactNode;
  /** 文件浏览主体区域，通常放置 `FileExplorer`。 */
  children: ReactNode;
  /** 选中项目的详情区域，通常传入 `FileDetails`；宽屏下与文件区并排显示，窄屏下由 `FileDetails` 自动切换为对话框。 */
  details?: ReactNode;
  /** 当前页码（从 1 开始）；需同时传入大于 1 的 `totalPages` 与 `onPageChange` 才会显示分页。 */
  page?: number;
  /** 总页数。 */
  totalPages?: number;
  /** 页码切换时触发的回调。 */
  onPageChange?: (page: number) => void;
  /**
   * 页面标题的层级。
   * @default 1
   */
  headingLevel?: 1 | 2 | 3 | 4;
  /**
   * 是否以嵌入式渲染（例如放入 `AppShell` 主区或预览容器），开启后不再输出 `<main>` 地标且不占满视口高度。
   * @default false
   */
  embedded?: boolean;
  /** 附加到根元素的自定义类名。 */
  className?: string;
}

/**
 * 文件管理页模板，组合标题区、提示区、文件浏览区、分页以及并排的详情侧栏。
 */
export function FileManager({
  heading,
  description,
  actions,
  notice,
  children,
  details,
  page,
  totalPages,
  onPageChange,
  headingLevel = 1,
  embedded = false,
  className,
}: FileManagerProps) {
  const Heading = `h${headingLevel}` as "h1";
  const Main = embedded ? "div" : "main";
  const showPages = page != null && totalPages != null && totalPages > 1 && onPageChange != null;
  return (
    <div className={className ? `ui-template-file-manager ${className}` : "ui-template-file-manager"} data-embedded={embedded || undefined}>
      <Main className="ui-template-file-manager__main">
        <header className="ui-template-file-manager__header">
          <div className="ui-template-file-manager__titles">
            <Heading className="ui-template-file-manager__heading">{heading}</Heading>
            {description ? <p className="ui-template-file-manager__description">{description}</p> : null}
          </div>
          {actions ? <div className="ui-template-file-manager__actions">{actions}</div> : null}
        </header>
        {notice ? <div className="ui-template-file-manager__notice">{notice}</div> : null}
        <div className="ui-template-file-manager__body" data-has-details={details ? "" : undefined}>
          <div className="ui-template-file-manager__files">
            {children}
            {showPages ? <Pagination page={page} totalPages={totalPages} onChange={onPageChange} /> : null}
          </div>
          {details ? <div className="ui-template-file-manager__details">{details}</div> : null}
        </div>
      </Main>
    </div>
  );
}
