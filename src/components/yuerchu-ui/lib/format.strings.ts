import { defineStrings } from "./i18n";

/** 时长的单位（中文“1 分 5 秒”，英文“1 min 5 s”）；人名列表折叠后的“另外 3 人”。 */
export const formatStrings = defineStrings(
  {
    ms: (v: { n: number }) => `${v.n} 毫秒`,
    s: (v: { n: number }) => `${v.n} 秒`,
    minSec: (v: { m: number; s: number }) => `${v.m} 分 ${v.s} 秒`,
    min: (v: { m: number }) => `${v.m} 分钟`,
    hourMin: (v: { h: number; m: number }) => `${v.h} 小时 ${v.m} 分`,
    hour: (v: { h: number }) => `${v.h} 小时`,
    others: (v: { count: number }) => `另外 ${v.count} 人`,
  },
  {
    ms: (v: { n: number }) => `${v.n} ms`,
    s: (v: { n: number }) => `${v.n} s`,
    minSec: (v: { m: number; s: number }) => `${v.m} min ${v.s} s`,
    min: (v: { m: number }) => `${v.m} min`,
    hourMin: (v: { h: number; m: number }) => `${v.h} h ${v.m} min`,
    hour: (v: { h: number }) => `${v.h} h`,
    others: (v: { count: number }) => `${v.count} ${v.count === 1 ? "other" : "others"}`,
  },
);
