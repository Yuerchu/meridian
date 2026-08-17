# Meridian

Multi-provider AI desktop client with coding agent capabilities.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Tauri v2 (Rust backend + WebView frontend) |
| Frontend | React 19 + TypeScript + Vite |
| UI | Tailwind CSS v4 + HeroUI v3 (React Aria) |
| Backend | Rust (tokio async runtime) |
| AI Streaming | reqwest + eventsource-stream (SSE) |
| Database | SQLite (planned) |
| License | Proprietary (LicenseRef-Proprietary-Yuerchu) |

## Architecture

```
src/                  # React frontend
src-tauri/
  src/
    lib.rs            # Tauri app entry, IPC commands
    provider/         # AI provider implementations
      openai_compat.rs  # OpenAI-compatible SSE streaming
```

## Key Design Decisions

- **Pure Rust backend**: No Python sidecar, no Codex submodule. Selectively port useful patterns from Codex (Apache 2.0) into our own code.
- **Local-first + optional cloud**: Default standalone desktop app. Optional connection to foxline-pro backend for billing, collaboration, multimedia generation.
- **Streaming via Tauri events**: Rust backend streams AI responses via `app.emit("chat-stream", ...)`, frontend listens with `listen()`.
- **Multi-provider**: OpenAI-compatible base, extend to Anthropic/Google/Ollama etc.
- **Messages are a tree, read as one path.** Each row has a `parent_id`; each conversation has a `head_message_id` naming the leaf its active path ends at. Regenerating or editing writes a sibling and leaves the original reachable. Read a conversation with `db::ops::message::active_context` — `sort_order` is insertion order, not transcript position, once branches interleave. Write only through `append_message`, which links the row and moves the head in one transaction. Delete only whole subtrees: dropping a lone row strands its tool results or leaves an answer to nothing. `parent_id` carries no foreign key on purpose (see migration 21).
- **The transcript follows the stream, then hands it back.** `src/lib/message-scroller.tsx` is a fork of `@shadcn/react/message-scroller` (the package is gone; the styled wrapper in `components/ui` is unchanged). Upstream anchors a new turn to the top of the viewport and holds it there for as long as the answer streams — with a question taller than the viewport that hold never releases, so the whole answer is written off-screen. Here there are two modes: `follow` sticks to the live edge, `idle` moves for nobody but the reader. Anchoring falls out of following instead of competing with it — a spacer re-solved every frame makes "scrolled to the end" and "question at the top" the same position until the answer outgrows the viewport. A turn that stops streaming while the reader is still following scrolls back to the top of its answer (`MessageScrollerAnchor` / `answerAnchorId`); one they had scrolled away from does not move. Row identity is not a scroll trigger: re-keying a row when its reload lands used to jump to the top of the conversation. Drive changes through the harness at `#playground/scroll` — "跑全部场景" replays every behaviour above and asserts it.
- **One shell, on every platform.** `components/layout/app-shell.tsx` is the whole frame; there is no mobile variant and nothing branches on width. The sidebar *is* the conversation list — a panel above 768px, `Sidebar.Mobile`'s sheet below it, both rendered from the same tree — and settings is a page beside the chat rather than a screen over it. The chat stays mounted underneath, `inert`, because unmounting it loses the composer draft and the transcript's scroll position. There used to be a stack of screens for phones, selected by a width read once at startup; that seam is what made a narrow Windows window and a tablet in landscape both wrong. What survives of it is `useHistoryLevel`, which is about the back gesture and not about layout.
- **Branches switch the transcript, not the world.** The todo list, approved plan and collaboration mode stay per-conversation and do not follow a branch switch. Files edited and commands run cannot be rewound either, so making these alone branch-aware would imply more than actually happens.
- **A cached prefix belongs to the session, not to whoever spoke.** The tool
  array and the system prompt are the front of what a provider caches, and
  `base_prompt` is derived from the tool set, so anything that reshapes the
  tools reshapes the prompt too. OneBot decides `is_admin` per *message*
  (`handler.rs` reads it off the sender), and that used to select the tool
  definitions — so a group where an admin and an ordinary member both talk
  alternated between two prefixes and threw the cache away on every
  alternation. Measured against the desktop's ~80%, QQ sat under 50%. Now the
  definitions are fixed per session and the speaker is weighed at dispatch
  instead, through `offered`, which `run_turn` checks ahead of every path
  including surface tools. Fixed does not mean *everything*, though: a group
  gets one tool array shared by everyone in it, so its contents have to be safe
  for all of them. QQ tools are (our own fixed prose about the room the reader
  is in); registry and MCP definitions are not, carrying the user's own server
  names and argument schemas, so a group is sent none of them and an admin who
  wants them opens a private chat. A private chat narrows by `is_admin` as it
  always did — one counterpart means it cannot change under the session, so
  narrowing costs no cache. `shown_as_admin` and `exposes_full_toolset` in
  `qq_tools.rs` are the two decisions, kept out of the call sites.

  The other half of that split is that **authority follows the speaker, and a
  turn has more than one.** A round can open with several people's queued
  messages, a `TurnEnd::Continue` round is whoever spoke next, and steering adds
  people mid-flight — so `offered` is the conjunction over everyone in the
  round (`round_authority`), and joining mid-turn can only take tools away
  (`Steering::narrowed`, intersected by `narrow_offered`, never assigned). Read
  off whoever happened to trigger the turn instead, an ordinary member gets
  answered with an admin's tools, and `qq_get_friend_list` is a read that needs
  no approval — so the leak needs nobody's consent.
