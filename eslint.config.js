import { existsSync, readFileSync } from 'node:fs'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import meridianUi from './scripts/eslint-rules/index.mjs'

// The machine-checkable half of BoardUI's design rules (docs/agent-rules.md in
// the registry), which are this project's constitution. A gate that fires on
// the registry's own source is a gate from somewhere else and does not belong
// here. The one whitelisted exception (gold-star text-amber-500) uses an
// eslint-disable comment at the call site so it stays visible.
//
// These rules govern code written here. Files installed from the registry are
// kept as the registry wrote them (see VENDORED below) and are not rewritten
// into "equivalent" spellings: two spellings of one colour is two sources of
// truth.
const PALETTE_PREFIX = '(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret)'
const PALETTE_RE = `(?<![\\w-])${PALETTE_PREFIX}-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}|(?:white|black)\\b)`

// A class that is wrong wherever it appears: matched in string literals and in
// template chunks alike, so `cn()` arguments and template classNames both see
// it. `\\b` keeps `rounded` from matching `rounded-lg`.
function forbiddenClass(re, message) {
  return [
    { selector: `Literal[value=/${re}/]`, message },
    { selector: `TemplateElement[value.raw=/${re}/]`, message },
  ]
}

// HeroUI's token vocabulary, which `styles/tokens.css` used to bridge. Every
// name here has a boardui or meridian.css spelling (see the table in the
// commit that removed the bridge); the utilities below now resolve to nothing.
const LEGACY_TOKEN_RE = `(?<![\\w-])${PALETTE_PREFIX}-(?:muted|foreground|surface(?:-secondary|-tertiary|-foreground)?|overlay(?:-foreground)?|default(?:-foreground|-soft)?|field(?:-border)?|separator|focus|link|accent(?:-foreground|-soft(?:-foreground|-hover)?)?|(?:danger|warning|success|info)(?:-foreground|-soft(?:-foreground|-hover)?)?)(?![\\w-])|\\bshadow-(?:surface|overlay)\\b|(?<![\\w-])border-border(?![\\w-])`

