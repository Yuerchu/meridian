import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import meridianUi from './scripts/eslint-rules/index.mjs'

// UI conventions from CLAUDE.md ("UI Conventions" section), machine-checkable
// subset. The one whitelisted exception (gold-star text-amber-500) uses an
// eslint-disable comment at the call site so it stays visible.
//
// `white` and `black` are palette colours too — `text-white` on a danger fill
// is `text-danger-foreground` spelt wrong, and the 2026-09 audit found two.
const PALETTE_PREFIX = '(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret)'
const PALETTE_RE = `${PALETTE_PREFIX}-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}|(?:white|black)\\b)`

// A class that is wrong wherever it appears: matched in string literals and in
// template chunks alike, so `cn()` arguments and template classNames both see
// it. `\\b` keeps `rounded` from matching `rounded-lg`.
function forbiddenClass(re, message) {
  return [
    { selector: `Literal[value=/${re}/]`, message },
    { selector: `TemplateElement[value.raw=/${re}/]`, message },
  ]
}

// Enforced everywhere, including src/components/ui/. Each entry is a shape the
// 2026-09 design audit found in the tree, with the replacement in the message.
const styleRestrictions = [
  ...forbiddenClass(
    PALETTE_RE,
    'Raw Tailwind palette class. Use theme tokens (--success/--warning/--info/--danger/...) per CLAUDE.md UI conventions.',
  ),
  {
    selector: 'Literal[value=/text-\\u005B[0-9.]+px\\u005D/]',
    message: 'Arbitrary px font size. Use the Tailwind scale (text-xs/sm/base/lg) per CLAUDE.md UI conventions.',
  },
  ...forbiddenClass(
    '\\bcursor-pointer\\b',
    "cursor-pointer ignores the user's cursor preference. Use cursor-[var(--cursor-interactive)] on custom interactive elements; base components set it themselves.",
  ),
  ...forbiddenClass(
    '\\bbg-muted\\b',
    '--muted is secondary *text*, not a fill (see the token note in CLAUDE.md). A dot or a caret takes bg-default, bg-border or bg-current.',
  ),
  ...forbiddenClass('\\buppercase\\b', 'No ALL CAPS headings or labels; write the label in Title Case instead.'),
  ...forbiddenClass(
    '(?:^|\\s)rounded(?:\\s|$)',
    'Bare `rounded` (4px) is off the radius ladder (composer 2xl → chat/tool card xl → settings lg). Use <Chip> or the ladder step of the container.',
  ),
  ...forbiddenClass(
    '\\bshadow-(?:xs|sm|md|lg|xl|2xl)\\b',
    'Raw Tailwind shadow-* stacks on the theme. Use shadow-surface (cards) or shadow-overlay (popovers/menus), which the theme sizes per mode.',
  ),
  ...forbiddenClass(
    '\\banimate-pulse\\b',
    'Hand-rolled animate-pulse placeholder. Use <Skeleton> from @/components/base (with role="status" + aria-busy + a label on the group); a streaming caret disables this line with a reason.',
  ),
  ...forbiddenClass(
    '\\banimate-spin\\b',
    'Hand-rolled animate-spin icon. Use <Spinner size="sm" color="current" /> from @/components/base.',
  ),
  ...forbiddenClass(
    '\\b(?:bg|border)-(?:danger|warning|success|info)\\/[0-9]+',
    'Status colour at alpha is a hand-drawn soft fill. Use bg-*-soft / text-*-soft-foreground, or <Alert status="…"> for a message box.',
  ),
  {
    selector:
      "JSXOpeningElement[name.name=/Button$/] > JSXAttribute[name.name='className'] Literal[value=/(?:^|\\s)text-danger(?:\\s|$)/]",
    message:
      'A labelled destructive Button is variant="danger-soft", not ghost/outline painted text-danger by hand. An icon-only one in a row of ghost icons stays ghost and turns danger on hover (hover:text-danger) — a red pill among grey icons is louder than the action.',
  },
  {
    selector:
      "JSXOpeningElement[name.name=/Button$/] > JSXAttribute[name.name='className'] Literal[value=/\\bh-auto\\b/]",
    message:
      'h-auto on a Button is the signature of a Button standing in for something else — a list row (ListBox / Menu / SettingsRow), a chip (Chip / ToggleButtonGroup) or plain text (Link). Use that component; a genuinely multi-line button disables this line with a reason.',
  },
  {
    selector:
      "JSXOpeningElement[name.property.name=/^(?:Content|Control|Indicator)$/] > JSXAttribute[name.name='className'] Literal[value=/data-\\u005B?(?:selected|hovered|pressed|focus-visible|expanded)/]",
    message:
      'React Aria puts data-selected / data-hovered / data-pressed on the component root, not on its *.Content or *.Control slot — this selector never matches. Style from the root with a descendant selector.',
  },
  {
    selector: "JSXOpeningElement[name.name=/^(?:H)?Button$/] > JSXAttribute[name.name='onPress']",
    message:
      'Button takes onClick, not onPress (boardui uses native <button>).',
  },
  {
    selector:
      "JSXOpeningElement[name.name='Spinner'] > JSXAttribute[name.name='className'] Literal[value=/\\b(?:size|w|h)-[0-9]/]",
    message: 'Spinner is sized through its size prop (sm/md/lg), not className.',
  },
  {
    selector: "JSXAttribute[name.name='className'] > JSXExpressionContainer > TemplateLiteral",
    message:
      'Compose className with cn(...) rather than a template string, so undefined/false parts drop out and Prettier can sort it.',
  },
  {
    selector: "CallExpression[callee.property.name='replace'][callee.object.callee.name='t']",
    message: 'Do not post-process a translation with .replace(); add a separate i18n key.',
  },
  {
    // `×` is left out: as "×3" it is a count, which is typography rather than
    // an icon.
    selector: 'JSXText[value=/[✕✓✗←→↑↓]/]',
    message:
      'A glyph is not an icon: screen readers read it as nothing or as "multiplication x", and it does not match the icon set. Use the icon library (Xmark, Check, ArrowUp…).',
  },
  ...forbiddenClass(
    'max-w-\\u005B[0-9]+px\\u005D',
    'Arbitrary px max-width. Modals take size="sm|md|lg"; everything else uses the Tailwind scale (max-w-xs … max-w-3xl).',
  ),
]

