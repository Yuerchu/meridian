"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useFilter, useFocusRing } from "react-aria";
import { useStrings } from "../../lib/i18n";
import { loadPinyin, looksLikePinyin, pinyinMatches, usePinyinReady } from "../../lib/pinyin";
import { Alert } from "../alert/alert";
import { Button } from "../button/button";
import { Spinner } from "../spinner/spinner";
import { TextField } from "../text-field/text-field";
import { emojiPickerStrings } from "./emoji-picker.strings";

/** 自定义表情包里的一条：一张图片加一个名字。`id` 在包内稳定，最近使用按“包 id + 条目 id”去重。 */
export interface EmojiPackItem {
  id: string;
  /** 名称，用作可访问名称和搜索词。 */
  label: string;
  /** 额外的搜索词，例如英文名、拼音首字母。 */
  keywords?: readonly string[];
  /** 图片地址，由使用方提供（本地资源、CDN 或 data URI 均可）。 */
  src: string;
}

/** 一组自定义表情。`kind="emoji"` 是行内小图，`"sticker"` 是贴图，格子更大。 */
export interface EmojiPack {
  id: string;
  /** 包名，显示在切换按钮上，也用作网格的无障碍名称。 */
  label: string;
  /**
   * 格子形态。
   * @default "emoji"
   */
  kind?: "emoji" | "sticker";
  /** 条目列表，或首次打开这一包时才调用的加载函数；失败时显示错误和重试。 */
  items: readonly EmojiPackItem[] | (() => Promise<readonly EmojiPackItem[]>);
}

/** 选中结果：内置 Unicode 表情，或自定义包里的一条。`onSelect` 只收前者，`onSelectItem` 两种都收。 */
export type EmojiPickerSelection = { kind: "unicode"; emoji: string } | { kind: "custom"; packId: string; id: string; item: EmojiPackItem };

/** 最近使用过的自定义条目，用包 id 和条目 id 定位。 */
export interface EmojiPackRecent {
  packId: string;
  id: string;
}

export const UNICODE_PACK = "unicode";
export const recentKey = (entry: EmojiPackRecent) => `${entry.packId}:${entry.id}`;
export function trimRecent(entries: readonly EmojiPackRecent[]): EmojiPackRecent[] {
  const seen = new Set<string>();
  const result: EmojiPackRecent[] = [];
  for (const entry of entries) {
    const key = recentKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
    if (result.length === 16) break;
  }
  return result;
}

/** 按名称和关键词过滤，支持拼音（和 MentionField 同一套）。 */
export function usePackFilter() {
  const { contains } = useFilter({ sensitivity: "base" });
  const ready = usePinyinReady();
  return (item: EmojiPackItem, query: string) => {
    if (!query) return true;
    const texts = [item.label, ...(item.keywords ?? [])];
    return texts.some((text) => contains(text, query) || (ready && pinyinMatches(text, query)));
  };
}

/** 表情包的切换按钮：一组开关，不是页签（没有对应的 tabpanel），用 aria-pressed 表示当前那一包。 */
export function PackSwitcher({ packs, active, onChange }: { packs: readonly EmojiPack[]; active: string; onChange: (id: string) => void }) {
  const t = useStrings(emojiPickerStrings);
  return (
    <div className="ui-emoji-picker__packs" role="group" aria-label={t.packs}>
      <Button variant="ghost" size="sm" aria-pressed={active === UNICODE_PACK} onPress={() => onChange(UNICODE_PACK)}>
        {t.builtin}
      </Button>
      {packs.map((pack) => (
        <Button key={pack.id} variant="ghost" size="sm" aria-pressed={active === pack.id} onPress={() => onChange(pack.id)}>
          {pack.label}
        </Button>
      ))}
    </div>
  );
}

interface PackPanelProps {
  pack: EmojiPack;
  recent: readonly EmojiPackRecent[];
  onSelect: (item: EmojiPackItem) => void;
}

