"use client";

import { EmojiPicker as Picker, useSkinTone, type EmojiData, type EmojiDataResolver, type SkinTone } from "frimousse";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import { useFocusRing, useHover, useLocale } from "react-aria";
import { SearchIcon } from "../../lib/icons";
import { useStrings } from "../../lib/i18n";
import { Alert } from "../alert/alert";
import { Button } from "../button/button";
import { Spinner } from "../spinner/spinner";
import { Tooltip, TooltipTrigger } from "../tooltip/tooltip";
import { loadEmojiCatalog } from "./emoji-catalog";
import { emojiGridParts, KeyboardScroll } from "./emoji-grid";
import { CustomPackPanel, PackSwitcher, trimRecent, UNICODE_PACK } from "./emoji-packs";
import type { EmojiPack, EmojiPackRecent, EmojiPickerSelection } from "./emoji-packs";
import { emojiPickerStrings } from "./emoji-picker.strings";
import "../text-field/text-field.css";
import "./emoji-picker.css";

export type { EmojiPack, EmojiPackItem, EmojiPackRecent, EmojiPickerSelection } from "./emoji-packs";

/**
 * 表情选择面板，支持按分类浏览、中英文名称与拼音搜索、肤色切换及最近使用记录，既可内嵌展示也可放入 Popover 弹层。
 *
 * @packageDocumentation
 * @category 表单
 * @status 实验中
 */

export interface EmojiPickerProps {
  /** 选中内置 Unicode 表情时触发一次，参数为包含肤色修饰符或连字序列的完整 Unicode 字符串。选中自定义条目时不触发。 */
  onSelect: (emoji: string) => void;
  /**
   * 选中任何条目时触发，参数区分 `{ kind: "unicode", emoji }` 和 `{ kind: "custom", packId, id, item }`。
   * 传了 `packs` 时用它：自定义条目没有 Unicode 字符串，`onSelect` 不会为它们触发。
   */
  onSelectItem?: (selection: EmojiPickerSelection) => void;
  /** 自定义表情包和贴图包。传入后面板顶部多一排切换按钮，每一包有自己的搜索、最近使用和图片网格。 */
  packs?: readonly EmojiPack[];
  /** 最近使用的自定义条目，按最新在前排列，最多展示 16 项并按“包 id + 条目 id”去重。不传则在当前挂载周期内自己记录。 */
  recentCustom?: readonly EmojiPackRecent[];
  /** 最近使用的表情列表，按最新在前排列，最多展示 16 项。传入时以受控列表为准，未传入时仅在当前挂载周期内记录。 */
  recentEmojis?: readonly string[];
  /** 面板的无障碍名称，同一页面存在多个表情面板时建议分别标明用途。 */
  "aria-label"?: string;
  /** 根元素附加类名。 */
  className?: string;
  /** 指向面板根元素的引用。 */
  ref?: Ref<HTMLDivElement>;
}

function recentItems(items: readonly string[]) {
  return [...new Set(items)].slice(0, 16);
}

