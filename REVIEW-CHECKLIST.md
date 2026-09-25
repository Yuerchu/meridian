# Review checklist

What the stop-review reviewer (`hooks/stop-review`, via the `meridian-plan-gate`
plugin) reads before judging a diff in this repository. Each item is a
convention a machine cannot check — everything a selector *can* see is in
`eslint.config.js` and `scripts/eslint-rules/`, and does not need to be here.
Items marked **major** block; unmarked items are minor and do not.

Only judge files the diff touches. Do not restate an item the lint already
enforces (palette colours, HeroUI token names, Tailwind type sizes and bare
weights, icon-only controls without a name, native `label`/`kbd`/`input`,
`onClick`/`disabled` on Button, a base prop dropped as `_x`, an `animate-*`
with no keyframes, alpha status fills, a Button `variant` switched by a
condition to show selection, a `bg-background-*` fill on a text field, an
English `aria-label` literal, fallback or prop default, `touch-hitbox` on an
element that also carries a position utility).

## Frontend (`src/**/*.tsx`)

BoardUI's published rules are this repository's constitution: the skill under
`.claude/skills/boardui/` (SKILL.md, references/motion.md, theming.md,
patterns.md, components.md) and the registry's `docs/agent-rules.md`. Where a
convention here and BoardUI disagree, BoardUI wins; where BoardUI's documents
and its own source disagree, the documents win. Items below are the parts of
those rules no selector can see, plus this app's own architecture.

- **major** A lookalike of a component the registry ships (`npx boardui list`,
  components.md). Install it (`npx boardui add -d src <name>`) instead. Inside
  the app, a base component standing in for another counts too: a row of
  `Button`s toggling `variant` to show selection is `Tabs` or
  `SegmentedControl`; a column of `w-full justify-start` Buttons is a list or
  `Dropdown`; a `<div>` painted like a message box is `Alert`. The tell is a
  `className` that fights the component's own height, padding or radius.
