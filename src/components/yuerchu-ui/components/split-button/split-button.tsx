"use client";

import type { ReactNode, Ref } from "react";
import { useRef } from "react";
import { mergeRefs } from "react-aria";
import type { Key } from "react-aria-components";
import { Group } from "react-aria-components";
import { withUiClass } from "../../lib/class-name";
import { useStrings } from "../../lib/i18n";
import { ChevronDownIcon } from "../../lib/icons";
import type { ButtonProps } from "../button/button";
import { Button } from "../button/button";
import type { MenuProps } from "../menu/menu";
import { Menu, MenuTrigger } from "../menu/menu";
import { Popover } from "../popover/popover";
import { splitButtonStrings } from "./split-button.strings";
import "./split-button.css";

/**
 * 将一个默认主操作与一组次要变体操作合并为拆分按钮，例如“发布”配合“定时发布 / 保存草稿”或“批准并开始”配合多种执行方式。
 * 多个平级关联按钮请使用 ButtonGroup；没有默认主操作时直接用 Button 搭配 Menu。
 *
 * @packageDocumentation
 * @category 操作
 * @status 实验中
 */

export interface SplitButtonProps {
  /** 左侧主按钮文案，建议使用动词短语明确默认操作，例如“发布”或“保存”。 */
  children: ReactNode;
  /** 左侧主按钮文字前的图标。 */
  icon?: ReactNode;
  /** 点击左侧主按钮时触发。 */
  onPress?: ButtonProps["onPress"];
  /** 下拉菜单内容，传入一组 `MenuItem`（可配合 `MenuSection` 和 `MenuSeparator`）。 */
  menu: ReactNode;
  /** 选中菜单项时的统一回调；也可在单个 `MenuItem` 上分别传入 `onAction`。 */
  onAction?: (key: Key) => void;
  /** 菜单中需要禁用的项 key 集合。 */
  disabledKeys?: Iterable<Key>;
  /**
   * 菜单弹出方向，视口空间不足时会自动翻转。
   * @default "bottom end"
   */
  placement?: MenuProps<object>["placement"];
  /**
   * 按钮外观。`primary` 使用 Ink 强调当前区域最主要的操作；`secondary` 带边框用于常规操作。
   * @default "primary"
   */
  variant?: "primary" | "secondary";
  /**
   * 按钮尺寸，对应 `--control-sm`、`--control-md` 和 `--control-lg` 高度。
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** 左侧主按钮是否处于等待状态；等待期间会同时禁用右侧下拉按钮，避免在提交途中发起另一项操作。 */
  isPending?: boolean;
  /** 禁用整个拆分按钮，含主按钮与下拉菜单。 */
  isDisabled?: boolean;
  /** 仅禁用右侧下拉菜单触发按钮，左侧主按钮仍可点击。 */
  isMenuDisabled?: boolean;
  /** 右侧下拉触发按钮和菜单的无障碍名称，未传入时使用内置文案（“更多选项” / “More options”）。 */
  menuLabel?: string;
  /** 读屏器播报的分组名称；未传入且 `children` 为字符串时默认沿用主按钮文案。 */
  "aria-label"?: string;
  /** 使用页面已有文字作为分组名称时传入对应元素 id。 */
  "aria-labelledby"?: string;
  /** 菜单打开状态变化回调。 */
  onOpenChange?: (isOpen: boolean) => void;
  /** 附加到根元素的自定义 CSS 类名。 */
  className?: string;
  /** 指向根部 `div` 元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 基于 React Aria Group、Button、MenuTrigger 与 Popover 实现。
 * 弹层以整个拆分按钮为定位锚点对齐宽度，展开时右侧触发区切换为深色并翻转指示箭头。
 *
 * @promote onPress, variant, size, isPending, isDisabled, placement
 */
export function SplitButton({
  children,
  icon,
  onPress,
  menu,
  onAction,
  disabledKeys,
  placement = "bottom end",
  variant = "primary",
  size = "md",
  isPending,
  isDisabled,
  isMenuDisabled,
  menuLabel,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  onOpenChange,
  className,
  ref,
}: SplitButtonProps) {
  const t = useStrings(splitButtonStrings);
  const groupRef = useRef<HTMLDivElement>(null);
  const resolvedMenuLabel = menuLabel ?? t.moreOptions;
  const resolvedGroupLabel = ariaLabel ?? (ariaLabelledby ? undefined : typeof children === "string" ? children : resolvedMenuLabel);

  return (
    <Group
      ref={mergeRefs(groupRef, ref)}
      isDisabled={isDisabled}
      aria-label={resolvedGroupLabel}
      aria-labelledby={ariaLabelledby}
      className={withUiClass("ui-split-button", className)}
      data-variant={variant}
      data-size={size}
    >
      <Button
        variant={variant}
        size={size}
        icon={icon}
        isPending={isPending}
        isDisabled={isDisabled}
        onPress={onPress}
        className="ui-split-button__action"
      >
        {children}
      </Button>
      <MenuTrigger onOpenChange={onOpenChange}>
        <Button
          variant={variant}
          size={size}
          icon={<ChevronDownIcon className="ui-split-button__chevron" />}
          aria-label={resolvedMenuLabel}
          isDisabled={isDisabled || isMenuDisabled || isPending}
          className="ui-split-button__trigger"
        />
        <Popover triggerRef={groupRef} placement={placement} className="ui-menu__popover">
          <Menu
            variant="inline"
            aria-label={resolvedMenuLabel}
            onAction={onAction ? (key) => onAction(key) : undefined}
            disabledKeys={disabledKeys}
          >
            {menu}
          </Menu>
        </Popover>
      </MenuTrigger>
    </Group>
  );
}