- **Memory is frozen into the history, then only what changed is sent.** The
  block used to be rebuilt every turn and injected *between* the history and the
  new message without ever being stored — so each turn's payload diverged from
  the last one's cache at exactly the point the previous turn began, and nothing
  after it could be reused. Now `plan_injection` writes it as a `role="context"`
  row (`memory_context.rs`) and later turns send only the difference.
  Consequences, each of which has a test because none of them fail loudly:
  - **The database role is `context`, not `user`.** Half a dozen places sort by
    role — `prepare_compact_input`, `audit_copy`, title generation,
    `chat-view.tsx` — and every one of them would otherwise treat injected
    background as something a person said. Wire role is still `user`;
    `push_history_message` translates, and the bytes it produces must equal what
    `system_context` produced the first time or the cache breaks at that row.
  - **Change detection is two keyset cursors, not a timestamp.** A delete sets
    `deleted_at` and leaves `updated_at` alone, so deletes need their own cursor;
    ids break ties because a batch write shares one millisecond; the window's
    upper bound is exclusive so a concurrent write cannot land on the boundary;
    and the cursor stops before anything the budget refused, since trimming
    drops in an order unrelated to when rows were written. Being asked about
    counts as delivered even when the budget only took part — requiring a whole
    delivery cannot converge, and anyone with more memories than their slice
    stays a stranger for ever.
  - **The roster goes after the message.** Who is present changes every turn and
    is never persisted, so placing it before the message re-creates the very
    divergence the frozen row removes.
- **A bill is priced once, in `agent::pricing`.** `compute_cost` carries a rule no summation expresses: a cached token bills at the cache rate *instead of* the input rate, not on top of it. That formula has been wrong once — the old one reported a DeepSeek turn at a 90% hit rate as costing nearly six times what it did — and three tests now stand on it. So nothing else computes a cost: not SQL, not the front end. `db::ops::usage` reduces millions of audit rows to a few dozen groups and hands each to `cost_of`, which is the same function behind the stop event's `cost_breakdown`. Two implementations would disagree in exactly the case the tests exist for. Report totals with `UsageDimension::Total` rather than adding a breakdown up, for the same reason.
- **What a reply cost is a fact about the past, so the price travels with it.** `audit_messages` snapshots the four rates at write time (migration 30), beside the `provider_name` and `sender_name` it already copied. Joining `model_configs` at read time instead would mean correcting a typo in a rate silently rewrites what last month cost. Rows older than that migration have NULL there and fall back to today's configuration — the retroactive answer, kept only because it is the sole number those rows have. A model priced `0/0` is one nobody has filled in, not one that is free (the editor opens at zero): `Prices::known()` is the single definition, and traffic that fails it is counted into `unpriced_messages` and surfaced. A cost shown without that count is smaller than the truth with nothing to say so.
- **`--chart-1`..`--chart-4` are ours.** Pro's charts read them and Pro defines them in its base theme, which this project does not import — only the per-component CSS files. Undefined, every series draws transparent. They are categorical rather than a ramp, and deliberately clear of `--success` / `--warning` / `--danger`, which mean something here: a series that landed on the warning colour would read as a warning.