- **major** A field in the registry's tertiary well, or a `Switch`, placed on
  a `background-primary-default` surface (a card, a menu, `Sidebar.Main`). In
  the dark theme the tertiary well and the off track are that same neutral-800
  and vanish; the lint only
  sees a field painted by hand and `surface-contrast.test.ts` only sees the
  tokens and `CellSwitch`, so placement is judged here. The fix is the
  official surface (`SettingsCard`'s secondary) — or, for a field, BoardUI's
  one field fill `bg-background-secondary-default` — never another repaint.
- **major** Text somebody has to read in `text-text-tertiary`: a timestamp or
  relative time, a hint or description, an empty-state line, a count or
  amount, a group heading, a meta line ("connected · 8 tools"), a secondary
  table column, a badge label. In the dark theme tertiary is neutral-600 at
  ~1.9–2.3:1; these take `text-text-secondary` (owner decision 2026-09-24).
  Tertiary stays for disabled states and marks that carry no information. The
  lint catches `placeholder:text-text-tertiary`; it cannot tell a timestamp
  from a decoration.
- **major** A vendored registry file (listed in `boardui.json`) changed for
  anything but the React Aria interaction contract, without a line in that
  item's `patches`. An "equivalent" respelling of registry code
  (`text-white` → `text-text-white`) is a change too: two spellings of one
  value are two sources of truth. `pnpm boardui:drift` shows what differs.
- **major** A settings-tree file using a viewport breakpoint (`sm:`, `md:`,
  `lg:`). Width there is asked of the container: `@container/pane` queries, or
  `useIsNarrow` when what is *rendered* changes.
- **major** A radius off BoardUI's ladder, or a child rounder than the container
  that clips it: cards and panels `rounded-3xl` (settings cards follow the
  registry's settings-rows at `rounded-2xl`), menus and popovers `rounded-2xl`,
  modals `rounded-3xl`, inputs and menu rows `rounded-md`…`rounded-xl`, pills
  and icon buttons `rounded-full`.
- **major** The accent ramp used as a hover wash or a highlight: in BoardUI it
  is the CTA and selection colour. Neutral surfaces take the
  `background-*` hover steps. An icon-only control is `variant="neutral"`
  (the registry's grey round button), not `ghost`, which is BoardUI's
  accent-tinted soft button.
- **major** Motion that is not one of the recipes in motion.md: overlays use
  `components/base/overlay-motion.ts` (popovers 150ms, tooltips 200ms, modals
  300ms), hover colour changes are `transition-colors duration-150`, press
  feedback is a colour step and never a scale, and every keyframe animation has
  a reduced-motion guard.
- **major** A text-only status (`text-status-success` "saved",
  `text-status-danger` error line) with no `role="status"` / `role="alert"`, when
  the repository already has `SavedHint` and `Alert` for exactly that.
- **major** A composite text utility chosen for its size while the element's
  role says otherwise (theming.md's type table: title-1 page titles, title-2
  section headings, title-3 card titles, body default UI text, caption labels).
  The family is the role, the suffix is the weight.
- **major** A font family named anywhere but `src/styles/fonts.css`. theme.css
  reads `--font-inter` and `--font-mono-source`; fonts.css defines them and
  `src/styles/fonts.test.ts` holds the chain together.
- **major** An icon from anywhere but `@keyline-icons/react/two-tone` (or
  `/fill` for a solid glyph by meaning, like stop or a starred item). Brand
  marks and file-type icons are content, not icons, and are exempt.
- **major** A new tool (Rust `Tool`, QQ tool, or a Claude Code tool a hosted
  session can call) without an entry in `src/lib/tool-renderers.ts` choosing
  how its arguments and result are drawn, or an entry that is `structured` /
  `text` where a dedicated view exists (a diff, a file, a command, a list).
  `tool-renderers.test.ts` catches the missing name; whether the choice is the
  intuitive one is judged here. JSON source on screen is never the answer.
- **major** A savable form rendered before its load succeeded. It may render
  only from what the backend answered; a failed load shows an error state
  (Alert + retry) and no Save, and every load — a single call or a
  `Promise.all` — has a `catch`. The lint (`no-default-on-load-failure`,
  `no-parse-or-default`) sees a default *written* on failure; judged here is
  the shape it cannot see: a `useState(DEFAULTS)` initial value drawn as the
  stored settings because nothing set a loaded/error flag (auto-review and
  general settings, 2026-09), or an uncaught `Promise.all` that leaves the
  page looking like a new, empty form (model page).
- **major** An unknown fact about a model, provider or limit (a window, an
  output ceiling, a price, a timeout, a size) given a value in a shape the
  lint cannot see. `no-invented-domain-default` sees `??` / `||` / default
  parameters on names in its vocabulary; judged here: a literal in initial
  state or an object (`useState(128000)`, `{ contextLimit: 128000 }`), a
  ternary (`x == null ? 4096 : x`), a value derived from an unknown input
  (a threshold computed with the output ceiling read as 0), and an unknown
  drawn as `0` or as nothing rather than as unknown with its own i18n text.
- A first-load placeholder narrower or shorter than what replaces it, or a
  skeleton drawn on refresh rather than first load.

## Rust (`src-tauri/**`)

- **major** A tauri import below `src-tauri/src` (it is a crate boundary now and
  fails to build, but a path-dependency change can reopen it).
- **major** A persistence row crossing IPC, or a JSON column exposed as a string
  (see "Hard model and protocol standards" in CLAUDE.md; `pnpm contracts:check`
  covers the naming but not a new command that skips the DTO).
- **major** `f64` / `f32` / `REAL` / `parseFloat` near money.
- **major** A cost computed anywhere but `agent::pricing`.
- **major** A number standing in for an unknown fact where
  `check-rust-invented-default` cannot see it: a field literal on an insert or
  a seed (`context_limit: 128000` outranks every model's own window), a
  migration `DEFAULT`, a `match … { None => 4096 }`, or an `unwrap_or` on a name
  outside its vocabulary. Unknown is `None`, refused with `ok_or_else(…)?` or
  carried to where it is shown as unknown; a `// domain-default:` annotation
  needs a reason that is about this app's own policy, not about a model.
- **major** A log line carrying a message body, prompt or tool output.
- `debug!` where `info!` was used for something that is not a user-visible
  state change or a failure.