// Enforced outside src/components/ui/, which is where the domain-specific
// components live and native elements are the point.
const nativeElementRestrictions = [
  {
    selector: "JSXOpeningElement[name.name='button']",
    message: 'Use <Button> from @/components/base instead of the native <button>.',
  },
  {
    selector: "JSXOpeningElement[name.name='input']",
    message: 'Use <Input> (inside a <TextField>) or <Checkbox> from @/components/base instead of the native <input>.',
  },
  {
    selector: "JSXOpeningElement[name.name='textarea']",
    message: 'Use <TextArea> (inside a <TextField>) from @/components/base instead of the native <textarea>.',
  },
  {
    selector: "JSXOpeningElement[name.name='select']",
    message: 'Use <Select> from @/components/base instead of the native <select>.',
  },
  {
    selector: "JSXOpeningElement[name.name='hr']",
    message: 'Use <Separator> from @/components/base instead of the native <hr>.',
  },
  {
    selector: "JSXOpeningElement[name.name='dialog']",
    message: 'Use <AlertDialog>, <Modal> or <Drawer> from @/components/base instead of the native <dialog>.',
  },
  {
    selector: "JSXOpeningElement[name.name='label']",
    message:
      "Use <Label> from @/components/base (inside a <TextField> / <Checkbox> / <Switch>, which wire the association) instead of the native <label htmlFor>. An enable/disable row is <CellSwitch>.",
  },
  {
    selector: "JSXOpeningElement[name.name='kbd']",
    message: 'Use <Kbd> from @/components/base instead of the native <kbd>.',
  },
  {
    selector: "JSXOpeningElement[name.name=/^(?:button|Button)$/] > JSXAttribute[name.name='title']",
    message:
      'Native title attribute on a button. Put the text in a <Tooltip> from @/components/base — and give the button an aria-label, since a tooltip describes rather than names it.',
  },
]