/** 内嵌渲染时不自动抢占焦点；放入弹层时，定位、关闭时机与焦点恢复由外层 DialogTrigger 和 Popover 处理。 */
export function EmojiPicker({ onSelect, onSelectItem, packs, recentCustom, recentEmojis, ...props }: EmojiPickerProps) {
  const { locale } = useLocale();
  const language = locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  const [history, setHistory] = useState<string[]>([]);
  const [customHistory, setCustomHistory] = useState<EmojiPackRecent[]>([]);
  const [activePack, setActivePack] = useState(UNICODE_PACK);
  const [attempt, setAttempt] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useStrings(emojiPickerStrings);
  useLayoutEffect(() => {
    if (attempt > 0) searchRef.current?.focus({ preventScroll: true });
  }, [attempt]);
  const recent = recentEmojis == null ? history : recentItems(recentEmojis);
  const recentCustomItems = trimRecent(recentCustom ?? customHistory);
  const select = (emoji: string) => {
    if (recentEmojis == null) setHistory((prev) => recentItems([emoji, ...prev]));
    onSelect(emoji);
    onSelectItem?.({ kind: "unicode", emoji });
  };

  if (!packs?.length) {
    return (
      <Panel key={`${language}:${attempt}`} {...props} language={language} onSelect={select} recent={recent}
        searchRef={searchRef} onRetry={() => setAttempt((n) => n + 1)} />
    );
  }
  const pack = packs.find((p) => p.id === activePack);
  return (
    <div ref={props.ref} role="group" aria-label={props["aria-label"] ?? t.panel}
      className={props.className ? `ui-emoji-picker ${props.className}` : "ui-emoji-picker"}>
      <PackSwitcher packs={packs} active={pack ? activePack : UNICODE_PACK} onChange={setActivePack} />
      {pack ? (
        <CustomPackPanel key={pack.id} pack={pack} recent={recentCustomItems}
          onSelect={(item) => {
            if (recentCustom == null) setCustomHistory((prev) => trimRecent([{ packId: pack.id, id: item.id }, ...prev]));
            onSelectItem?.({ kind: "custom", packId: pack.id, id: item.id, item });
          }} />
      ) : (
        <Panel bare key={`${language}:${attempt}`} language={language} onSelect={select} recent={recent}
          aria-label={props["aria-label"]} searchRef={searchRef} onRetry={() => setAttempt((n) => n + 1)} />
      )}
    </div>
  );
}

interface PanelProps extends Omit<EmojiPickerProps, "recentEmojis"> {
  language: string;
  recent: readonly string[];
  onRetry: () => void;
  searchRef: Ref<HTMLInputElement>;
  /** 外层已经提供了分组和名称（有自定义包时）：这一层只负责内置表情的工具、最近使用和网格。 */
  bare?: boolean;
}

function Panel({ ref, language, onSelect, recent, onRetry, searchRef, className, "aria-label": label, bare = false }: PanelProps) {
  const t = useStrings(emojiPickerStrings);
  const viewport = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const columns = useColumns(viewport);
  const [catalog, setCatalog] = useState<EmojiData | null>(null);
  const [failed, setFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const { focusProps, isFocusVisible } = useFocusRing();
  const resolve = useCallback<EmojiDataResolver>(async (locale, { signal }) => {
    try {
      const data = await loadEmojiCatalog(locale);
      signal?.throwIfAborted();
      setCatalog(data);
      return data;
    } catch (error) {
      if (!signal?.aborted) setFailed(true);
      throw error;
    }
  }, []);
  return (
    <Picker.Root ref={ref} {...(bare ? {} : { role: "group", "aria-label": label ?? t.panel })}
      className={bare ? "ui-emoji-picker__pane" : className ? `ui-emoji-picker ${className}` : "ui-emoji-picker"}
      locale={language} columns={columns} resolveEmojiData={resolve} onEmojiSelect={(e) => onSelect(e.emoji)}
      onKeyDown={(e) => { keyboard.current = e.key.startsWith("Arrow"); }}
      onPointerOverCapture={() => { keyboard.current = false; }}
      onPointerDownCapture={() => { keyboard.current = false; }}>
      <div className="ui-emoji-picker__tools">
        <EmojiSearch ref={searchRef} viewport={viewport} onSearch={setSearching} />
        <ToneButton catalog={catalog} />
      </div>
      {recent.length > 0 && catalog && !searching ? (
        <Recent items={recent} catalog={catalog} onSelect={onSelect} />
      ) : null}
      <Picker.Viewport ref={viewport} className="ui-emoji-picker__viewport" tabIndex={0} role="region"
        aria-label={label ? `${label} · ${t.grid}` : t.grid} aria-busy={!catalog && !failed} {...focusProps} data-focus-visible={isFocusVisible || null}>
        {failed ? (
          <Alert tone="warning" heading={t.failed} shouldAnnounce
            actions={<Button variant="secondary" size="sm" onPress={onRetry}>{t.retry}</Button>} />
        ) : (
          <>
            <Picker.Loading className="ui-emoji-picker__state">
              <Spinner size="sm" aria-label={t.loading} />
            </Picker.Loading>
            <Picker.Empty className="ui-emoji-picker__state" role="status">{t.empty}</Picker.Empty>
            <Picker.List components={emojiGridParts} aria-label={t.grid} />
            <KeyboardScroll viewport={viewport} keyboard={keyboard} />
          </>
        )}
      </Picker.Viewport>
    </Picker.Root>
  );
}

function useColumns(viewport: RefObject<HTMLDivElement | null>) {
  const [columns, setColumns] = useState(8);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const size = Number.parseFloat(getComputedStyle(el).getPropertyValue("--control-lg"));
      if (size > 0 && el.clientWidth > 0) setColumns(Math.max(1, Math.floor(el.clientWidth / size)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewport]);
  return columns;
}

function EmojiSearch({ ref, viewport, onSearch }: {
  ref: Ref<HTMLInputElement>;
  viewport: RefObject<HTMLDivElement | null>;
  onSearch: (searching: boolean) => void;
}) {
  const t = useStrings(emojiPickerStrings);
  const composing = useRef(false);
  const { focusProps, isFocused, isFocusVisible } = useFocusRing({ isTextInput: true });
  const { hoverProps, isHovered } = useHover({});
  return (
    <div className="ui-text-field">
      <div className="ui-text-field__control" data-has-icon>
        <span className="ui-text-field__icon" aria-hidden="true"><SearchIcon /></span>
        <Picker.Search ref={ref} aria-label={t.search} placeholder={t.search} className="ui-input"
          {...focusProps} {...hoverProps}
          data-focused={isFocused || null} data-focus-visible={isFocusVisible || null} data-hovered={isHovered || null}
          onCompositionStart={() => { composing.current = true; }}
          onInputCapture={(e) => { if (composing.current) e.stopPropagation(); }}
          onCompositionEnd={(e) => {
            composing.current = false;
            // 组字期间浏览器照常编辑非受控 input，但不让 frimousse 筛选。提交时同步一次最终值。
            e.currentTarget.dispatchEvent(new Event("input", { bubbles: true }));
          }}
          onChange={(e) => onSearch(e.currentTarget.value.trim() !== "")}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
              e.stopPropagation(); // 留给输入法，不阻止候选窗的原生默认行为
            } else if (e.key === "Enter" && !viewport.current?.querySelector('[role="row"] [data-active]')) {
              e.preventDefault(); // 没有活动格时也不能隐式提交外层表单
            }
          }} />
      </div>
    </div>
  );
}

