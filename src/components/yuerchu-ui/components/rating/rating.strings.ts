import { defineStrings } from "../../lib/i18n";

export const ratingStrings = defineStrings(
  {
    label: "评分",
    score: ({ value, max }: { value: string; max: number }) => `${value} 分，满分 ${max} 分`,
    clear: "清除评分",
    empty: "尚未评分",
  },
  {
    label: "Rating",
    score: ({ value, max }: { value: string; max: number }) => `${value} out of ${max} stars`,
    clear: "Clear rating",
    empty: "Not rated",
  },
);
