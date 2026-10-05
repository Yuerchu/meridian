---
paths:
  - "src/**/*.tsx"
  - "src/styles/**"
  - "boardui.json"
  - "eslint.config.js"
  - "scripts/eslint-rules/**"
  - "REVIEW-CHECKLIST.md"
  - "e2e/**"
---

# UI conventions

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

## UI Conventions

Built on [BoardUI](https://www.boardui.com/) source vendored under `src/components/base/` and `src/styles/`, with React Aria Components underneath every interactive primitive.

**BoardUI's published rules are the constitution.** That is the `boardui` skill (`.claude/skills/boardui/`: `SKILL.md` and `references/{components,motion,theming,patterns}.md`, installed per machine with `npx boardui@latest skill` because `.claude/` is gitignored) and the registry's `docs/agent-rules.md`. Where one of this project's older conventions disagrees with them, BoardUI wins; where BoardUI's documents disagree with BoardUI's own code, the documents win. The one case so far: `motion.md` says "BoardUI buttons never shrink on press" while the registry's `theme.css` shipped a `scale(0.98)` on `:active` — the scale is gone from the vendored `theme.css`, and that removal is recorded as a patch rather than done quietly. The rules this used to carry on its own authority — HeroUI's token names, a `data-slot` on every node, a tooltip on every icon button, no native `title`, no `uppercase`, no bare `rounded`, no px max-widths, a private cursor token — came from HeroUI and a design-taste profile of that era, not from BoardUI, and went with it. HeroUI is gone; so are the gates it justified. `REVIEW-CHECKLIST.md` is the short form of what follows.

Within that: semantic tokens only (`text-text-*`, `bg-background-*`, `border-border-*`, `accent-*`; no raw palette), the composite type scale (`text-body-medium`, never `text-sm font-medium`), `cx()` from `@/utils/cx` for class merging, the motion recipes (`components/base/overlay-motion.ts`), and BoardUI's radius ladder. `npx boardui list` is the registry. What BoardUI does not have — status colours, the two bubble fills, scrollbars, safe-area insets, sheet keyframes — is `src/styles/meridian.css`, defined against BoardUI's primitives so a rebrand reaches it and restating none of its tokens. The accent is BoardUI blue and the bubbles are deliberately not: who is speaking has its own tokens.

**Vendored means verbatim, and `boardui.json` is the ledger.** Every registry item installed here is listed there with its local files, the sha256 of the registry content at install time, and a `patches` array naming each deliberate difference with its reason. `pnpm boardui:drift` fetches every item again and reports two things: the registry moved (re-install and re-apply the patches), and what the local file differs by after both sides go through Prettier — which a reviewer checks against `patches`, line for line. A network failure is an error, not a pass. The only difference allowed without argument is the React Aria interaction contract below, because without it the file does not work in this app. Everything else needs a patch entry, and **an "equivalent" respelling is a difference too**: turning the registry's `text-white` into `text-text-white` because a local rule prefers it leaves two spellings of one value, and the next re-install silently reverts one of them. That is why the lint's style rules do not run on vendored files at all (`VENDORED` in `eslint.config.js`, read from the same manifest) — only the React Aria rules do. A gate that fires on the registry's own source is a gate from somewhere else.

**The base layer's interaction contract is React Aria's, not boardui's.** The registry's `Button` is a native `<button>`; here it renders RAC's `Button` with boardui's classes, and takes `onPress` / `isDisabled` / `isPending` / `slot`. That is not taste: every trigger primitive in this app — `TooltipTrigger`, `MenuTrigger`, `DialogTrigger`, a `Dialog`'s `slot="close"` — hands its handlers and its ref down *through context*, and only a `usePress`/`useFocusable` consumer receives them. A native button in that position looks right, type-checks, and does nothing: no tooltip, no menu, a close button that closes nothing. The same rule made `Input`/`TextArea`/`SearchField.Input` RAC inputs (a bare `<input>` inside a `TextField` is labelled by nothing), `Disclosure` a RAC disclosure, `Sidebar.Menu` a RAC `Tree`, and `Command.Dialog` a RAC `Autocomplete`. Install a registry item fresh (`npx boardui add -d src <name>`), apply the React Aria contract and nothing else, and add the item to `boardui.json`; **never `--overwrite`** an adapted file. `src/components/base/base.contract.test.tsx` asserts these behaviours against the DOM, and the `no-silent-prop-drop` lint rule reports a base prop destructured into `_x` — the two gates that would have caught the 2026-09 shells.

Pro items need a licence (`npx boardui login`), and none of them is a drop-in for what it looks like it replaces. `agent-progress` is a todo list, so its counterpart is `todo-bar`/`todo-list`, not reasoning (`ChainOfThought` has been deleted; reasoning is `thinking-block`). `composer` is worth evaluating as `composer-panel` for its shell only — `PromptInput` carries the `@`/`/`/`!` control syntax, attachments and the queue, none of which a registry composer knows. `questionnaire` can replace the `ask_user` form only after checking it item by item against what the ACP section requires of that card: `required` withholding submit, skipping one question at a time, `accepts_text` withholding the free-text box, and decline versus cancel. `web-search` is at most the body inside a tool block, never a block of its own; `agent-limits-card` is at most the content of the context gauge's popover.

What remains under `components/ui/` is Meridian-specific domain components (bubble, chat-tool, marker, etc.) that no component library covers. `AGENTS.md` deliberately carries no second copy of these rules.

- **Three token families, and the names say the layer.** `text-text-{primary,secondary,tertiary,placeholder,white}` is ink; `bg-background-{primary,secondary,tertiary}-{default,hover,active,disabled}` is fill, with `bg-background-full` the page; `border-border-button-{default,hover,active}` and `border-separator-border` are edges. The neutral hover wash is `bg-background-secondary-hover` (on a panel) or `bg-background-primary-hover` (on a card). Status is `status-{success,warning,danger,info}` with `-soft` (fill) and `-soft-foreground` (text on a light panel), from `meridian.css`. The accent ramp is the call to action and the selection colour, never a hover wash or a highlight. The lint still reports the HeroUI-era token spellings (`text-muted`, `bg-default`, `bg-surface`, `border-border`, `*-danger`) — not as a HeroUI convention but because each of them used to resolve to something and now resolves to nothing, silently.
- **Text somebody reads is `text-text-secondary`, never tertiary — a deliberate deviation from BoardUI's look.** In the dark theme `text-tertiary` is neutral-600: 1.9:1 on a card, 2.3:1 on the secondary panel (2.4–2.6:1 in light). So timestamps, placeholders, hints and descriptions, counts, group headings, meta lines and badge labels take secondary (3.2–4.7:1 on every surface, both themes); tertiary stays for disabled states and marks that carry nothing. The owner chose this over changing the official token (2026-09-24); the vendored files it touched say so in `boardui.json`'s `patches`. `surface-contrast.test.ts` pins both ratios, the lint refuses `placeholder:text-text-tertiary`, and `REVIEW-CHECKLIST.md` covers what a selector cannot recognise.
- **A card in the transcript carries its own edge, because the transcript is itself `background-primary`.** `Sidebar.Main` is the white frame panel, so a `bg-background-primary-default` card is exactly its parent's colour rather than one step above the page, and a shadow alone does not separate them in dark mode. `CHAT_TOOL_CARD` adds `ring-1 ring-border-button-default ring-inset` and the status variants recolour that same ring — a second edge beside the first is what a border would have cost. The transcript no longer draws tools as cards (see the next entry); the card is `ChatTool`'s `card` presentation, kept for the playground and for anything outside a bubble.

- **The transcript is bubbles, and a tool call is one of them.** Drawn the way a messenger draws a chat: the person's bubbles on the right, the model's on the left in runs with one avatar — and each call it made in the same shell as the prose it made them for, a block in the same bubble taking the same fill, the same radius and the same corner treatment. A tool is something the assistant *did* while it was talking, so it is drawn as another thing it said. There is no collapsed "worked for 3s" header any more; nothing in a turn is folded away, only the details are shut. Five things about it are not the obvious reading.

  **Grouping is a projection, not a container.** `lib/message-groups.ts` cuts a turn into `BubbleModel`s — one per run of prose, with the reasoning before it and the calls after it, a `tools-only` bubble for a row that never got to prose, and a sticker outside the corner treatment altogether — and stamps each with `position: single | first | middle | last`. The components read `data-position` and nothing about their siblings. Which is also where "one row is one bubble" comes from: the engine writes one assistant row per round, prose then calls, and the bubble follows that rhythm rather than inventing one.

  **`data-bubble-block` is what a bubble styles, and one bubble has several** — `BubbleContent` for the prose, `ChatTool` in `bubble` presentation for each call, `sub-agent-group`, the `!` command's output. What each of them gets, and by which of two mechanisms, is settled by one question: **does it depend on the block's neighbours?**

  *No* — the fill, the text colour, the edge, the hover lift and the resting shadow depend only on whose bubble this is, so they travel as five inherited custom properties (`--bubble-fill`, `--bubble-ink`, `--bubble-edge`, `--bubble-lift`, `--bubble-shadow` — the person's bubble is the registry's white card with `shadow-card` on the secondary chat surface) that a variant sets and `BUBBLE_BLOCK` reads. They reach a block at any depth, and one drawn outside any bubble falls back to the assistant's. These were `[&>[data-bubble-block]]:` rules once, and a block that picked up a wrapper lost its fill without a word.

  *Yes* — the corners, which is a fact about what is above and below. Those need selectors and are the one thing requiring a block to be a **direct child**. Measured by burying a block under a wrapper in a live page: the fill survives and the tightening does not. So `Bubble` warns in development (`warnAboutBuriedBlocks`), a fold's blocks are a fragment rather than a wrapper, and the badge carries no `aria-controls` for want of anything to name.

  **The corner rules are two, each with two triggers, and `position` selects nothing on its own.** Only the speaker's side is ever tightened; the far side stays `rounded-2xl` throughout. The top corner tightens when something of the same speaker is directly above — another block in this bubble, or another bubble in this run (`data-position` is `middle` or `last`); the bottom corner when something is directly below (another block, or `first`/`middle`). Reading `data-position` in the selector is what removed the six compound variants. `~` rather than `:not(:first-child)`, because a bubble's children are not all blocks. **And there is one distance between blocks, whichever side of a bubble boundary they fall on** — `BUBBLE_RUN_GAP` (2px), read by `Bubble`, `MessageGroupBubbles`, `MessageGroupUser` and a bare `tools-only` keyboard, with a continuing question pulled up by `-mt-5.5` to the same 2px. The reader cannot see where one bubble ends, so a `gap-1` inside a bubble beside `gap-0.5` between bubbles read as random spacing; `bubble-spacing.test.tsx` fails if a stack uses another gap or a member adds a vertical margin. **Copy is aimed at a bubble, too**: the right-click menu reads which bubble was hit off `data-bubble-key` and copies that bubble's prose (`bubbleCopyText`); the footer's copy is the turn's conclusion (`turnCopyText`), never every bubble joined. Rating, regeneration and deletion act on the turn and say so in the menu ("regenerate this answer", "delete this exchange onward").

  **This replaced an inline keyboard, and what went with it is worth knowing.** Keys sat two to a row with their panels in a stack below, so a panel could not be next to its key: `ChatToolContent` portalled it into a hand-built stack node adopted at commit — to beat a React Aria effect that decides a collapsed panel's `hidden` on its first appearance — purely so Tab would not run key, panel, key, panel while the screen showed keys then panels. All of it is gone. A head and its detail are children of one element now, so DOM order *is* reading order and the Tab sequence needs nothing done to it. What it cost on screen was worse than the machinery: two objects in two nearly identical greys with a 4px gap, reading as a card inside a card beside a bubble that was neither.

  **Expansion is controlled and lives in the store** (`usePanelExpansion`, `sessions[id].expandedPanels`): open while a call runs or waits, shut once it has an outcome, the reader's own choice winning — and forgotten the moment the call comes back asking, which a sandbox escalation does after the panel may already have been closed. Controlled rather than `defaultExpanded` because the post-turn reload remounts the rows, and an uncontrolled panel used to snap shut at the reload rather than at the result. A shut block is as wide as its label and an open one takes the column (`data-[expanded]:w-full`), since a diff, a result and a decision all want the room; a block that asks for a decision takes the column either way and clamps nothing, with the description on its head row beside the path — the rule from `toolDescription` unchanged. When something above the reader shrinks in `idle`, `useHeightCompensation` puts the viewport back by exactly that much, measured with a `ResizeObserver` rather than predicted, which is what lets every panel close on its own without a hook into each one.

  **The time is in the last line, and only a paragraph can hold it.** `MarkdownContent` renders each top-level block as its own `ReactMarkdown`, so a float placed after the whole thing can only land on the line below it; the `trailer` prop is given to the *last block's* `<p>` and floated inside it, with `flow-root` so the bubble's padding wraps it. After a code block, a table or a list it goes on a line of its own. Never while streaming: the cursor owns that spot.

  **The avatar is at the bottom of the run and sticky.** A messenger's placement, kept honest for a page-long answer by `sticky bottom-2` — it rides the viewport up the run instead of floating in the middle of the text, which was the objection to bottom placement before. It has to be a direct flex child of the group row: a sticky element travels the height of its parent — and the footer has to be *outside* that row, under it, or the avatar sits beside the footer rather than beside the last bubble (it did, even while the footer was invisible). The footer is the message actions and nothing else: duration, tokens and cost are sections of rows in the turn-details popover behind its info action (`chat/turn-info.tsx`), so a new figure — time to first token — is one more row there rather than one more thing printed beside every answer. The bubble fills are tokens of their own (`--bubble-user`, `--bubble-assistant`) rather than the accent or a neutral fill written at the call site, because who is speaking is a first-class decision even where it shares a value with the action colour. In the dark theme the assistant's fill is one step lighter than the panel (`neutral-700` on boardui's `neutral-800`): the two used to share a value, and a bubble the colour of its background is no bubble. Anything drawn *on* a bubble that has to stand off it — the fold badge, inline code — is a wash of `--bubble-ink` over `--bubble-fill` rather than a surface token, since a surface token cannot know which bubble it is in; `background-secondary` was a dark hole in the assistant's bubble in one theme and its exact colour in the other.
  **A finished read, search or command is a badge, not a block — and nothing of it is in the DOM until the badge is opened.** `foldKindOf` in `lib/message-groups.ts` is the whole rule: `completed` *and* one of the low-risk names (`run_command`/`Bash`, `read_file`/`Read`, the search and listing tools). Anything waiting, running, refused, failed or cut off stays a block, because each of those is something to look at or act on; writes and `web_search` stay blocks whatever their state. The badges sit on the bubble's last line with the time at the other end (`bubble-fold-row`), in a fixed order — commands, files, searches — and "viewed N files" counts distinct paths, not reads. Opening one draws that kind's calls as ordinary blocks of the same bubble; there is no panel around them, because a wrapper would take their fill and their corners (see `data-bubble-block` above), and for the same reason the badge carries `aria-expanded` alone. The choice lives in `expandedPanels` under `fold:<kind>:<first call id>` for the same reason a panel's does.

  Folding is the *only* thing here that reduces the DOM, and hiding is not folding: a closed disclosure panel is `hidden="until-found"` and still holds its highlighted file, so sixty closed `read_file` panels are sixty highlighted files — which is what made a research turn stop scrolling, and what `LazyTurn` cannot help with inside one turn. The test that pins it asserts the result text is absent before the badge is pressed; rendering the fold panels unconditionally turns it red.

  **A row that was nothing but folded calls joins the bubble before it**, when that bubble has no blocks of its own — the reads were made after that prose, and badges sit above the blocks, so folding them into a bubble that already has one would draw them above a call they were made after. With no such bubble it stands as a `summary` bubble: badges and a time, taking the run's corners like any other.

  **A block's detail is the lower half of the same block, and what it shows is parsed out of a string.** `ChatToolContent` in `bubble` presentation carries no fill, no radius and no ring: the block above it has all three, and the detail is separated from the head by one rule (`not-[[hidden]]:border-t`, conditional because a collapsed React Aria panel is a zero-height box rather than nothing, and an unconditional border would be a hairline under every shut block). One edge around both halves, which is the whole of what "a tool call is a message" buys. The sections compose `ChatToolPanelHeader` / `ChatToolPanelBody` / `ChatToolPanelFooter`, plain `div`s with padding. The decision row *portals* into the footer (`ChatToolFooterSlot`): `PendingApproval` renders it deep under the notice and the reason field it belongs with, so the footer is a node made before the first render, occupied by whoever mounts into it, and drawn only then.

  Every tool result is one string with no markers — `run_command`'s stdout, stderr and exit code are already joined by `formatted()`, a sub-agent's verdict is a sentence in front of its report — so `lib/tool-output.ts` matches the backend's exact templates and passes through whatever matches none of them. `splitTruncation` runs first because the turn-level cut wraps the rest. An absent `[exit code:` is `null`, not `0`: the backend writes it only when non-zero and a hosted `Bash` never does. `glob` gets its own parser because its output has never had `:line:` in it; parsed as a search it fell through to raw text every time.

  **A tool call is drawn, never dumped, and a new tool is registered before it ships.** `lib/tool-catalog.ts` decides per tool how its arguments (`fields` / `diff` / `command` / its own block) and its result (the `tool-output.ts` parsers, `markdown`, `text`, `structured`) are drawn, together with every other per-tool decision the front end makes (identifying argument, fold, read-only, interactive, question, diff, touched files, own block); the consumers derive from it and spell no tool names of their own. `tool-catalog.test.ts` holds it to `meridian-core`'s generated `tool-catalog.json` — every native tool has an entry, every argument key it reads is in the tool's schema, every name has a label in both locales, a tool drawn as read-only or folded is one core classifies as a read — and holds hosted twins (`Read` / `read_file`, …) to agreeing with the native one or stating in `differs` why not. A comparison against a tool name anywhere else in `src` must name a tool in the table. MCP and custom tools, whose names cannot be known, get the generic renderer: `components/ui/tool-value.tsx` draws any JSON value as fields, tables, lists and tokens and MCP `content` arrays by part, and streaming arguments are read with `parsePartialObject` rather than shown as a fragment. `meridian-ui/no-json-tool-display` refuses `JSON.stringify` on the rendering path; a payload rather than a display takes a disable comment with a reason.

  **Line numbers are drawn only where somebody knows them**, and `numberDiffLines` is called with a known start or not at all: `1` for a whole-file write, the hunk headers of a unified patch, and for `edit_file` the line the bounded workspace reader found `old_string` on (`useEditLocation`) — asked only while the call is `pending`/`running`, kept by call id for the card's life, and never for a completed edit after a reload, where the file has since changed and a number read off it would be a guess wearing a gutter. A Codex-style `@@ ctx` header carries no numbers and the diff goes without. The panel header shows the full path only when the head row had to shorten it (`compact` on `ToolArgsSummary`, which is for an ordinary block alone); a block waiting on a decision and the approval notification show the whole value, because a decision cannot rest on something the reader did not see — and a call whose identifying argument or description is too long to show in full there (`INLINE_DECISION_LIMIT`) is offered only as a way into its card, never with Allow/Deny.

  **Prose with a call after it is finished prose.** The engine writes prose then calls, and a text delta after a call opens a new block (`conversation-store.ts`'s `handleText`), so a text bubble that has calls or badges under it is never written into again: `isStreaming` is false for it, the cursor does not blink in it, and it carries its time. The wait between a tool returning and the model speaking again is a `working` bubble at the end of the run — the typing indicator, with the avatar beside it — rather than a status line under the group; before the first row lands it is a group of its own.
  **The person's side is the same system.** A user bubble has the head and
  foot a model's has: the speaker (in a group), the quoted message, the
  conversations it referenced and its attachments above what was said, the
  time at the end of the last line — or on a foot line of its own when
  nothing was said — and stickers outside, as the model's are. Two questions
  with nothing answered between them are a run with the tight corners
  (`questionPositionOf` in `lib/turns.ts`; the later question closes up to
  the earlier one, except past a date separator). A `!` command is
  `ShellCommandBubble`: the command at the head with its outcome, an "output"
  badge and the time at the foot, and the output as a second block of the
  same bubble, open by default and remembered per bubble like every other
  panel. It used to be a `Card` with its own border, the one thing on that
  side drawn in a different system. Rows with `role = context` or
  `system` are not drawn at all, on purpose; the compaction summary is a
  `muted` bubble.
- **A delegation is a row in a group, and the way in is the run's own
  conversation.** `sub-agent-group.tsx` gathers the `run_agent` calls a round
  made together into one group — `BubbleKeys` partitions them out of the keys,
  and a lone one is a group of one — with a row per run: kind, the description
  the parent gave it, what it is doing right now, its verdict in a sentence
  once it has one, and the step count. The header counts the states and draws
  a tick per run. It used to be a key with a panel three folds deep (task,
  steps, the whole report), which for three parallel runs said nothing about
  which was still going and put the report in front of the reader twice.

  **"What it is doing right now" is the store's, not a fetch.** The global
  listener writes every conversation's stream into `sessions[id]` whether or
  not anything is showing it — `handleMessageStart` creates the session — so a
  live run's latest row is already there. Pressing a row opens
  `sub-agent-sheet.tsx`: the file preview's `Sheet` shell around a real
  `ChatTranscript` over that session, loaded with the same `loadMessages` the
  window uses and kept live by the same events. One renderer; the old
  `SubAgentTimeline` projection is gone. Without a provider (playground, tests)
  a row falls back to `openConversation`.

  **The question a run raises is asked under the group, not on its row.** A
  `ListBox.Item` is one focusable and cannot hold the buttons; the row is
  marked `waiting` and the approval renders below the list, on the parent, for
  the reason the attention-queue entry above gives — nobody is necessarily
  watching the sub-agent.
- **Colors: theme tokens only.** No raw Tailwind palette classes (`green-500`, `amber-500`, ...). Status colours are `text-status-*` / `bg-status-*-soft`; `ProgressCircle` takes them as `color="warning"`. Sole whitelisted exception: `text-amber-500` on "default" star markers, for gold-star semantics.
- **Type: the composite scale only.** `text-caption-2-*` 11, `text-caption-1-*` 12, `text-body-2-*` 13, `text-body-*` 14, `text-headline-*` 16, `text-title-3-*` 18, `text-title-2-*` 20, `text-title-1-*` 24 (`styles/typography.css`), each with a `regular|medium|semibold|bold` suffix that carries the weight. `text-sm`, a bare `font-medium` and `text-[11px]` are all lint errors; a weight under a variant (`[&_strong]:font-medium`, `prose-headings:font-semibold`) is not, because it addresses markup a composite class cannot.
- **Radius: BoardUI's ladder, and a child never rounder than the container that clips it.** Cards and frame panels `rounded-3xl` (settings cards follow the registry's settings rows at `rounded-2xl`); menus and popovers `rounded-2xl`; modals `rounded-3xl`; inputs, menu rows and tool blocks `rounded-md`…`rounded-xl`; buttons take their size tier's radius from `Button` itself; pills and icon buttons `rounded-full`. Overriding `h-*`/`px-*` on a Button without also overriding `rounded-*` is the usual way a hover fill gets clipped at the corners.
- **Component style:** `cx()` with `className` last, `tv` from `tailwind-variants` (re-exported by the barrel) for variant recipes, `dom.*` with a `render` prop instead of `asChild`. `data-slot` is a styling and test hook where something reads it (`settings-scroller`, the bubble blocks), not a tax on every node — the lint that demanded one everywhere is gone.
- **Buttons are the registry's variants plus one.** `primary`, `secondary`, `ghost` and `danger` are BoardUI's own. `ghost` is BoardUI's *accent-tinted* soft button, so it is for a genuinely soft or selected action and is wrong as a quiet icon button — that is `neutral`, the grey round control copied from the registry's own Dropdown example and recorded in `boardui.json` as the button's one added variant. A labelled destructive action is `danger`; an inline icon-only delete stays `neutral` and turns red on hover only, because a red pill among grey icons is louder than the action. The HeroUI-era `tertiary`, `danger-soft`, `outline` and `transparent` are gone and a caller naming one is a type error. Icons go in as components through `leadingIcon` (with `iconOnly` when there is no label), never as children, so the size tier sizes them and `isPending` can swap one for a spinner without moving the label.
- **Icons are `@keyline-icons/react/two-tone`**, and `/fill` where the glyph is solid by meaning (stop, a starred item). This replaced gravity-ui and Remix Icon outright rather than adding a third set beside them: two icon families on one screen read as two products. Brand marks and file-type icons are content, not icons, and are exempt.
- **Fonts are defined in exactly one file.** The registry's `theme.css` reads `--font-inter` and `--font-mono-source` and is not edited; `src/styles/fonts.css` defines them — `Inter → MiSans → MiSans L3` and `Maple Mono NF CN → MiSans → MiSans L3` — and `src/styles/fonts.test.ts` holds the chain together, since redefining `--font-sans` anywhere afterwards cuts `fonts.css` out without a visible error. MiSans L3 is scoped by `unicode-range` to CJK Extensions B–F (GB 18030-2022 level 3): it also maps some two hundred BMP punctuation and Latin glyphs that must never win over MiSans's own. Maple Mono ships Regular, Bold, Italic and Bold Italic, and Inter its variable italic: Maple is chosen for its ligatures, which a synthesised bold smears, and its italic is a cursive a synthesised slant is not — so code asks the browser to fake neither (a 500 falls to Regular and a 600 to Bold, both real). CJK has no italic in any MiSans build and is still slanted. The files are not in git and not ours to put there: MiSans may be used commercially and embedded in software, which the About page credits as the licence requires, but may not be modified — so no subsetting and no format conversion, which is why they are TTF — and may not be distributed on its own, which a public repository containing it would be doing. So `scripts/fetch-fonts.mjs` downloads the publishers' archives at build time, pins every archive and every extracted file by sha256, and fails the build on any mismatch or network error: a build that fell back to system fonts would look fine on the machine that made it. `public/fonts/` and `.cache/fonts/` are ignored; `predev`, `prebuild` and the release workflow run it. The installer is about 57 MB larger for it, after brotli (the three extra Maple faces are 24 MB of that).
- **Motion is the recipes in `motion.md`, from one file.** `overlay-motion.ts` carries them: popovers and menus 150ms fade + `scale-95` + 2px blur with the origin following placement; tooltips 200ms `scale-90` with a 4px blur; modals 300ms on `cubic-bezier(0.32,0.72,0,1)` condensing from `scale-[0.85]` with a 4px blur, over a `bg-black/70` scrim, on the registry settings-modal's surface (`rounded-3xl bg-background-full shadow-xs`, no border). Hover colour changes are `transition-colors duration-150` everywhere, dense rows included — the old rule that high-frequency rows take no transition was ours, not BoardUI's, and is void. Press feedback is a colour step and never a scale. Every keyframe animation has a reduced-motion guard, and the `animation-needs-keyframes` rule checks that the keyframes exist at all.
- **Notifications are the registry's `notification` item, unmodified but for the React Aria contract.** `base/notification/notification.tsx` is the official file (`boardui.json` records its two patches: `onPress` for the RAC `Button`/`CloseButton`, and keyline icons). There is no toast layer and no RAC `ToastQueue`: the shell mounts one `NotificationViewport` at `top-center` — the bottom is the composer's and, on Android, the keyboard's — with its top offset widened at the call site to clear `--safe-top`. The status vocabulary is the registry's own (`neutral` / `information` / `success` / `error`); there is no warning tier, and a warning is `neutral`. An approval notification is `dismissible={false}` because deferring is the only way past it. The viewport's `z-100` is the registry's own and is not overridden at the call site. The full queue is the registry's `notification-center` behind its app-shell `notification-bell`, both under `components/application/`, patched (see `boardui.json`) only with optional props — tabs, labels, `readable`, a `ReactNode` description, the bell's labels/`centerProps`/`before`/controlled open — plus the RAC/icon/motion changes; with no props they render what the registry does.
- **React Aria's state attributes live where React Aria puts them.** `data-expanded` / `data-entering` / `data-exiting` / `data-hovered` / `data-pressed` / `data-focus-visible` / `data-selected` — on the component *root*, styled from there with a descendant selector or a named `group`. `data-[selected=true]:` on a `CellSwitch.Control` matches nothing. Base components style from these rather than from `:hover`/`:active`, because `data-hovered` does not stick after a touch and `data-pressed` fires for keyboard presses too.
- **An icon-only control is named by its own label, and a tooltip is optional.** A tooltip contributes `aria-describedby`, so it describes a control without naming it; `icon-only-needs-name` therefore asks for `aria-label` (or `aria-labelledby`) on anything marked `iconOnly`, and nothing more. BoardUI's own icon buttons carry the label alone, so requiring a `Tooltip` ancestor as well — the old rule — was stricter than the constitution and is gone. Where a tooltip does help, wrap a child in `Tooltip.Trigger` only when it cannot take focus itself: around a real button that wrapper becomes a second tab stop that does nothing.
- **Controls and dialogs are the base layer's, not the browser's.** `<details>`, `<progress>`, `<meter>`, `<select>` and friends, and `alert` / `prompt` / `window.confirm`, are UI nobody designed, and the lint names the base replacement for each (`Disclosure`, `ProgressCircle`, `Select`, `useConfirm` / `AlertDialog`). A native `title` is no longer on that list: the ban came from the HeroUI-era taste profile, not from BoardUI, and it bought a tab stop or a wrapper per hint for the sake of a delay and a font. Use `title` for plain overflow text; reach for `ui/hint.tsx` (a `Tooltip.Trigger` rendered *as* the text's own element) when the extra text is something a keyboard user needs too. Text that CSS cuts off (`truncate`, `line-clamp-*`) takes `onPointerEnter={titleIfTruncated}` (`lib/truncation.ts`), which sets that `title` only while the text is actually cut off — measured with a `Range` on arrival, because `scrollWidth` rounds away a sub-pixel overflow and a few hundred rows each observing their width is a cost for a question asked on hover. Not on an element whose text content is more than the text (an icon's label, a badge beside it): the title would be the two run together.
- **Right-click menus are `components/base/context-menu.tsx`: a React Aria `Menu` in a `Popover` anchored to where the pointer was.** The anchor is a zero-size fixed span moved to the event's coordinates, and RAC positions and flips against it like any trigger. `Trigger` merges the caller's `onContextMenu`/`onPointerDown`/`onContextMenuCapture` with its own rather than replacing them — the sidebar records which row was hit on `pointerdown` because on a touch screen the long-press and the WebView's own `contextmenu` race. Its `render` is a function of the DOM props, not an element, and the ref in them has to reach a real node; the message groups are the triggers that way. `useContextMenuGuard` cancels the WebView's own menu everywhere except a touch screen and an editable field with no menu of ours; devtools is Ctrl+Shift+I.
- **The sidebar is a tree, so a row is not a button.** `Sidebar.Menu` is a React Aria `Tree` (which renders as `role="treegrid"` with `row`s — tests query those roles): rows are chosen with `onAction`, walked with the arrow keys under one tab stop, every row needs `id` and `textValue`, the caller's `useDragAndDrop` hooks land on the tree, and `Sidebar.MenuAction` is a RAC button so pressing it does not also choose the row (`slot="drag"` is the keyboard drag handle). A `TreeItem` forwards only a fixed set of props to the DOM — `data-*` survives, `onContextMenu` does not — which is why the right-click menu wraps the whole list once and reads the row back off the event. The panel is `hidden md:flex`, so `Sidebar.Mobile` renders the same tree a second time inside a `Sheet` and `Sidebar.Trigger` opens that sheet below 768px; anything stateful inside the tree exists twice. The panel is drawn at boardui's own scale — `p-3`, 36px rows from `p-2` around a 20px icon, `gap-1` between rows, the quick-search row as a `rounded-full` tertiary pill (`appearance="pill"`), and the icon rail as the same rows at `w-9` with label, chip and actions blurred to `max-w-0` off `data-state=collapsed`. There used to be a `--spacing: 0.2rem` override on the whole panel that shrank all of it to 80%, which is what made it look like nothing else on the page.
- **A safe-area or keyboard inset is added to a component's own padding, never passed as its own utility.** `pb-[var(--ime-bottom)]` on the frame and `pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)]` on the sidebar looked harmless and were not: under `cx()` a `pb-*` utility *replaces* the bottom of the component's `p-3`, and on a desktop the inset is `0px` — so the frame had no bottom edge and the panel no padding at all, with nothing failing. Write `pb-[calc(0.75rem+var(--ime-bottom,0px))]`, or put the inset inside the component where its own padding is known (`SidebarRoot` does, because the rail's 11px is not the panel's 12px). `max(1rem, var(--safe-bottom))` is the other safe shape.
- **A field is the registry's tertiary well, wherever it sits.** There used to be a `surface` prop that swapped a field's fill for the secondary one on a light surface; it was a second answer to a question the registry already answers, and it is gone. Where a well would disappear into its background the fix is the surface, not the field — which is why the modal is the settings-modal's `bg-background-full` rather than a card fill.
- **`mod` is Command *or* Control, not whichever the platform prefers.** `useHotkey` (`hooks/use-hotkey.ts`) accepts either, because two shortcuts that disagree about `mod` would be worse than either answer alone. It is one hook, not a registry — a registry buys collision resolution for collisions that do not exist yet. Everything defaults to letting a focused text field have the key. Two kinds of caller pass `ignoreInInput: false`: the command palette, and the transcript's approve/refuse chords (`use-transcript-hotkeys.ts`, `mod+shift+y` / `mod+shift+n`) — the composer nearly always has focus, and a chord of that shape has no editing meaning in a text field. A bare key or `mod+letter` may not do this. Letters only: `matchesHotkey` compares `event.key`, and with Shift held a `.` arrives as `>`. The chords answer the last unanswered call of the turn being worked on, found by scanning back from the tail of the transcript and stopping at the first turn with an answer in it — never the attention queue, which holds other conversations' questions too.
- **A wait is drawn as the shape that is coming, not as the word "loading".** A panel fetching its data renders a skeleton the size of what will replace it — `SettingsSkeleton` for the header-over-a-list that every settings panel opens with, a hand-built one where the shape differs (`usage-settings.tsx`). A line of text leaves the page looking empty rather than busy, and then reflows everything when the rows land; matching the height means nothing moves. Match the width too: every settings page is `max-w-settings` and so is `SettingsSkeleton`, and a skeleton narrower than its replacement reflows the page at the moment it is meant to be steadying it. Three rules around it: a skeleton needs `role="status"` + `aria-busy` + a label, because a column of grey boxes says nothing to a screen reader and the line of text it replaces at least did that; it is for the **first** load only, since replacing real figures with grey boxes to fetch slightly different ones is a step backwards — a refresh gets a small `Spinner` beside the control that triggered it; and never render a zeroed-out version of the real thing while waiting, because a zero that turns out to be wrong is worse than no number, being legible. Deliberately *not* skeletoned: the `Suspense` around the lazily-loaded settings chunk, which is on local disk and resolves within a frame or two, where any placeholder reads as jank.
- **Width is asked of the box, not the window.** `useIsMobile` answers "is this a
  phone-sized viewport" and nothing else. It is the wrong ruler wherever
  something has already taken width away: settings is a layer over the chat, so its width
  is the window minus the 240px sidebar, and a 769px window leaves it 519px — a
  desktop by the viewport and a phone by the only measure that matters.
  `MasterDetail`'s detail column came out at ~280px there, with four price fields
  inside it at 130px each.

  So layout decisions are keyed to the container. **Which of the two mechanisms
  depends on what the width decides**: what gets *rendered* — a different
  component tree, a drilldown with a back button — is JS (`useIsNarrow`, and
  `TWO_COLUMN_MIN` is the one threshold both settings panels flip on); how the
  same DOM is *arranged* — columns, wrapping, direction — is a container query.
  `@container/pane` is declared on all five boxes an editor can land in, and it
  is **named** because the same markup renders in a detail column, in a
  `SettingsSubPage` and in a drilldown sheet that React Aria portals to `body`.
  `skill-settings.tsx` had worked this out once already and the note there says
  why. There are no viewport breakpoints left under `components/settings/`.

  **Every settings page is one width**, `max-w-settings` (`--container-settings`,
  33.25rem in `meridian.css`): the registry settings-modal's content pane, an
  871px panel less its 274px rail, the rail's rule and 32px of padding each
  side. `SettingsPane`, `SettingsPage`, `MasterDetail` and `SettingsSkeleton` all
  carry it and none takes a width of its own — there used to be three (`lg`,
  `3xl`, `4xl`), and moving between sections moved the column. A table fits it
  the registry's way (settings-storage's file list): `table-fixed`, the figures
  given widths on their headers, the naming column taking the rest and
  truncating, and `min-w-lg` so a phone scrolls the table inside its own card.
  `width` on a DataGrid column does nothing — React Aria only honours it inside
  a resizable container. At that width `MasterDetail` is always its drilldown:
  `TWO_COLUMN_MIN` is 536px.

  Two consequences worth knowing before adding one. `useIsNarrow` must measure a
  box whose width does not depend on its own answer — never the column it decides
  whether to render — which is why `MasterDetail` has one unconditional root.
  And `container-type` brings `contain: layout`, making the container the
  containing block for `position: fixed` descendants: `ActionBar` (`base/action-bar.tsx`) is one
  and does not portal itself, so the two call sites do it for it.

- **The conventions above are gated, not reviewed — and a gate has to be
  BoardUI's.** The first lint pass was written from a 2026-09 audit against
  HeroUI's design-taste profile, and several of its rules fired on the
  registry's own source: `cursor-pointer`, `uppercase`, bare `rounded`, px
  max-widths, native `title`, a mandatory `data-slot`, a mandatory `Tooltip`.
  A rule that the constitution's own code breaks is a rule from somewhere else,
  so those are gone. What `eslint.config.js` keeps is what BoardUI's rules
  actually say, or what fails silently: raw palette including `white`/`black`,
  HeroUI token names (they resolve to nothing), Tailwind type sizes and bare
  font weights, `bg-muted`, raw `shadow-*`, `animate-pulse`/`animate-spin` in
  place of `Skeleton`/`Spinner`, status colours at alpha, a Button painted
  `text-status-danger` or given `h-auto`, a Spinner sized by className, a
  template-string className, `t(…).replace`, glyph icons, native form elements
  and browser dialogs, and the React Aria rules (a state attribute on a
  `*.Content` slot, `onClick`/`disabled` on Button). `scripts/eslint-rules/` is
  the local plugin for what needs more than a selector: `icon-only-needs-name`
  (an `iconOnly` control has its own accessible name), `animation-needs-keyframes`
  (an `animate-*` names keyframes some stylesheet defines — the HeroUI-era
  `shimmer` outlived its stylesheet and every "thinking" label stopped moving
  with nothing failing), `no-silent-prop-drop` (a base component may not
  accept a prop and drop it as `_x` — the shape behind every dead primitive of
  the first boardui pass), and `button-icon-through-prop` (a keyline icon
  written as a Button child lands inside the label span, flush against the
  text — forty-odd buttons shipped that way before it existed). Two are recurrence gates, each for a class of bug
  that shipped twice: `no-variant-as-state` (a Button whose `variant` a
  condition switches between quiet looks, or that also carries
  `aria-pressed`/`aria-selected`, is a selection drawn by hand — use
  `ToggleButton`, `SegmentedControl`/`Tabs` or a `ListBox`/`Menu` with
  `selectionMode`) and `field-fill-follows-surface` (a field keeps the
  registry's tertiary well; the only fill allowed on one is BoardUI's own
  `bg-background-secondary-default` — change the surface, not the field). The
  second has a partner that is not lint: `src/styles/surface-contrast.test.ts`
  resolves `theme.css` for both themes and fails if the well, or the switch's
  off track under `CellSwitch`, matches a surface it may sit on — in the dark
  theme tertiary and primary are both neutral-800. Each message names the
  replacement. Vendored files get the React Aria rules only, for the reason
  given under `boardui.json` above. Beside them sit the data-honesty gates:
  `no-default-on-load-failure` and `no-parse-or-default` (a failed read or an
  unparseable input is not a default for the save path to write back), and
  `no-invented-domain-default` — an absent window, price, limit, timeout or
  size stays `null` and is drawn as unknown, never `?? 128000` (the context
  ring, 2026-09). Its vocabulary (`domain-vocabulary.mjs`) is shared with its
  Rust half, `scripts/check-rust-invented-default.mjs`, which runs in CI over
  the shell and the core and takes `// domain-default: <reason>` as its
  escape hatch.

  `scripts/eslint-rules.test.mjs` (`pnpm lint:rules`, also in CI) pins every
  selector to the shape it was written for, flagged and clean; a new restriction
  adds both cases there, because a selector that quietly stops matching looks
  exactly like a codebase that complies. The escape hatch is
  `// eslint-disable-next-line <rule> -- <reason>`: a `components/ui` wrapper
  whose caller supplies the name, a genuinely multi-line button, the streaming
  caret, a live status dot that pulses (`animate-pulse` is banned for what it
  usually is, a hand-rolled skeleton, and a dot saying "waiting on you" is the
  other thing), the gold star's `text-amber-500`, the modal scrim's
  `bg-black/70`, which is `motion.md`'s own value, and the three icon toolbar
  toggles whose on-state is `ghost` with `aria-pressed` (the rich-text
  editor's format and link buttons, the header's changes-panel button).

  What no selector can see — a lookalike of a registry component, a vendored
  file changed without a patch entry, the accent used as a hover wash, a font
  named outside `fonts.css`, an icon from another set, motion off the recipes
  — is written down in `REVIEW-CHECKLIST.md`, which the stop-review reviewer is
  told to read before judging a diff in this repository. The lint and the
  checklist are deliberately disjoint: an item in both is one the reviewer
  wastes a round restating.
- **Dev playground:** `http://localhost:5173/#playground` in any dev build (tree-shaken from release). `#playground/scroll` is the scroll regression harness, `#playground/webview` probes CSS support against the WebView. Add new component states there.
- **`#playground/responsive` is where a breakpoint can be caught being wrong.**
  Nothing else can see one: `tsc`, eslint and the whole test suite are blind to
  layout, and `vitest` runs `css: false` in jsdom besides. It drives the app in a
  same-origin iframe — the only thing that gives a real `innerWidth`, a real
  media query and a real containing block for `fixed` — and runs detectors for
  clipped overflow, escapes past the edge, touch targets, short viewports and
  keyboard occlusion.

  **What it cannot do is on the page, and belongs there.** Touch targets are
  *computed*, not measured: `@media (any-pointer: coarse)` does not match on a
  mouse-only desktop, so what `touch-hitbox` would expand to is derived and
  intersected with whatever clips it — green is not a promise about a phone.

  **That utility asks `any-pointer`, and the hook next to it asks `pointer`.**
  Not an inconsistency: `pointer` describes the primary pointer alone, so on a
  Windows touchscreen laptop it reports `fine` and every hitbox stayed at its
  drawn size while a finger was reaching for it — which is why the CSS moved.
  `isCoarsePointer` did not, because its one caller is `isSubmitKey`, and there
  the question really is "is the keyboard a soft one": widened, a touchscreen
  laptop with a real keyboard would lose Enter-to-send. The keyboard row
  checks the mechanism, not Android's numbers. 360 and 400 do not exist on this
  desktop at all (`minWidth: 640`) and only mean something on a device. The
  geometry behind all of it is pure and unit-tested in
  `responsive-detectors.test.ts`, which is the part that survives having no
  coarse pointer to test against.
