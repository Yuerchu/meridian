import { defineStrings } from "../../lib/i18n";

export const avatarStrings = defineStrings(
  {
    more: (v: { count: number }) => `还有 ${v.count} 人`,
  },
  {
    more: (v: { count: number }) => `${v.count} more`,
  },
);
