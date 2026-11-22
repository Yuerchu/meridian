import { useLocale } from "react-aria";

/*
 * 组件的界面文案：每个组件一个 <名称>.strings.ts，用 defineStrings 写中文和英文两份，组件里用 useStrings 取。
 * 语言跟着 UIProvider 的 locale（React Aria 的 useLocale），和 React Aria 自带的文案、数字和日期格式同一个来源。
 *
 * 带数量、名字的句子写成函数（{ removed: (v: { name: string }) => `已移除 ${v.name}` }），不在组件里拼字符串：
 * 中文和英文的语序、复数不一样。英文的单复数在函数里按 count 判断。
 */

type Message = string | ((vars: never) => string);
type Messages = Record<string, Message>;

/** 英文表的形状和中文表一致：键一样，函数的参数一样 */
type SameShape<T extends Messages> = { [K in keyof T]: T[K] extends string ? string : T[K] };

export interface StringTable<T extends Messages> {
  "zh-CN": T;
  "en-US": SameShape<T>;
}

/** 一个组件的文案表。中文是原文，英文的键和参数必须和中文一致（类型检查保证）。 */
export function defineStrings<const T extends Messages>(zh: T, en: SameShape<T>): StringTable<T> {
  return { "zh-CN": zh, "en-US": en };
}

/** 按语言选一份：中文（zh-*）用中文，其余都用英文 */
export function pickStrings<T extends Messages>(table: StringTable<T>, locale: string): T {
  return (locale.toLowerCase().startsWith("zh") ? table["zh-CN"] : table["en-US"]) as T;
}

/** 组件里取当前语言的文案 */
export function useStrings<T extends Messages>(table: StringTable<T>): T {
  const { locale } = useLocale();
  return pickStrings(table, locale);
}

const listStrings = defineStrings({ separator: "、" }, { separator: ", " });

/** 把几项并列写出、不加“和”，如“a.txt、b.txt”/“a.txt, b.txt”。需要“沈佳、徐磊和唐宁”或“……和另外 3 人”这类带连词的格式时，改用 lib/format 的 useListFormat 或 NameList。 */
export function useJoinList() {
  const { separator } = useStrings(listStrings);
  return (items: readonly string[]) => items.join(separator);
}
