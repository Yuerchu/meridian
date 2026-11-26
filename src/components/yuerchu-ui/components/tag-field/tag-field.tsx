"use client";

import type { ReactNode, Ref } from "react";
import { useMemo, useRef, useState } from "react";
import { mergeRefs, useObjectRef } from "react-aria";
import type { Key, ValidationResult } from "react-aria-components";
import { Button as AriaButton, ComboBox as AriaComboBox, ComboBoxValue, TagGroup as AriaTagGroup, TagList } from "react-aria-components";
import { useJoinList, useStrings } from "../../lib/i18n";
import { announce } from "../../lib/announce";
import { useCompositionFilter } from "../../lib/composition-filter";
import { ChevronDownIcon } from "../../lib/icons";
import { Description, FieldError, Label } from "../field/field";
import { ListBox, ListBoxItem, ListBoxSection } from "../listbox/listbox";
import { Popover } from "../popover/popover";
import { Spinner } from "../spinner/spinner";
import { Tag } from "../tag-group/tag-group";
import { Input } from "../text-field/text-field";
import "../combo-box/combo-box.css";
import "../text-field/text-field.css";
import { tagFieldStrings } from "./tag-field.strings";
import "./tag-field.css";

/**
 * 支持多选的标签输入框，可从候选列表中选择或输入创建新标签，已选项以可移除的标签形式展示。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface TagFieldOption {
  /** 选项唯一标识（同时作为标签 id）。 */
  id: string;
  /** 选项展示文字。 */
  label: string;
  /** 分组名称，如“技术部”。当存在带分组的选项时，下拉列表按分组展示，未设置分组的归入“其他”。 */
  group?: string;
}

export interface TagFieldProps {
  /** 可见标签。未提供可见标签时必须传入 `aria-label`。 */
  label?: ReactNode;
  /** 无可见标签时使用的可访问名称。 */
  "aria-label"?: string;
  /** 输入框下方的补充说明文字。 */
  description?: ReactNode;
  /** 校验失败时显示的错误信息。 */
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 尚未选择任何标签时的占位文字。 */
  placeholder?: string;
  /** 候选项列表，默认按“包含”规则进行本地筛选。 */
  options?: TagFieldOption[];
  /** 已选中的值列表（受控），按选择顺序排列。 */
  value?: string[];
  /** 默认选中的值列表（非受控）。 */
  defaultValue?: string[];
  /** 已选值发生变化时触发。 */
  onChange?: (value: string[]) => void;
  /**
   * 是否允许创建候选项以外的新标签。开启后按 `Enter` 或输入逗号、顿号即可生成标签（粘贴“a, b, c”会自动拆分为多个）；若与已有选项忽略大小写同名，则直接选中该选项。
   */
  allowsCreate?: boolean;
  /** 最多可选择的标签数量。达到上限后其余选项禁用，辅助说明会追加显示“已选 3 / 5”。 */
  maxCount?: number;
  /**
   * 输入文本变化回调，用于异步加载候选项。传入该回调后组件不再执行本地筛选，需自行更新 `options` 并配合 `isLoading` 展示加载状态。
   */
  onInputChange?: (text: string) => void;
  /** 是否处于异步加载选项状态，为 `true` 时在输入框右侧显示加载指示器并在列表内提示“加载中…”。 */
  isLoading?: boolean;
  /**
   * 控件尺寸。
   * @default "md"
   */
  size?: "sm" | "md";
  /** 是否禁用整个控件。 */
  isDisabled?: boolean;
  /** 是否为只读状态（仅展示已选标签，不可增删）。 */
  isReadOnly?: boolean;
  /** 是否为必填项。 */
  isRequired?: boolean;
  /** 是否标记为校验失败状态（通常配合 `errorMessage` 使用）。 */
  isInvalid?: boolean;
  /** 表单字段名，提交时每个已选值对应一项。 */
  name?: string;
  /** 指向底层 `input` 元素的引用。 */
  ref?: Ref<HTMLInputElement>;
  /** 附加到根元素的自定义类名。 */
  className?: string;
}

interface TagFieldSection {
  id: string;
  name: string;
  children: TagFieldOption[];
}

const SEPARATORS = /[,，、;；\n]/;