// Enforced everywhere, including src/components/ui/. Each entry is a shape the
// 2026-09 design audit found in the tree, with the replacement in the message.
const styleRestrictions = [
  ...forbiddenClass(
    PALETTE_RE,
    'Raw Tailwind palette class. Use boardui tokens (text-text-*, bg-background-*, border-border-*, accent-*) or meridian.css status tokens (status-success/-warning/-danger/-info).',
  ),
  ...forbiddenClass(
    LEGACY_TOKEN_RE,
    'HeroUI token name; nothing defines it any more. text-muted → text-text-secondary, text-foreground → text-text-primary, bg-default → bg-background-secondary-default, bg-surface → bg-background-primary-default, border-border → border-border-button-default, ring-focus → ring-border-focus-ring, *-danger/-warning/-success/-info → *-status-…',
  ),
  {
    selector: 'Literal[value=/text-\\u005B[0-9.]+px\\u005D/]',
    message:
      'Arbitrary px font size. Use a boardui composite text utility (text-caption-1-*, text-body-*, text-headline-*, text-title-*), which sets size, line-height and weight together.',
  },
  // boardui's type scale is composite: `text-body-medium` is size, line-height,
  // letter-spacing and weight in one. A Tailwind size or a bare weight is the
  // scale being rebuilt by hand, and drifts from it one utility at a time.
  ...forbiddenClass(
    '(?<![\\w-])text-(?:xs|sm|base|lg|xl|2xl|3xl)(?![\\w-])',
    'Tailwind type size. Use the composite scale: text-xs → text-caption-1-*, text-sm → text-body-*, text-base → text-headline-*, text-lg → text-title-3-*, text-xl → text-title-2-*, text-2xl → text-title-1-* (weight suffix regular/medium/semibold/bold).',
  ),
  // Unprefixed only: `[&_strong]:font-medium` or `prose-headings:font-semibold`
  // reaches into markup the composite utilities cannot address.
  ...forbiddenClass(
    '(?<![\\w:\\]-])font-(?:normal|medium|semibold|bold)(?![\\w-])',
    'Bare font weight. The weight is the suffix of the composite text utility (text-body-medium, text-caption-1-semibold); pick the family the text belongs to.',
  ),
  ...forbiddenClass(
    '\\bbg-muted\\b',
    'There is no muted fill. A dot or a caret takes bg-background-tertiary-default, bg-border-button-default or bg-current.',
  ),
  ...forbiddenClass(
    '\\bshadow-(?:sm|md|lg|xl|2xl)\\b',
    'Raw Tailwind shadow-* stacks on the theme. Use shadow-xs (a resting control), shadow-card (a card) or shadow-dropdown (a popover/menu), which the theme sizes per mode.',
  ),
  ...forbiddenClass(
    '\\banimate-pulse\\b',
    'Hand-rolled animate-pulse placeholder. Use <Skeleton> from @/components/base (with role="status" + aria-busy + a label on the group); a streaming caret disables this line with a reason.',
  ),
  ...forbiddenClass(
    '\\banimate-spin(?![\\w-])',
    'Hand-rolled animate-spin icon. Use <Spinner size="sm" color="current" /> from @/components/base.',
  ),
  ...forbiddenClass(
    '\\b(?:bg|border)-status-(?:danger|warning|success|info)\\/[0-9]+',
    'Status colour at alpha is a hand-drawn soft fill. Use bg-status-*-soft / text-status-*-soft-foreground, or <Alert status="…"> for a message box.',
  ),
  {
    selector:
      "JSXOpeningElement[name.name=/Button$/] > JSXAttribute[name.name='className'] Literal[value=/(?:^|\\s)text-status-danger(?:\\s|$)/]",
    message:
      'A labelled destructive Button is variant="danger" (the registry red gradient fill), not a neutral Button painted text-status-danger by hand. An inline icon-only delete stays neutral (variant="neutral") and turns red on hover only (hover:text-status-danger) — a red pill among grey icons is louder than the action.',
  },
  {
    selector:
      "JSXOpeningElement[name.name=/Button$/] > JSXAttribute[name.name='className'] Literal[value=/\\bh-auto\\b/]",
    message:
      'h-auto on a Button is the signature of a Button standing in for something else — a list row (ListBox / Menu / SettingsRow), a chip (Chip / ToggleButtonGroup) or plain text (Link). Use that component; a genuinely multi-line button disables this line with a reason.',
  },
  {
    selector:
      "JSXOpeningElement[name.name='Spinner'] > JSXAttribute[name.name='className'] Literal[value=/\\b(?:size|w|h)-[0-9]/]",
    message: 'Spinner is sized through its size prop (sm/md/lg), not className.',
  },
  {
    selector: "JSXAttribute[name.name='className'] > JSXExpressionContainer > TemplateLiteral",
    message:
      'Compose className with cx(...) from @/utils/cx rather than a template string, so undefined/false parts drop out and tailwind-merge resolves conflicts.',
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
      'A glyph is not an icon: screen readers read it as nothing or as "multiplication x", and it does not match the icon set. Use the icon library (X, Check, ArrowUp…).',
  },
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
      'Use <Label> from @/components/base (inside a <TextField> / <Checkbox> / <Switch>, which wire the association) instead of the native <label htmlFor>. An enable/disable row is <CellSwitch>.',
  },
  {
    selector: "JSXOpeningElement[name.name='kbd']",
    message: 'Use <Kbd> from @/components/base instead of the native <kbd>.',
  },
]