function ToneButton({ catalog }: { catalog: EmojiData | null }) {
  const t = useStrings(emojiPickerStrings);
  const [tone, setTone, variations] = useSkinTone();
  const next = variations[(variations.findIndex((v) => v.skinTone === tone) + 1) % variations.length]!;
  const labelOf = (value: SkinTone) => value === "none" ? t.defaultTone : catalog?.skinTones[value] ?? t.defaultTone;
  const label = t.tone({ current: labelOf(tone), next: labelOf(next.skinTone) });
  return (
    <TooltipTrigger>
      <Button variant="ghost" aria-label={label} isDisabled={!catalog} onPress={() => setTone(next.skinTone)}
        icon={<span className="ui-emoji-picker__glyph">{variations.find((v) => v.skinTone === tone)?.emoji}</span>} />
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

function Recent({ items, catalog, onSelect }: {
  items: readonly string[];
  catalog: EmojiData;
  onSelect: (glyph: string) => void;
}) {
  const t = useStrings(emojiPickerStrings);
  const names = useMemo(() => {
    const names = new Map<string, string>();
    for (const e of catalog.emojis) {
      names.set(e.emoji, e.label);
      for (const alias of e.aliases ?? []) names.set(alias, e.label);
      for (const [tone, glyph] of Object.entries(e.skins ?? {})) {
        names.set(glyph, t.variant({ label: e.label, tone: catalog.skinTones[tone as Exclude<SkinTone, "none">] }));
      }
    }
    return names;
  }, [catalog, t]);
  return (
    <div className="ui-emoji-picker__recent" role="group" aria-label={t.recent}>
      <span className="ui-emoji-picker__recent-label" aria-hidden="true">{t.recent}</span>
      {items.map((glyph) => (
        <Button key={glyph} variant="ghost" size="sm" aria-label={names.get(glyph) ?? glyph}
          onPress={() => onSelect(glyph)} icon={<span className="ui-emoji-picker__glyph">{glyph}</span>} />
      ))}
    </div>
  );
}
