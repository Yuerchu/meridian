import { defineStrings } from "../../lib/i18n";

export const kanbanStrings = defineStrings(
  {
    board: "看板",
    count: (v: { number: string; count: number }) => `${v.number} 张卡片`,
    empty: "尚无卡片，可拖到此处",
    emptyReadOnly: "尚无卡片",
    append: (v: { column: string }) => `追加到${v.column}列末`,
    folded: "拖到列末",
    move: "移动",
    moveCard: (v: { card: string }) => `移动${v.card}`,
    up: "上移一位",
    down: "下移一位",
    to: (v: { column: string }) => `移到${v.column}`,
    moved: (v: { column: string; position: string }) => `已移到 ${v.column}，第 ${v.position} 个`,
  },
  {
    board: "Board",
    count: (v: { number: string; count: number }) => `${v.number} ${v.count === 1 ? "card" : "cards"}`,
    empty: "No cards yet. Drop a card here.",
    emptyReadOnly: "No cards yet.",
    append: (v: { column: string }) => `Append to ${v.column}`,
    folded: "Drop at end",
    move: "Move",
    moveCard: (v: { card: string }) => `Move ${v.card}`,
    up: "Move up one place",
    down: "Move down one place",
    to: (v: { column: string }) => `Move to ${v.column}`,
    moved: (v: { column: string; position: string }) => `Moved to ${v.column}, position ${v.position}`,
  },
);
