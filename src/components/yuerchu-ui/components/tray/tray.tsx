"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import "./tray.css";

/**
 * 用于承载多行列表、设置分组或单块图表内容的凹槽式布局外壳，顶部可展示标题带，底部可附带操作栏。
 *
 * @packageDocumentation
 * @category 布局
 * @status 实验中
 */

export interface TrayProps {
  /** 展示在顶部标题带中的标题内容；未传入时外壳仅保留四周凹槽边距。 */
  heading?: ReactNode;
  /**
   * 标题的语义层级，根据页面大纲结构选择。
   * @default 3
   */
  headingLevel?: 2 | 3 | 4;
  /** 紧跟标题后的次要说明文本，例如“最近 7 天”。 */
  description?: ReactNode;
  /** 标题带右侧的操作区，例如“查看全部”按钮。 */
  actions?: ReactNode;
  /** 置于内部面板下方的底栏区域，适合放置辅助说明、撤销或审批操作按钮。 */
  footer?: ReactNode;
  /** 一个或多个 `TrayPanel` 内容面板。 */
  children: ReactNode;
  /** 根元素上的类名。 */
  className?: string;
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 凹槽式布局外壳。传入 `heading` 时渲染为通过 `aria-labelledby` 关联标题的 `<section>` 区域，未传入标题时渲染为普通 `<div>` 容器。
 */
export function Tray({ heading, headingLevel = 3, description, actions, footer, children, className, ref }: TrayProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const classes = className ? `ui-tray ${className}` : "ui-tray";
  const body = (
    <>
      {heading || actions ? (
        <div className="ui-tray__header">
          {heading ? (
            <Heading id={headingId} className="ui-tray__heading">
              {heading}
              {description ? <span className="ui-tray__description">{description}</span> : null}
            </Heading>
          ) : (
            <span />
          )}
          {actions ? <div className="ui-tray__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="ui-tray__footer">{footer}</div> : null}
    </>
  );
  return heading ? (
    <section ref={ref} aria-labelledby={headingId} className={classes} data-has-header="">
      {body}
    </section>
  ) : (
    <div ref={ref as Ref<HTMLDivElement>} className={classes} data-has-header={actions ? "" : undefined}>
      {body}
    </div>
  );
}

export interface TrayPanelProps {
  /** 面板内部内容，可以是多行列表、设置条目，也可以是单块图表或表格。 */
  children: ReactNode;
  /**
   * 是否在直接子元素行间绘制分隔细线；内部仅放单张图表、表格或代码块时设为 `false`。
   * @default true
   */
  divided?: boolean;
  /** 根元素上的类名。 */
  className?: string;
}

/** 嵌入托盘外壳内部的内容面板。 */
export function TrayPanel({ children, divided = true, className }: TrayPanelProps) {
  return (
    <div className={className ? `ui-tray__panel ${className}` : "ui-tray__panel"} data-divided={divided || undefined}>
      {children}
    </div>
  );
}
