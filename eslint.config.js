import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// UI conventions from CLAUDE.md ("UI Conventions" section), machine-checkable
// subset. The one whitelisted exception (gold-star text-amber-500) uses an
// eslint-disable comment at the call site so it stays visible.
const PALETTE_RE =
  "(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}";

// Enforced everywhere, including src/components/ui/.
const styleRestrictions = [
  {
    selector: `Literal[value=/${PALETTE_RE}/]`,
    message: "Raw Tailwind palette class. Use theme tokens (--success/--warning/--info/--danger/...) per CLAUDE.md UI conventions.",
  },
  {
    selector: `TemplateElement[value.raw=/${PALETTE_RE}/]`,
    message: "Raw Tailwind palette class. Use theme tokens (--success/--warning/--info/--danger/...) per CLAUDE.md UI conventions.",
  },
  {
    selector: "Literal[value=/text-\\u005B[0-9.]+px\\u005D/]",
    message: "Arbitrary px font size. Use the Tailwind scale (text-xs/sm/base/lg) per CLAUDE.md UI conventions.",
  },
];

// Enforced outside src/components/ui/, which is where the components HeroUI
// has no equivalent for live and native elements are the point.
const nativeElementRestrictions = [
  {
    selector: "JSXOpeningElement[name.name='button']",
    message: "Use <Button> from @heroui/react instead of the native <button>.",
  },
  {
    selector: "JSXOpeningElement[name.name='input']",
    message: "Use <Input> (inside a <TextField>) or <Checkbox> from @heroui/react instead of the native <input>.",
  },
  {
    selector: "JSXOpeningElement[name.name='textarea']",
    message: "Use <TextArea> (inside a <TextField>) from @heroui/react instead of the native <textarea>.",
  },
  {
    selector: "JSXOpeningElement[name.name='select']",
    message: "Use <Select> from @heroui/react instead of the native <select>.",
  },
  {
    selector: "JSXOpeningElement[name.name='hr']",
    message: "Use <Separator> from @heroui/react instead of the native <hr>.",
  },
  {
    selector: "JSXOpeningElement[name.name='dialog']",
    message: "Use <AlertDialog>, <Modal> or <Drawer> from @heroui/react instead of the native <dialog>.",
  },
  {
    selector: "JSXOpeningElement[name.name=/^(?:button|Button)$/] > JSXAttribute[name.name='title']",
    message: "Native title attribute on a button. Put the text in a <Tooltip> from @heroui/react — and give the button an aria-label, since a tooltip describes rather than names it.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "**/*.test.ts", "**/*.test.tsx"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // UI conventions from CLAUDE.md, machine-checkable subset. Two config blocks
  // because flat config REPLACES a rule wholesale when a later block redefines
  // it: the non-ui block must carry the full superset of restrictions.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...styleRestrictions],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": ["error", ...styleRestrictions, ...nativeElementRestrictions],
    },
  },
  // The settings barrel imports all eleven panels, and App.tsx loads it lazily
  // so none of that reaches the main bundle. A *value* import from the barrel
  // anywhere eagerly-loaded undoes that silently — nothing breaks, the bundle
  // just grows by the whole settings tree. Type imports are erased, so they
  // stay allowed; the tab list lives in `settings/tabs` for exactly this.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/settings/**"],
    rules: {
      // The typescript-eslint version, not the base rule: only this one
      // understands `allowTypeImports`.
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [{
          name: "@/components/settings",
          allowTypeImports: true,
          message: "Value import from the settings barrel pulls the lazy settings chunk into the main bundle. Import from '@/components/settings/tabs' (or the specific panel) instead.",
        }],
      }],
    },
  },
);