/**
 * 多选标签输入框，基于 React Aria ComboBox（多选模式）与 TagGroup 实现。
 * 支持输入筛选、拼音匹配、`Tab`/`←` 进入标签组编辑，以及通过 `allowsCreate` 快速新建标签。
 *
 * @promote value, onChange, options, allowsCreate, isRequired, isDisabled
 */
export function TagField({
  label,
  "aria-label": ariaLabel,
  description,
  errorMessage,
  placeholder,
  options = [],
  value: valueProp,
  defaultValue = [],
  onChange,
  allowsCreate = false,
  maxCount,
  onInputChange,
  isLoading = false,
  size = "md",
  isDisabled = false,
  isReadOnly = false,
  isRequired,
  isInvalid,
  name,
  ref,
  className,
}: TagFieldProps) {
  const t = useStrings(tagFieldStrings);
  const join = useJoinList();
  const [own, setOwn] = useState(defaultValue);
  const value = valueProp === undefined ? own : valueProp;
  const [inputValue, setInputValue] = useState("");
  const inputRef = useObjectRef<HTMLInputElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  // 下拉对齐整个框（不只是里面的输入框），宽度也跟框一样
  const controlRef = useRef<HTMLDivElement>(null);
  const { filter, inputProps } = useCompositionFilter();
  const fieldName = typeof label === "string" ? label : (ariaLabel ?? "");

  // 新建的值也放进选项（下拉里能看到、能取消）
  const items = useMemo(() => {
    const known = new Set(options.map((o) => o.id));
    return [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ id: v, label: v }))];
  }, [options, value]);
  const labelOf = (id: Key) => items.find((o) => o.id === id)?.label ?? String(id);
  // items 是受控的，React Aria 不替我们筛选（defaultFilter 只对 defaultItems 生效）；异步时由使用方筛
  const shown = onInputChange ? items : items.filter((o) => filter(o.label, inputValue));
  const full = maxCount !== undefined && value.length >= maxCount;
  // 有分组时按分组排成几段（没写分组的放最后）
  const grouped = shown.some((o) => (o as TagFieldOption).group);
  const sections = grouped
    ? [...new Set(shown.map((o) => (o as TagFieldOption).group ?? ""))].map((g) => ({ id: `group:${g}`, name: g || t.other, children: shown.filter((o) => ((o as TagFieldOption).group ?? "") === g) }))
    : [];

  const set = (next: string[]) => {
    if (valueProp === undefined) setOwn(next);
    onChange?.(next);
  };
  const remove = (ids: Iterable<Key>) => {
    const gone = new Set([...ids].map(String));
    set(value.filter((v) => !gone.has(v)));
    announce(t.removed({ names: join([...gone].map(labelOf)) }));
  };
  /** 把输入的文字变成标签：和已有选项同名时选那个选项 */
  const create = (texts: string[]) => {
    const next = [...value];
    for (const raw of texts) {
      if (maxCount !== undefined && next.length >= maxCount) {
        announce(t.max({ count: maxCount }));
        break;
      }
      const text = raw.trim();
      if (!text) continue;
      const match = items.find((o) => o.label.toLocaleLowerCase() === text.toLocaleLowerCase());
      const id = match?.id ?? text;
      if (!next.includes(id)) next.push(id);
    }
    if (next.length !== value.length) {
      set(next);
      announce(t.added({ names: join(next.slice(value.length).map(labelOf)) }));
    }
  };

  const handleInput = (text: string) => {
    // 逗号、顿号分隔（包括粘贴一串）：分隔符前面的部分变成标签
    if (allowsCreate && SEPARATORS.test(text)) {
      const parts = text.split(SEPARATORS);
      create(parts.slice(0, -1));
      setInputValue(parts.at(-1) ?? "");
      return;
    }
    setInputValue(text);
    onInputChange?.(text);
  };

  return (
    <AriaComboBox<TagFieldOption | TagFieldSection, "multiple">
      selectionMode="multiple"
      value={value}
      onChange={(keys) => {
        const next = (keys as Key[]).map(String);
        const added = next.filter((k) => !value.includes(k));
        const removed = value.filter((k) => !next.includes(k));
        // React Aria 按 Enter 时没有选中项也会回调一次（值没变）：忽略，交给下面的新建逻辑
        if (!added.length && !removed.length) return;
        set(next);
        if (added.length) announce(t.added({ names: join(added.map(labelOf)) }));
        if (removed.length) announce(t.removed({ names: join(removed.map(labelOf)) }));
        // 选完一个清空输入，接着输入下一个
        setInputValue("");
      }}
      items={grouped ? sections : shown}
      disabledKeys={full ? items.filter((o) => !value.includes(o.id)).map((o) => o.id) : undefined}
      inputValue={inputValue}
      onInputChange={handleInput}
      // 新建由我们处理（Enter、逗号）；交给 React Aria 的话它会在 Enter 后把输入的文字放回输入框
      allowsEmptyCollection
      defaultFilter={filter}
      aria-label={ariaLabel}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      isInvalid={isInvalid}
      name={name}
      className={className ? `ui-text-field ui-combo-box ui-tag-field ${className}` : "ui-text-field ui-combo-box ui-tag-field"}
      data-size={size}
    >
      {label ? <Label>{label}</Label> : null}
      <div ref={controlRef} className="ui-tag-field__control" data-disabled={isDisabled || undefined}>
        {/* 标签放在 ComboBoxValue 里：React Aria 收集下拉选项时会跳过它（直接放在 ComboBox 里，标签会被当成选项，id 重复） */}
        {value.length ? (
          <ComboBoxValue className="ui-tag-field__value">
            <AriaTagGroup
              ref={tagsRef}
              aria-label={t.selected({ field: fieldName })}
              onRemove={
                isDisabled || isReadOnly
                  ? undefined
                  : (keys) => {
                      remove(keys);
                      // 删掉最后一个标签后焦点回到输入框
                      if (value.length === [...keys].length) inputRef.current?.focus();
                    }
              }
              className="ui-tag-field__tags"
            >
              <TagList items={value.map((id) => ({ id, label: labelOf(id) }))} className="ui-tag-group__list">
                {(t) => <Tag id={t.id}>{t.label}</Tag>}
              </TagList>
            </AriaTagGroup>
          </ComboBoxValue>
        ) : null}
        <Input
          ref={mergeRefs(ref, inputRef)}
          placeholder={value.length ? undefined : placeholder}
          {...inputProps}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Backspace" && inputValue === "" && value.length && !isReadOnly) {
              remove([value.at(-1)!]);
            } else if (e.key === "Enter" && allowsCreate && inputValue.trim() && !full) {
              // 输入的文字和某个选项同名，或者没有匹配的选项：变成标签（同名时选中那个选项）。
              // 只是部分匹配时交给下拉（↓ 选一项再 Enter）
              const text = inputValue.trim().toLocaleLowerCase();
              if (items.some((o) => o.label.toLocaleLowerCase() === text) || shown.length === 0) {
                e.preventDefault();
                create([inputValue]);
                setInputValue("");
              }
            }
          }}
        />
        {isLoading ? <Spinner size="sm" aria-label={t.loading} /> : null}
        <AriaButton className="ui-combo-box__button">
          <ChevronDownIcon />
        </AriaButton>
      </div>
      {description || maxCount !== undefined ? (
        <Description>
          {description}
          {description && maxCount !== undefined ? t.sep : null}
          {maxCount !== undefined ? t.count({ count: value.length, max: maxCount }) : null}
        </Description>
      ) : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover className="ui-combo-box__popover" triggerRef={controlRef}>
        <ListBox
          renderEmptyState={() => (
            <div className="ui-listbox__empty">{isLoading ? t.loadingList : allowsCreate && inputValue.trim() && !full ? t.create({ text: inputValue.trim() }) : t.empty}</div>
          )}
        >
          {(item: TagFieldOption | TagFieldSection) =>
            "children" in item ? (
              <ListBoxSection id={item.id} header={item.name} items={item.children}>
                {(o: TagFieldOption) => <ListBoxItem id={o.id}>{o.label}</ListBoxItem>}
              </ListBoxSection>
            ) : (
              <ListBoxItem id={item.id}>{item.label}</ListBoxItem>
            )
          }
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