/** 一个自定义包：搜索、最近使用、图片网格。方向键在格子间移动，Enter 选中。 */
export function CustomPackPanel({ pack, recent, onSelect }: PackPanelProps) {
  const t = useStrings(emojiPickerStrings);
  const [items, setItems] = useState<readonly EmojiPackItem[] | null>(typeof pack.items === "function" ? null : pack.items);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const matches = usePackFilter();
  const { focusProps, isFocusVisible } = useFocusRing();

  useEffect(() => {
    let cancelled = false;
    if (typeof pack.items !== "function") {
      setItems(pack.items);
      return;
    }
    setFailed(false);
    setItems(null);
    const load = pack.items;
    load()
      .then((loaded) => { if (!cancelled) setItems(loaded); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [pack, attempt]);

  // 搜索词里出现字母时按需加载拼音字典（和内置表情一致）
  useEffect(() => {
    if (looksLikePinyin(query)) void loadPinyin();
  }, [query]);
  useLayoutEffect(() => {
    if (attempt > 0) searchRef.current?.focus({ preventScroll: true });
  }, [attempt]);

  const visible = useMemo(() => (items ?? []).filter((item) => matches(item, query.trim())), [items, matches, query]);
  const recentItems = useMemo(() => {
    const byId = new Map((items ?? []).map((item) => [item.id, item]));
    return recent.filter((entry) => entry.packId === pack.id).flatMap((entry) => {
      const item = byId.get(entry.id);
      return item ? [item] : [];
    });
  }, [items, recent, pack.id]);

  return (
    <div className="ui-emoji-picker__pane">
      <TextField ref={searchRef} aria-label={t.search} placeholder={t.search} value={query} size="sm"
        onChange={setQuery}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            viewport.current?.querySelector<HTMLButtonElement>("button[data-pack-item]")?.focus();
          } else if (e.key === "Enter") e.preventDefault();
        }} />
      {recentItems.length > 0 && !query.trim() ? (
        <div className="ui-emoji-picker__recent" role="group" aria-label={t.recent}>
          <span className="ui-emoji-picker__recent-label" aria-hidden="true">{t.recent}</span>
          {recentItems.map((item) => (
            <Button key={item.id} variant="ghost" size="sm" aria-label={item.label} onPress={() => onSelect(item)}
              icon={<img className="ui-emoji-picker__image" src={item.src} alt="" />} />
          ))}
        </div>
      ) : null}
      <div ref={viewport} className="ui-emoji-picker__viewport ui-emoji-picker__pack-viewport" tabIndex={0} role="region"
        aria-label={pack.label} aria-busy={!items && !failed} {...focusProps} data-focus-visible={isFocusVisible || null}>
        {failed ? (
          <Alert tone="warning" heading={t.failed} shouldAnnounce
            actions={<Button variant="secondary" size="sm" onPress={() => setAttempt((n) => n + 1)}>{t.retry}</Button>} />
        ) : !items ? (
          <div className="ui-emoji-picker__state"><Spinner size="sm" aria-label={t.loading} /></div>
        ) : visible.length === 0 ? (
          <div className="ui-emoji-picker__state" role="status">{t.empty}</div>
        ) : (
          <PackGrid pack={pack} items={visible} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

/** 图片网格：方向键移动（左右一格、上下一行），Enter 或空格选中；只有一个 Tab 停点。 */
function PackGrid({ pack, items, onSelect }: { pack: EmojiPack; items: readonly EmojiPackItem[]; onSelect: (item: EmojiPackItem) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const columns = pack.kind === "sticker" ? 3 : 6;
  useLayoutEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);
  const cells = () => Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("button[data-pack-item]") ?? []);
  const focusCell = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setActive(next);
    cells()[next]?.focus();
  };
  const onCellKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    if (e.key in moves) {
      e.preventDefault();
      focusCell(index + moves[e.key]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusCell(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusCell(items.length - 1);
    }
  };
  return (
    <div ref={grid} className="ui-emoji-picker__pack-grid" data-kind={pack.kind ?? "emoji"} role="group" aria-label={pack.label}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item, index) => (
        // eslint-disable-next-line ui/no-raw-interactive -- 网格的 roving tabindex 和方向键要自己管，不是普通按钮组
        <button key={item.id} type="button" data-pack-item="" className="ui-emoji-picker__cell ui-emoji-picker__pack-cell"
          data-active={index === active || undefined} aria-label={item.label} tabIndex={index === active ? 0 : -1}
          onFocus={() => setActive(index)} onClick={() => onSelect(item)} onKeyDown={(e) => onCellKeyDown(e, index)}>
          <img className="ui-emoji-picker__image" src={item.src} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}