// Enforced everywhere, src/components/ui/ included: "components first" — the
// browser's own widgets and dialogs are UI the design system did not draw.
const nativeChromeRestrictions = [
  {
    selector: 'JSXOpeningElement[name.name=/^(?:details|summary|progress|meter|datalist|marquee)$/]',
    message: 'Native browser widget. Use the base component equivalent (Disclosure, ProgressCircle, ListBox…).',
  },
  // A bare `confirm(...)` in this codebase is the app's own `useConfirm`, which
  // is the replacement, so only `alert` and `prompt` are matched by bare name.
  {
    selector: 'CallExpression[callee.name=/^(?:alert|prompt)$/]',
    message: "The browser's own dialog. Use useConfirm / AlertDialog / Modal / a Notification instead.",
  },
  {
    selector:
      'CallExpression[callee.object.name=/^(?:window|globalThis)$/][callee.property.name=/^(?:alert|confirm|prompt)$/]',
    message: "The browser's own dialog. Use useConfirm / AlertDialog / Modal / a Notification instead.",
  },
]

// The one change this project makes to registry source: the React Aria
// interaction contract (CLAUDE.md, "The base layer's interaction contract").
// It applies to vendored files as well, because it is the reason they differ
// from the registry at all.
const racRestrictions = [
  {
    selector:
      "JSXOpeningElement[name.property.name=/^(?:Content|Control|Indicator)$/] > JSXAttribute[name.name='className'] Literal[value=/data-\\u005B?(?:selected|hovered|pressed|focus-visible|expanded)/]",
    message:
      'React Aria puts data-selected / data-hovered / data-pressed on the component root, not on its *.Content or *.Control slot — this selector never matches. Style from the root with a descendant selector.',
  },
  {
    selector: 'JSXOpeningElement[name.name=/^(?:Close)?Button$/] > JSXAttribute[name.name=/^(?:onClick|disabled)$/]',
    message:
      'Button is a React Aria button: onPress / isDisabled / isPending, not onClick / disabled. A native onClick on it bypasses press semantics (keyboard, touch, ghost clicks) and the trigger contexts (Tooltip, Menu, Dialog close) that reach it through usePress.',
  },
]

// Files installed from the registry, as `boardui.json` records them. They keep
// the registry's spelling; only the React Aria contract is enforced on them.
const VENDORED = existsSync(new URL('./boardui.json', import.meta.url))
  ? Object.values(JSON.parse(readFileSync(new URL('./boardui.json', import.meta.url), 'utf8')).items)
      .flatMap((item) => item.files)
      // The manifest lists the registry's stylesheets too; a `files` glob that
      // matches a .css file makes ESLint try to parse it as JavaScript.
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
  : []

// For scripts/eslint-rules.test.mjs, which pins every selector to the shape it
// was written for.
export const uiRestrictions = {
  style: [...styleRestrictions, ...racRestrictions, ...nativeChromeRestrictions],
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
  // The UI conventions that need to see more than one node, or a stylesheet:
  // the local plugin under scripts/eslint-rules/.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/components/foundations/**', ...VENDORED],
    rules: {
      'meridian-ui/icon-only-needs-name': 'error',
      // Recurrence gates (surface-contrast.test.ts is the other half): a field
      // keeps the registry fill, and a Button variant is not a selected state.
      'meridian-ui/field-fill-follows-surface': 'error',
      'meridian-ui/no-variant-as-state': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'meridian-ui/animation-needs-keyframes': 'error',
    },
  },
  // The base layer: a prop it accepts, it honours.
  {
    files: ['src/components/base/**/*.tsx'],
    rules: {
      'meridian-ui/no-silent-prop-drop': 'error',
    },
  },
  // BoardUI's rules. Three config blocks because flat config REPLACES a rule
  // wholesale when a later block redefines it: each block carries the full set
  // it means.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/foundations/**'],
    rules: {
      'no-restricted-syntax': ['error', ...styleRestrictions, ...racRestrictions, ...nativeChromeRestrictions],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/components/base/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...styleRestrictions,
        ...racRestrictions,
        ...nativeChromeRestrictions,
        ...nativeElementRestrictions,
      ],
    },
  },
  ...(VENDORED.length > 0
    ? [
        {
          files: VENDORED,
          rules: {
            'no-restricted-syntax': ['error', ...racRestrictions],
            // Registry files export their helpers beside their components.
            'react-refresh/only-export-components': 'off',
          },
        },
      ]
    : []),
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
