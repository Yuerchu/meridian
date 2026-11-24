"use client";

import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { ButtonProps as AriaButtonProps, PressEvent } from "react-aria-components";
import {
  Button as AriaButton,
  CheckboxGroupContext,
  ComboBoxContext,
  NumberFieldContext,
  Provider,
  RadioGroupContext,
  SearchFieldContext,
  SelectContext,
  SliderContext,
  SwitchContext,
  TextFieldContext,
  ToggleButtonGroupContext,
} from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { ChevronRightIcon } from "../../lib/icons";
import "./settings-list.css";

/**
 * 用于设置页面的分组列表组件，每行左侧展示配置项名称与说明，右侧可放置即时生效的交互控件，也可作为整行导航按钮进入局部详情。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface SettingsGroupProps {
  /**
   * 分组标题，例如“通知”。不写时整组直接是一张卡片，适用于周围已有标题的场景——
   * 子页面标题、抽屉标题；这时再写一组标题就是重复同一句话。
   */
  heading?: ReactNode;
  /** 显示在标题下方的分组说明。 */
  description?: ReactNode;
  /**
   * 标题语义层级，根据页面结构层级调整。
   * @default 2
   */
  headingLevel?: 2 | 3 | 4;
  /** 组内包含的 SettingsRow 或 SettingsNavRow 条目。 */
  children: ReactNode;
  /** 根元素附加类名。 */
  className?: string;
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLElement>;
}

/**
 * 渲染设置分组区域，各行之间显示分隔线。写了标题时是带名称的 section，不写时是没有名称的卡片。
 *
 * @promote heading, description, headingLevel
 */
export function SettingsGroup({ heading, description, headingLevel = 2, children, className, ref }: SettingsGroupProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as "h2";
  return (
    <section
      ref={ref}
      // 没有标题就没有可指的 id；指着一个不存在的 id 是无效标注，section 也不再有名称。
      {...(heading ? { "aria-labelledby": headingId } : null)}
      className={className ? `ui-settings-group ${className}` : "ui-settings-group"}
    >
      {heading || description ? (
        <div className="ui-settings-group__header">
          {heading ? (
            <Heading id={headingId} className="ui-settings-group__heading">
              {heading}
            </Heading>
          ) : null}
          {description ? <p className="ui-settings-group__description">{description}</p> : null}
        </div>
      ) : null}
      <div className="ui-settings-group__rows">{children}</div>
    </section>
  );
}

export type SettingsRowLayout = "inline" | "stacked";

export interface SettingsRowProps {
  /** 设置项名称（例如“邮件通知”），会作为行内受支持控件的无障碍名称，控件自身无需再传入 label。 */
  label: ReactNode;
  /** 设置项补充说明，说明更改该项产生的作用，聚焦控件时随名称一并播报。 */
  description?: ReactNode;
  /**
   * 行内排版方式：`inline` 将名称与控件保持在同一首行、说明跨全宽折于下方（窄屏下输入框类控件自动换行）；`stacked` 将控件始终置底并占满全宽。
   * @default "inline"
   */
  layout?: SettingsRowLayout;
  /** 右侧交互控件，例如 Switch、Select、TextField 或 SegmentedControl。 */
  children: ReactNode;
  /** 根元素附加类名。 */
  className?: string;
  /** 指向根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 渲染单行设置项并通过 React Aria Context 将名称和说明关联至右侧交互控件（不包括 Button 与单个 Checkbox），名称与控件优先同行，长说明跨满下方整行。
 *
 * @promote label, description
 */
export function SettingsRow({ label, description, layout = "inline", children, className, ref }: SettingsRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  const a11y = { "aria-labelledby": labelId, "aria-describedby": description ? descriptionId : undefined };
  return (
    <div
      ref={ref}
      data-layout={layout}
      className={className ? `ui-settings-row ${className}` : "ui-settings-row"}
    >
      <div className="ui-settings-row__text">
        <span id={labelId} className="ui-settings-row__label">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="ui-settings-row__description">
            {description}
          </span>
        ) : null}
      </div>
      <div className="ui-settings-row__control">
        <Provider
          values={[
            [SwitchContext, a11y],
            [SelectContext, a11y],
            [ComboBoxContext, a11y],
            [TextFieldContext, a11y],
            [NumberFieldContext, a11y],
            [SearchFieldContext, a11y],
            [SliderContext, a11y],
            [RadioGroupContext, a11y],
            [CheckboxGroupContext, a11y],
            [ToggleButtonGroupContext, a11y],
          ]}
        >
          {children}
        </Provider>
      </div>
    </div>
  );
}

export interface SettingsNavRowProps {
  /** 目标页面或面板名称，同时作为按钮的无障碍名称。 */
  label: string;
  /** 显示在名称下方的补充说明，单独作为按钮的无障碍描述。 */
  description?: string;
  /** 点击打开局部详情的回调。配合 PageStack 使用时可将 event.target 传入 push，便于返回时恢复焦点。 */
  onPress: (event: PressEvent) => void;
  /** 是否禁用该导航行。 */
  isDisabled?: boolean;
  /** 标识该项是否为当前展示中的详情分支（渲染为按钮而非切换开关）。 */
  isCurrent?: boolean;
  /** 根按钮附加类名，支持 React Aria 状态函数写法。 */
  className?: AriaButtonProps["className"];
  /** 指向底层 button 元素的引用。 */
  ref?: Ref<HTMLButtonElement>;
}

/** 用于进入下一层设置或切换局部详情的整行按钮。右侧箭头仅作装饰，名称与说明仅接受文本，行内不嵌套其他交互控件。 */
export function SettingsNavRow({
  label, description, onPress, isDisabled, isCurrent, className, ref,
}: SettingsNavRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <AriaButton
      ref={ref}
      type="button"
      className={withUiClass("ui-settings-row ui-settings-nav-row", className)}
      aria-labelledby={labelId}
      {...(description ? { "aria-describedby": descriptionId } : {})}
      {...(isCurrent ? { "aria-current": "page" as const } : {})}
      isDisabled={isDisabled}
      onPress={onPress}
    >
      <span className="ui-settings-row__text">
        <span className="ui-settings-row__label" id={labelId}>{label}</span>
        {description ? <span className="ui-settings-row__description" id={descriptionId}>{description}</span> : null}
      </span>
      <ChevronRightIcon className="ui-settings-nav-row__chevron" />
    </AriaButton>
  );
}