## Hook gates

`src-tauri/src/hooks/` is a loopback HTTP endpoint another coding agent's hooks call
into. Two routes today, both reviewing something Claude Code is about to do:
`POST /hooks/exit-plan` takes a plan before anything is written, `POST /hooks/stop-review`
takes the uncommitted diff after. The client half is a Claude Code plugin living in
`~/.claude/plugins/local/meridian-plan-gate/` — **a separate repository, so a change
here usually needs a commit there too.**

- **Everything uncertain fails open.** A refused connection, a non-2xx, an unparseable
  body, an unrecognised verdict — all let the action through. The only thing that stops
  it is a review that ran, parsed, and said so. This is not timidity: a gate that can
  wedge the user out of plan mode is worse than one that occasionally misses.
- **No cross-request state.** The client names the conversation its earlier rounds went
  to and Meridian validates rather than remembers, so a crash between two rounds is
  indistinguishable from no crash. The id is checked against `agent_kind` — any local
  process can reach this port, and without that check a caller could have the reviewer
  append to the user's own conversation.
- **The two gates do not share a conversation.** The reviewer looking at code has not
  seen the plan, so it judges the code on the code rather than being anchored by an
  intention it already agreed to.
- **Timeouts decrease across three layers** (Meridian 1200s, plugin 1260s, hook 1320s)
  so whichever gives up first can say so. Raising one without the others just moves the
  cutoff to the layer that cannot explain itself. The numbers are measured: a real review
  took 274s over some sixty tool calls.
- **The review is owned by the app, not the request.** `review::run` is spawned and the
  handler awaits a `oneshot`; a client that gives up does not abandon a turn mid-flight
  and strand its row at `running`.
- The reviewer gets four read-only tools and no shell. Diffs are computed client-side and
  sent, which is why it needs none.
- `hooks/mod.rs` writes a handshake file (`{app_data_dir}/plan-gate.json`) carrying port,
  token and settings. Each server generation only deletes the file it wrote — a restart
  used to have the outgoing generation delete the incoming one's.

## Logging

`tracing` events at info and above go to `{app_data_dir}/logs/meridian.log` as JSONL, rotated by size (5 MB × 5). The user reads them in Settings → About → View logs; the assistant reads them through the `read_app_logs` tool, which the `meridian-diagnostics` skill drives. All three share `logging::reader::query`.

- **Never log message bodies, prompts or tool output.** Log a length instead (`chars = body.chars().count()`). Exported logs leave the machine.
- Credentials are redacted by field name plus `secrets::sanitizer::redact_secrets`, but do not rely on it — don't put a key in a log line to begin with.
- `error = %e` beats `format!("{e}")`: the visitor walks `source()` and records the whole chain.
- Open a span where a request begins (`info_span!("chat", conversation_id = %id)`). Everything logged underneath inherits it, which is what makes "why did *this* conversation fail" a single query.
- New call sites default to `debug!`. Only user-visible state changes and failures earn info and above, because only those reach the file.
- `RUST_LOG` steers stdout only. The file level is the `logging.level` preference, so a debug session cannot evict the records it was meant to keep.

## UI Conventions

Built on HeroUI v3 (React Aria underneath). Read the component's own CSS before styling it — `node_modules/@heroui/styles/dist/components/*.css` says what it already does, and most "why won't this override" questions are answered there. The `heroui-react` skill fetches the official docs.

