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
- **Branches switch the transcript, not the world.** The todo list, approved plan and collaboration mode stay per-conversation and do not follow a branch switch. Files edited and commands run cannot be rewound either, so making these alone branch-aware would imply more than actually happens.

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
- **base-ui is down to `ui/context-menu.tsx`** — HeroUI's menus are click-triggered and have no right-click equivalent. Don't reach for base-ui anywhere else.
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

## Android

- **File access model**: tools resolve paths through `ToolContext::resolve_and_validate` (`src-tauri/src/tools/mod.rs`). Desktop = `FileAccess::Unrestricted` (legacy working_directory check). Android = `FileAccess::Roots` whitelist built in `build_file_access` (lib.rs) from preferences `android.manage_storage_enabled` / `android.saf_roots` + the system grant. SAF I/O goes through `src/android_bridge.rs` (JNI) → `FileBridge.kt`.
- **run_command is compiled out on Android** (`#[cfg(not(target_os = "android"))]` in tools/mod.rs).
- **Hand-maintained files inside `src-tauri/gen/android/`** (tracked in git; if `tauri android init` is ever re-run, merge these back manually): `app/src/main/AndroidManifest.xml` (storage permissions), `app/src/main/java/cn/yuxiaoqiu/meridian/MainActivity.kt` (SAF picker + `nativeOnSafResult`, window insets, and `handleBackNavigation`), `FileBridge.kt` (ContentResolver ops), `app/build.gradle.kts` (androidx.documentfile dependency).
- **The back key is the web history.** `WryActivity` routes it through `WebView.canGoBack()`, the generated `TauriActivity` disables that, and `MainActivity` turns it back on. So a screen is reachable by the back gesture exactly when something pushed a `history` entry for it — see `lib/history-bridge.ts`, which is the only writer, and `useHistoryLevel` for the levels that live inside a screen (a detail pane, a drawer, a non-empty selection). Never call `history.back()` anywhere else: the store is updated from `popstate` alone, which is what keeps it from drifting.
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
