"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import type { AutocompleteProps, Key } from "react-aria-components";
import {
  Autocomplete,
  Dialog,
  Input,
  Menu as AriaMenu,
  Modal,
  ModalOverlay,
  SearchField,
} from "react-aria-components";
import { useOverlayTriggerState } from "react-stately";
import { useStrings } from "../../lib/i18n";
import { useCompositionFilter } from "../../lib/composition-filter";
import { SearchIcon } from "../../lib/icons";
import { Kbd } from "../kbd/kbd";
import { Spinner } from "../spinner/spinner";
import "../menu/menu.css";
import { commandPaletteStrings } from "./command-palette.strings";
import "./command-palette.css";

/**
 * 全局快捷指令与全站搜索面板，默认按 ⌘K 或 Ctrl+K 呼出，支持输入筛选页面与操作并回车执行。
 * 列表项使用 MenuItem 和 MenuSection 组织，复用菜单的视觉样式。
 *
 * @packageDocumentation
 * @category 弹层
 * @status 实验中
 */

export interface CommandPaletteProps {
  /** 传入 MenuItem 或 MenuSection。带有 href 的项在触发时执行跳转，其余项触发 onAction。 */
  children?: ReactNode;
  /** 选中未设置 href 的项时调用，参数为该项的 id，随后面板会自动关闭。 */
  onAction?: (key: Key) => void;
  /** 控制面板是否打开（受控）。 */
  isOpen?: boolean;
  /** 初始是否打开（非受控）。 */
  defaultOpen?: boolean;
  /** 面板打开或关闭状态变化时调用。 */
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * 全局快捷键，按下 ⌘ 或 Ctrl 加该键时切换开关；传入 false 可禁用全局快捷键，改由外部按钮控制 isOpen。
   * @default "k"
   */
  shortcut?: string | false;
  /**
   * 搜索框的占位提示文字。
   * @default "搜索页面和操作"（英文界面 "Search pages and actions"）
   */
  placeholder?: string;
  /**
   * 对话框的无障碍名称，供读屏器播报。
   * @default "命令面板"（英文界面 "Command palette"）
   */
  "aria-label"?: string;
  /** 搜索框当前输入内容（受控），通常配合 onInputChange 实现服务端搜索。 */
  inputValue?: string;
  /**
   * 搜索框输入变化时调用。传入该回调后，组件将停止本地筛选 children，改由接入方提供结果。
   */
  onInputChange?: (value: string) => void;
  /** 正在加载结果时设为 true：搜索框右侧显示加载指示器，列表为空时显示“搜索中…”而非“没有找到结果”。 */
  isLoading?: boolean;
}

/** Autocomplete 筛选时拿到的集合节点（它的 props 就是 MenuItem 的 props） */
type FilterNode = Parameters<NonNullable<AutocompleteProps<unknown>["filter"]>>[2];

/** MenuItem 上写的 keywords（拼音、英文、别名）也参与筛选 */
function keywordsOf(node: FilterNode | undefined): string[] {
  const keywords = (node?.props as { keywords?: unknown } | undefined)?.keywords;
  return Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === "string") : [];
}

/**
 * 基于 React Aria Autocomplete 与模态对话框实现。方向键移动高亮项时焦点保留在搜索框内，
 * 读屏器通过 aria-activedescendant 播报当前项；按 Esc 先清空输入，再按一次关闭并恢复原焦点。
 */
export function CommandPalette({
  children,
  onAction,
  isOpen,
  defaultOpen,
  onOpenChange,
  shortcut = "k",
  placeholder: placeholderProp,
  "aria-label": ariaLabelProp,
  inputValue,
  onInputChange,
  isLoading = false,
}: CommandPaletteProps) {
  const t = useStrings(commandPaletteStrings);
  const ariaLabel = ariaLabelProp === undefined ? t.label : ariaLabelProp;
  const placeholder = placeholderProp === undefined ? t.placeholder : placeholderProp;
  const state = useOverlayTriggerState({ isOpen, defaultOpen, onOpenChange });
  // 输入法组字时不按拼音字母筛选（见 lib/composition-filter.ts）
  const { filter, inputProps } = useCompositionFilter();

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === shortcut.toLowerCase()) {
        e.preventDefault();
        state.toggle();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut, state]);

  return (
    <ModalOverlay isOpen={state.isOpen} onOpenChange={state.setOpen} isDismissable className="ui-command-palette__overlay">
      <Modal className="ui-command-palette">
        <Dialog aria-label={ariaLabel} className="ui-command-palette__dialog">
          <Autocomplete
            inputValue={inputValue}
            onInputChange={onInputChange}
            // 服务端搜索时结果由使用方给出，不在本地再筛一遍
            filter={
              onInputChange
                ? undefined
                : (text, input, node) => filter(text, input) || keywordsOf(node).some((k) => filter(k, input))
            }
          >
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- 命令面板打开时焦点必须在搜索框里（对话框里的组合框模式） */}
            <SearchField aria-label={t.search} autoFocus className="ui-command-palette__search">
              <SearchIcon className="ui-command-palette__search-icon" />
              <Input placeholder={placeholder} className="ui-command-palette__input" {...inputProps} />
              {isLoading ? <Spinner size="sm" aria-label={t.searching} className="ui-command-palette__spinner" /> : null}
            </SearchField>
            <AriaMenu
              className="ui-menu ui-command-palette__list"
              onAction={(key) => {
                onAction?.(key);
                state.close();
              }}
              renderEmptyState={() => <div className="ui-command-palette__empty">{isLoading ? t.loading : t.empty}</div>}
            >
              {children}
            </AriaMenu>
          </Autocomplete>
          <div className="ui-command-palette__footer" aria-hidden="true">
            <span>
              <Kbd keys={["↑", "↓"]} /> {t.select}
            </span>
            <span>
              <Kbd keys={["↵"]} /> {t.open}
            </span>
            <span>
              <Kbd>Esc</Kbd> {t.close}
            </span>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