Prefer HeroUI's answer over ours. Accepting a different radius or spacing is cheaper than a `className` that fights the library, and a wrapper that only re-exports a HeroUI component should not exist. What remains under `components/ui/` is what HeroUI has no equivalent for.

- **Two tokens mean the opposite of what shadcn called them.** `--muted` is secondary *text*, not a pale background; `--accent` is the main action colour (Button primary, Switch and Slider fill, focus ring), not a neutral hover wash. The neutral hover wash is `--default`. Getting these backwards renders, so it survives review — check the token, not the look.
- **Colors: theme tokens only.** No raw Tailwind palette classes (`green-500`, `amber-500`, ...). Status colours use `--success` / `--warning` / `--info`; `--info` is a project extension with no HeroUI `color` variant behind it, so components that take one need their custom property set instead (`[--progress-circle-stroke:var(--info)]`). Sole whitelisted exception: `text-amber-500` on "default" star markers, for gold-star semantics.
- **Font sizes: Tailwind scale only** (`text-xs/sm/base/lg`). No px arbitrary sizes (`text-[11px]`), no exceptions.
- **Radius: ours nests inside theirs, never the reverse.** Our containers keep composer `rounded-2xl` → chat/tool cards `rounded-xl` → settings cards `rounded-lg`. HeroUI's own are much rounder (Button and Popover 24px, Tooltip up to 32px) and are not bound by that ladder. So when a HeroUI component sits inside one of our clipped containers, its radius must not exceed the container's — otherwise its hover fill is cut into at the corners. Overriding `h-*`/`px-*` on a Button without also overriding `rounded-*` is the usual way in.
- **Component style:** `data-slot` on every DOM node, `cn()` with `className` last, `tv` from `@heroui/react` for variants, `dom.*` with a `render` prop instead of `asChild`.
- **HeroUI's state attributes live where HeroUI puts them.** `data-expanded` / `data-entering` / `data-exiting` / `data-hovered` / `data-pressed` / `data-focus-visible` / `data-selected` — and several of those only appear on the component *root*, styled from there with a descendant selector. `data-[selected=true]:` on a `Switch.Control` matches nothing.
- **A tooltip does not name its trigger.** It contributes `aria-describedby`, so an icon-only button still needs `aria-label`. Wrap a child in `Tooltip.Trigger` only when it cannot take focus itself: around a real button that wrapper becomes a second tab stop that does nothing.
- **base-ui is down to `ui/context-menu.tsx`** — HeroUI's menus are click-triggered and have no right-click equivalent. Don't reach for base-ui anywhere else. Its `Root` must enclose its own `Trigger`; parked elsewhere it throws at render, and neither `tsc` nor `vite build` sees it coming.
- **The sidebar is a tree, so a row is not a button.** `Sidebar.Menu` is a React Aria `Tree`: rows are chosen with `onAction` (no `href` — see the header of `app-sidebar.tsx`), every row needs `id` and `textValue`, and nothing that is not a `MenuItem` may sit between the menu and its rows. A `TreeItem` forwards only a fixed set of props to the DOM — `data-*` survives, `onContextMenu` does not — which is why the right-click menu wraps the whole list once and reads the row back off the event. Pro hides the panel outright below 768px, so `Sidebar.Mobile` renders the same tree a second time; it returns `null` above that width, but anything stateful inside it exists twice.
- **`mod` is Command *or* Control, not whichever the platform prefers.** `useHotkey` (`hooks/use-hotkey.ts`) accepts either, because Pro's `Sidebar.Provider` does the same for its `mod+b` and two shortcuts that disagree about `mod` would be worse than either answer alone. It is one hook, not a registry — a registry buys collision resolution for collisions that do not exist yet. Everything defaults to letting a focused text field have the key; the command palette is the one caller that passes `ignoreInInput: false`, and it should stay the one.
- **A wait is drawn as the shape that is coming, not as the word "loading".** A panel fetching its data renders a skeleton the size of what will replace it — `SettingsSkeleton` for the header-over-a-list that every settings panel opens with, a hand-built one where the shape differs (`usage-settings.tsx`). A line of text leaves the page looking empty rather than busy, and then reflows everything when the rows land; matching the height means nothing moves. Match the width too: `SettingsPane` is `max-w-lg` and `MasterDetail` is `max-w-3xl`, and a skeleton narrower than its replacement reflows the page at the moment it is meant to be steadying it. Three rules around it: a skeleton needs `role="status"` + `aria-busy` + a label, because a column of grey boxes says nothing to a screen reader and the line of text it replaces at least did that; it is for the **first** load only, since replacing real figures with grey boxes to fetch slightly different ones is a step backwards — a refresh gets a small `Spinner` beside the control that triggered it; and never render a zeroed-out version of the real thing while waiting, because a zero that turns out to be wrong is worse than no number, being legible. Deliberately *not* skeletoned: the `Suspense` around the lazily-loaded settings chunk, which is on local disk and resolves within a frame or two, where any placeholder reads as jank.
- **Dev playground:** `http://localhost:5173/#playground` in any dev build (tree-shaken from release). `#playground/scroll` is the scroll regression harness, `#playground/heroui` probes CSS support against the WebView. Add new component states there.

