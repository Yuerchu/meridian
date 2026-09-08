# Review checklist

What the stop-review reviewer (`hooks/stop-review`, via the `meridian-plan-gate`
plugin) reads before judging a diff in this repository. Each item is a
convention a machine cannot check — everything a selector *can* see is in
`eslint.config.js` and `scripts/eslint-rules/`, and does not need to be here.
Items marked **major** block; unmarked items are minor and do not.

Only judge files the diff touches. Do not restate an item the lint already
enforces (palette colours, px sizes, `data-slot`, icon-only tooltips, native
`title`/`label`/`kbd`, `onClick` on Button, `animate-*`, alpha status fills).

## Frontend (`src/**/*.tsx`)

Conventions from CLAUDE.md "UI Conventions" and the HeroUI design-taste
profile, in the order they were most often broken in the 2026-09 audit.

- **major** A HeroUI component standing in for another. A row of `Button`s
  toggling `variant` to show selection is `Tabs`, `Segment` or
  `ToggleButtonGroup`; a column of `w-full justify-start` Buttons is `ListBox`
  or `Menu`; a hand-drawn pill is `Chip`; a `<div>` with `role="status"` and a
  spinner on first load is `Skeleton`; a `<div>` painted like a message box is
  `Alert`. The tell is a `className` that fights the component's own height,
  padding or radius.
- **major** A settings-tree file using a viewport breakpoint (`sm:`, `md:`,
  `lg:`). Width there is asked of the container: `@container/pane` queries, or
  `useIsNarrow` when what is *rendered* changes.
- **major** A HeroUI component inside one of our clipped containers whose
  radius exceeds the container's (composer `rounded-2xl` → chat/tool card
  `rounded-xl` → settings card `rounded-lg`). Overriding `h-*`/`px-*` on a
  Button without `rounded-*` is the usual way in; the hover fill clips at the
  corners.
- **major** A destructive action drawn as the primary CTA beside a non-destructive
  primary, or a footer with no escape action (Cancel / Skip) beside its primary.
- A labelled destructive button is `danger-soft`; an icon-only one in a row of
  ghost icons (message actions, list rows) stays `ghost` and turns danger on
  hover. A red pill among grey icons is louder than the action it stands for.
- **major** `--accent` used as a hover wash or a highlight (it is the action
  colour; the hover wash is `--default`); `warning` used for anything that is not
  a genuine caution; `danger` for a hint that is not an error.
- **major** A text-only status (`text-success` "saved", `text-danger` error
  line) with no `role="status"` / `role="alert"`, when the repository already has
  `SavedHint` and `Alert` for exactly that.
- A padding doubled between parent and child in the same direction (a
  `px-4` wrapper inside Pro's `sidebar__content`, which already pads 16px; a
  `p-3` inside a `Disclosure.Body` that already pads). The container owns it.
- A `Separator`-shaped `border-t` / `border-b` utility where the divider carries
  no meaning, or a `<Separator>` that carries its own margin. Spacing belongs to
  the parent.
- A decorative icon beside a self-explanatory label (`<Plus />` before "New"),
  or an icon-only control where a text button was available.
- A numeric display (cost, count, duration, size) without `tabular-nums`; a
  large display number without `leading-none`.
- A first-load placeholder narrower or shorter than what replaces it, or a
  skeleton drawn on refresh rather than first load.
- A `transition-*` on a high-frequency interactive row (sidebar item, list row,
  disclosure trigger); static hover changes only.
- Two visual representations of one value (a progress ring *and* "x / y MB";
  a coloured dot *and* coloured text for the same level).
- A `size="md"` or other prop set to the component's default.
- A display-only row with a `hover:` state.
- ALL CAPS headings; emoji in a heading, label or title.

## Rust (`src-tauri/**`)

- **major** A tauri import below `src-tauri/src` (it is a crate boundary now and
  fails to build, but a path-dependency change can reopen it).
- **major** A persistence row crossing IPC, or a JSON column exposed as a string
  (see "Hard model and protocol standards" in CLAUDE.md; `pnpm contracts:check`
  covers the naming but not a new command that skips the DTO).
- **major** `f64` / `f32` / `REAL` / `parseFloat` near money.
- **major** A cost computed anywhere but `agent::pricing`.
- **major** A log line carrying a message body, prompt or tool output.
- `debug!` where `info!` was used for something that is not a user-visible
  state change or a failure.
