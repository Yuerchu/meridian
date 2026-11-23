import { defineStrings } from "../../lib/i18n";

export const navListStrings = defineStrings(
  {
    expand: "展开",
    collapse: "折叠",
    expandItem: ({ name }: { name: string }) => `展开 ${name}`,
    collapseItem: ({ name }: { name: string }) => `折叠 ${name}`,
  },
  {
    expand: "Expand",
    collapse: "Collapse",
    expandItem: ({ name }: { name: string }) => `Expand ${name}`,
    collapseItem: ({ name }: { name: string }) => `Collapse ${name}`,
  },
);