## Packaging

**Only Windows and the AppImage ship sherpa-onnx.** `sherpa-onnx-sys` links its
library dynamically and emits an rpath of `$ORIGIN` (Linux) or `@loader_path`
(macOS), which resolves against whatever sits beside the binary — true in the
target directory, false in an installed package. Windows is covered because
`build.rs` stages the DLLs and `tauri.windows.conf.json` declares them as
resources; the AppImage is covered because linuxdeploy copies dependencies into
the image, given `LD_LIBRARY_PATH` in the release workflow.

Nothing does this for the deb, the rpm or the macOS bundle. A build of those
*succeeds* and produces something that cannot start: the loader fails on
`libsherpa-onnx-c-api` before any code runs, so it reads as the app not
opening rather than as a missing feature. Verified against the v0.2.0 macOS
bundle — the binary asks for two dylibs and the `.app` contains none.

So `tauri.linux.conf.json` limits Linux to the AppImage, and macOS is not
built. Lifting either means staging the libraries for that platform *and*
giving the binary an rpath that reaches wherever the bundler puts them —
Tauri's resources land in `/usr/lib/<product>` for a deb and
`Contents/Resources` for a `.app`, neither of which is beside the executable.

**`SHERPA_ONNX_LIB_DIR` must not outlive the Android build that set it.**
`resolve_lib_dir` in `sherpa-onnx-sys` takes the variable if it is set and
returns it *without checking the target platform*; only when it is unset does
it fetch the prebuilt archive for the target being built. So a desktop build
run in a shell that still has the Android export from
`scripts/fetch-sherpa-android.sh` links against a directory of arm64 `.so`
files, and fails at `link.exe` with `LNK1181: cannot open input file
'sherpa-onnx-c-api.lib'` — a message that names neither the variable nor
Android, in a command line hundreds of arguments long.

Worse, cargo caches the resolved path in
`target/<profile>/build/sherpa-onnx-sys-*/output`. The crate does declare
`cargo:rerun-if-env-changed=SHERPA_ONNX_LIB_DIR`, but clearing the variable has
been seen not to trigger a re-run — so the wrong path survives into later
builds. `cargo clean -p sherpa-onnx-sys` does not remove it either; delete that
directory (it is a few KB, `out/` is empty) to force the script to run again.

Give the export its own process rather than the session:
`(export SHERPA_ONNX_LIB_DIR=$(bash scripts/fetch-sherpa-android.sh arm64-v8a); pnpm tauri android build --target aarch64)`.
The variable holds one ABI at a time by design — see the header of that
script — which is the same reason it should not hold one across two platforms.

## Android