// Enforced everywhere, src/components/ui/ included: a native hover tooltip is
// never the point of a component, it is the browser drawing its own UI over
// ours. `iframe` keeps `title` because there it is the frame's accessible name
// and draws nothing.
const nativeChromeRestrictions = [
  {
    selector: "JSXOpeningElement[name.name=/^[a-z]/][name.name!='iframe'] > JSXAttribute[name.name='title']",
    message:
      "Native `title` draws the browser's own tooltip. Wrap the element in <Tooltip> from @/components/base (Tooltip.Trigger with `render` for a focusable element, plain Tooltip.Trigger around a span), or drop the hint.",
  },
  {
    selector: "JSXOpeningElement[name.object.name='dom'] > JSXAttribute[name.name='title']",
    message: "Native `title` on a dom.* element draws the browser's own tooltip. Use <Tooltip> from @/components/base.",
  },
  {
    selector: 'JSXOpeningElement[name.name=/^(?:details|summary|progress|meter|datalist|marquee)$/]',
    message: 'Native browser widget. Use the base component equivalent (Disclosure, ProgressCircle, ListBox…).',
  },
  // A bare `confirm(...)` in this codebase is the app's own `useConfirm`, which
  // is the replacement, so only `alert` and `prompt` are matched by bare name.
  {
    selector: 'CallExpression[callee.name=/^(?:alert|prompt)$/]',
    message: "The browser's own dialog. Use useConfirm / AlertDialog / Modal / a toast from the app instead.",
  },
  {
    selector:
      'CallExpression[callee.object.name=/^(?:window|globalThis)$/][callee.property.name=/^(?:alert|confirm|prompt)$/]',
    message: "The browser's own dialog. Use useConfirm / AlertDialog / Modal / a toast from the app instead.",
  },
]

// For scripts/eslint-rules.test.mjs, which pins every selector to the shape it
// was written for.
export const uiRestrictions = {
  style: [...styleRestrictions, ...nativeChromeRestrictions],
  nativeElements: nativeElementRestrictions,
}

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', '**/*.test.ts', '**/*.test.tsx'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'meridian-ui': meridianUi,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/components/base/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // The two UI conventions that need to see more than one node: an icon-only
  // control needs a <Tooltip> ancestor, and every intrinsic element carries
  // data-slot. Both are the local plugin under scripts/eslint-rules/.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/components/base/**', 'src/components/foundations/**'],
    rules: {
      'meridian-ui/icon-only-needs-tooltip': 'error',
      'meridian-ui/intrinsic-needs-data-slot': 'error',
    },
  },
  // UI conventions from CLAUDE.md, machine-checkable subset. Two config blocks
  // because flat config REPLACES a rule wholesale when a later block redefines
  // it: the non-ui block must carry the full superset of restrictions.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/base/**', 'src/components/foundations/**'],
    rules: {
      'no-restricted-syntax': ['error', ...styleRestrictions, ...nativeChromeRestrictions],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/components/base/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...styleRestrictions,
        ...nativeChromeRestrictions,
        ...nativeElementRestrictions,
      ],
    },
  },
  // The settings barrel imports all eleven panels, and App.tsx loads it lazily
  // so none of that reaches the main bundle. A *value* import from the barrel
  // anywhere eagerly-loaded undoes that silently — nothing breaks, the bundle
  // just grows by the whole settings tree. Type imports are erased, so they
  // stay allowed; the tab list lives in `settings/tabs` for exactly this.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/settings/**'],
    rules: {
      // The typescript-eslint version, not the base rule: only this one
      // understands `allowTypeImports`.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/components/settings',
              allowTypeImports: true,
              message:
                "Value import from the settings barrel pulls the lazy settings chunk into the main bundle. Import from '@/components/settings/tabs' (or the specific panel) instead.",
            },
          ],
        },
      ],
    },
  },
)