- **File access model**: tools resolve paths through `ToolContext::resolve_and_validate` (`src-tauri/src/tools/mod.rs`). Desktop = `FileAccess::Unrestricted` (legacy working_directory check). Android = `FileAccess::Roots` whitelist built in `build_file_access` (lib.rs) from preferences `android.manage_storage_enabled` / `android.saf_roots` + the system grant. SAF I/O goes through `src/android_bridge.rs` (JNI) → `FileBridge.kt`.
- **run_command is compiled out on Android** (`#[cfg(not(target_os = "android"))]` in tools/mod.rs).
- **Hand-maintained files inside `src-tauri/gen/android/`** (tracked in git; if `tauri android init` is ever re-run, merge these back manually): `app/src/main/AndroidManifest.xml` (storage permissions), `app/src/main/java/cn/yuxiaoqiu/meridian/MainActivity.kt` (SAF picker + `nativeOnSafResult`, window insets, and `handleBackNavigation`), `FileBridge.kt` (ContentResolver ops), `app/build.gradle.kts` (androidx.documentfile dependency).
- **The keyboard is a padding, and every `svh` between it and the composer defeats it.** The WebView is not resized when the soft keyboard opens — `MainActivity` measures it and reports `imeBottom`, and `app-shell.tsx` shrinks the frame with `pb-[var(--ime-bottom)]`. That only reaches the composer if nothing in between insists on a viewport height. Pro's sidebar does: `.sidebar__main` is `min-height: 100svh` (`calc(100svh - 1rem)` under `variant="inset"`) and `.sidebar` is `height: 100svh`, so `Sidebar.Main` needs `min-h-0` or the pane stays a full screen tall while the frame around it shrinks. Nothing catches this: it is correct on every desktop, and `tsc`/`eslint`/`vitest` have no layout between them. The bottom insets are also exclusive, never summed — while the keyboard is up it covers the navigation bar, so `MainActivity` reports `bottom: 0` and the whole gap as `imeBottom`.
- **The back key is the web history.** `WryActivity` routes it through `WebView.canGoBack()`, the generated `TauriActivity` disables that, and `MainActivity` turns it back on. So something is undone by the back gesture exactly when it pushed a `history` entry for itself — `useHistoryLevel` is the only way to do that, and `lib/history-bridge.ts` the only writer of history. Never call `history.back()` anywhere else: the store is updated from `popstate` alone, which is what keeps it from drifting. There are no screens to go back to any more, only levels inside one — a drawer, a detail pane, a non-empty selection. `useBackGesture`, called once by the shell, decides whether the gesture is ours at all; everything below it is inert on a desktop.
- **History is reconciled, not commanded.** A level changes the store and calls `syncHistory`, which brings `window.history` to `levels.length` on the next microtask. It is deferred because a hand-over — the drawer closing as a page opens, which is every row in the mobile sheet — changes the store twice in one commit, and the two eager operations that used to produce do not commute: `history.go(-n)` resolves its target against the entry current when it is *called*, so a `pushState` landing in between is skipped and the traversal overshoots. Settings opened and was closed again by the popstate its own drawer had queued, which read as the page flashing and bouncing back. Coalesced, a hand-over costs no history operation at all. Nothing else may call `pushState` or `go`, and a level's effect must not assume its entry exists yet — it does not until the microtask runs, which is why the tests need an awaited `act` around anything that opens a level.
- **Build**: `pnpm tauri android build --target aarch64`. Rust-only check: `cargo check --target aarch64-linux-android` with NDK clang env vars.

## Reference Projects

- **Codex CLI** (`codex-rs/`): Apache 2.0. Port provider abstraction, SSE parsing, MCP patterns. Don't depend on it directly.
- **foxline-pro-backend-server**: Our Python SaaS backend. Borrow provider design (STI polymorphism), streaming architecture (Kafka+Redis), tool system patterns. Rewrite in Rust.
- **Cherry Studio**: AGPL, do NOT use any code. Reference for feature scope only.

## Development

```bash
pnpm install
pnpm tauri dev        # Start dev (needs MERIDIAN_API_KEY env var)
```

**`@heroui-pro/react` is a stub on npm.** The package published to the registry
contains nothing but a `postinstall`; the components are staged into it
afterwards by `hpsetup`, out of band. So any install that *rebuilds*
`node_modules` — rather than adding to it — leaves the package empty, and every
Pro import fails at once. Re-run the setup after one:

```bash
HEROUI_KEY=<key> pnpm dlx hpsetup@latest react --auto
```

`ls node_modules/@heroui-pro/react/dist/components | wc -l` says which state it
is in: 68-ish directories means staged, `dist/postinstall` alone means stub.
Incremental installs are unaffected. `ERR_PNPM_IGNORED_BUILDS` on every install
is expected — those two build scripts are declined on purpose (see
`pnpm-workspace.yaml`), and the exit code is 0.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MERIDIAN_API_BASE` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `MERIDIAN_API_KEY` | (required) | API key |
| `MERIDIAN_MODEL` | `gpt-4.1-mini` | Model identifier |

## Roadmap: the desktop as a control plane for many agents

Not built. This is the direction the hook gates are a first step toward, written down so
it is not re-derived from scratch.

**The problem is attention, not capability.** People already run tens of coding agents at
once — thirty concurrent Claude Code sessions in one team. Terminal windows do not scale
to that: you cannot tell what each is doing, and the one blocked on a permission prompt
is indistinguishable from the twenty-nine that are working. The scarce resource is
knowing *which one needs you*. A sidebar of named threads with the blocked one's approval
card next to it is the whole product.

**The two halves cost wildly different amounts, so keep them apart.**

*Observation is nearly free.* Claude Code writes one live JSONL per session under
`~/.claude/projects/<project>/<session-id>.jsonl`, carrying `cwd`, `gitBranch`, `slug`,
`timestamp` and each message. Tailing those gives the thread list, what each is working
on and how recently — with no protocol, no daemon, and no change to how sessions are
launched. They can be started from any terminal, on any project. (`~/.claude/daemon/roster.json`
is the background-task supervisor, not a registry of interactive sessions; do not build
on it expecting to find them there.)

*Approval needs a live channel, and we already built the mechanism.* A `PermissionRequest`
hook that blocks, posts, and returns a decision is exactly what the plan gate is. The
generalisation is to ask the human instead of a model: hold the request, draw a card
beside that thread, send back what they click. Meridian already has the approval-card UI
and, in `onebot`, a `PendingApprovals` that parks a request until an answer arrives.

**The fail-open rule inverts here, and this is the one thing that must not be got wrong.**
Everything in `hooks/` lets the action through when it is unsure, because the cost of a
missed review is one missed review. A permission prompt is the opposite: one that
proceeds on timeout is not a permission prompt at all, and what it guards is
`run_command` and writes. On that path, "nobody answered" must mean **deny**. Claude
Code's own default for a timed-out hook is to proceed — verify how that interacts before
building anything on it, and do not ship if it cannot be made to fail closed.

**Design the queue around "a pending request from some agent", not around Claude Code's
payload.** Codex, OpenCode and the rest each need an adapter; the queue, the cards and
the status derivation should be shared. Shaping the queue to one vendor's hook format
means rewriting it for the second.

**Order of work**, cheapest and most useful first:

1. Read-only session panel — tail the transcripts, list live sessions. No protocol, no
   risk, and it solves half the thirty-windows problem on its own.
2. Approval queue — forward `PermissionRequest` to Meridian, card beside the thread.
   Settle the timeout semantics first.
3. Hosting a session in-process — last, because it is the only step that asks the user to
   move their daily coding into Meridian.

**On hosting, correct a common wrong turn.** VS Code and Zed do not GUI-ify the CLI. The
*editor* drops a lockfile in `~/.claude/ide/` and acts as the server; Claude Code runs as
its own process and connects to it for editor context and diff views. Copying that shape
gives Meridian no session-lifecycle events. Hosting means driving `claude` headlessly
(`--print --output-format=stream-json`) and owning the event stream — a documented
interface, unlike the IDE socket. Meridian's tool surface already mirrors Claude Code's
(plan mode, todos, sub-agents, patches), so the cost is an adapter rather than a second
frontend. Two things to verify before committing: whether permission requests surface in
a form an external UI can answer, and whether driving the CLI from another app fits the
subscription's terms.
