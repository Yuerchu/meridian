# Meridian

Multi-provider AI desktop client with coding agent capabilities.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Tauri v2 (Rust backend + WebView frontend) |
| Frontend | React 19 + TypeScript + Vite |
| UI | Tailwind CSS v4 + self-built components (React Aria) + boardui design conventions |
| Backend | Rust (tokio async runtime) |
| AI Streaming | reqwest + eventsource-stream (SSE) |
| Database | SQLite (planned) |
| License | AGPL-3.0-or-later (dual licensing available) |

## Architecture

```
src/                        # React frontend
src-tauri/
  src/                      # the shell: the only place that knows about Tauri
    lib.rs                  # setup, tray, window, generate_handler!, APP_HANDLE
    commands/               # #[tauri::command] entry points
    platform.rs             # platform detection + Android storage commands
    android_bridge.rs       # the Java_* symbols MainActivity.kt calls back into
  crates/                   # git submodule: github.com/Yuerchu/meridian-core (Apache-2.0)
    core/                   # meridian-core: everything framework-free
      migrations/           # the 65 Diesel migrations, frozen: db/sea/bridge replays them, the SeaORM baseline replaces them
      src/
        agent/engine/       # the turn loop, and the ports the runners plug into
        db/ provider/ tools/ mcp/ secrets/ …
        onebot/ hooks/      # the two non-desktop runners
        acp/                # hosting another coding agent, as its client
        services.rs         # every long-lived thing, in one value
        events.rs           # EventBus: where an event goes once it has happened
        bootstrap.rs        # bootstrap(data_dir, events) -> Services
    sandbox-types/          # sandbox policy types
    sandbox-windows/        # Windows sandbox implementation
  ime/                      # the input method: workspace members of the shell, not of core
    dict/ engine/ session/  # platform-free: .mdict format + Rime import, keys→candidates, the key state machine
    proto/ config/          # the pipe protocol; host.json and the data directory
    tsf/                    # meridian_ime_tsf.dll: the TSF text service (no engine inside)
    host/                   # data dir → engine (lib, both hosts); meridian-ime-host.exe: pipe server, candidate window
    lm/                     # the language model scorer: bundles, ONNX Runtime loaded at run time
    cli/                    # meridian-ime: import / lookup / type / keys / bench, with no OS in the loop
    android/                # libmeridian_ime.so: the Android keyboard's engine and its JNI surface
```

**`src-tauri/crates` is another repository.** Everything below the Tauri line is
open source under Apache-2.0 and lives in `Yuerchu/meridian-core`; this
repository pins a commit of it as a git submodule, and the shell depends on
the crates by path exactly as before. Three things follow. Clone with
`--recurse-submodules` (or `git submodule update --init` after the fact), or
`cargo` reports every `meridian_core::` import as unresolved. A change to the
core is committed *there* first, then the pointer is bumped here — and the
contract checks read the pinned commit, not the submodule's working tree
(`scripts/staged-snapshot.mjs`), so a bump whose commit is not yet in the
submodule repository is refused. And the two workspaces have separate lock
files: `src-tauri/Cargo.lock` for the app and `src-tauri/crates/Cargo.lock` for
the core on its own, kept in step by hand.

## Design notes

Most of this file's design record lives in `.claude/rules/`, one file per
subsystem, moved there verbatim when this file outgrew the context budget. Each
file's `paths` frontmatter makes Claude Code load it when a matching file is
read; the globs are a floor, not a boundary. **Read the file for an area before
changing anything in it**, whether or not it was loaded for you: each one
records decisions whose failure is silent, and the test suite does not pin all
of them. Another agent that does not read `.claude/rules` (Codex, via
`AGENTS.md`) has to open them from this table.
A reference elsewhere in the tree to "CLAUDE.md, <section>" (the Packaging
section, UI Conventions, the base layer's interaction contract, …) means the
section of that name in one of these files.

Keep it that way. This file carries only what every change needs — the stack,
the layout, the hard contract rules, the core decisions, logging, development.
A new decision about one subsystem goes into that subsystem's file.

| File | Read before touching | Covers |
|------|---------------------|--------|
| [`frontend.md`](.claude/rules/frontend.md) | the composer, transcript, scroller, links, settings pages, app shell, approval notifications / inbox | `@` `/` `!` prefixes, assistant links, the scroller, settings stack and rows, one shell, the attention queue, chart colours |
| [`ui-conventions.md`](.claude/rules/ui-conventions.md) | any UI, styling, `components/base/`, `boardui.json`, the lint rules | BoardUI as constitution, tokens, bubbles and tool blocks, sub-agent groups, radius/type/motion, icons, fonts, lint gates, playgrounds |
| [`providers-and-billing.md`](.claude/rules/providers-and-billing.md) | `provider/`, `agent::pricing`, audit/usage, model configs and profiles | side-request billing, model profiles, output ceilings, pricing and tiers, reasoning tokens, provider-side tools, wire DTOs, `phase`, tool `description`, balances, cache keys |
| [`onebot.md`](.claude/rules/onebot.md) | `onebot/`, QQ tools, voice capture, `send_voice` | per-session tool prefix, quoted messages, the voice corpus, `send_voice` readiness, directed calls |
| [`approvals.md`](.claude/rules/approvals.md) | `agent/auto_review/`, `crate::approval`, `agent::denied`, `agent::call_identity` | automatic approval review, how long a question stands and who may end it |
| [`acp.md`](.claude/rules/acp.md) | `acp/` | hosting Claude Code, elicitation, sessions and resume, import, the tool bridge |
| [`prompt-queue.md`](.claude/rules/prompt-queue.md) | `queued_prompts`, `agent::queue`, steering | follow-up vs interject, claims, holds, in-doubt delivery |
| [`plan-documents.md`](.claude/rules/plan-documents.md) | plan mode, `plan_documents`, the review page | durable plan documents |
| [`hook-gates.md`](.claude/rules/hook-gates.md) | `hooks/`, the `meridian-plan-gate` plugin | the loopback review gates |
| [`container.md`](.claude/rules/container.md) | `crate::container`, sandbox settings, a hosted agent in Docker | container execution, cancellation, no host fallback |
| [`remote.md`](.claude/rules/remote.md) | `src-tauri/src/remote/`, `lib/transport.ts`, `command_table.rs` | remote access |
| [`ime.md`](.claude/rules/ime.md) | `src-tauri/ime/`, `src/ime/` | the input method |
| [`android.md`](.claude/rules/android.md) | `gen/android/`, `android_bridge.rs`, `platform.rs`, the keyboard's Kotlin | file access, the keyboard process, insets, back gesture |
| [`packaging.md`](.claude/rules/packaging.md) | `tauri*.conf.json`, `nsis/`, `wix/`, release workflow, sherpa-onnx, IME builds | what each platform ships, the IME installers, the Android keyboard build |
| [`schema-canvas.md`](.claude/rules/schema-canvas.md) | any migration, `schema-data.ts` | the schema canvas and its checker |
| [`roadmap.md`](.claude/rules/roadmap.md) | planning multi-agent or remote work | the desktop as a control plane |

## Key Design Decisions

### Hard model and protocol standards

- **Names state the layer and operation.** Persistence structs are
  `EntityRow` / `EntityInsert` / `EntityChangeset`; command inputs are
  `EntityCreateRequest` / `EntityUpdateRequest` / `EntityUpsertRequest`;
  public entity snapshots are `EntityInfoResponse` / `EntityListResponse`; bus
  payloads are `EntityEvent`. Do not introduce `NewEntity`, `EntityPatch`,
  `EntityInput`, bare persistence entity names, or a generic `Dto` suffix.
- **Persistence rows never cross IPC.** Tauri and remote commands map rows into
  explicit response contracts. Adding a database column must not implicitly
  add a public field.
- **JSON storage is not a public string contract.** A column may use `TEXT` to
  store a JSON object or collection, but requests and responses expose its typed
  object/array form. Decode errors fail the boundary; they never become `{}`,
  `[]`, a default value, or an opaque JSON string. In particular this applies to
  assistant tool lists, tool presets, model capability/pricing/tool settings,
  and MCP args/env/headers.
- **No forward-compatibility fallbacks in first-party contracts.** Unknown enum
  variants, discriminator values, object fields, malformed JSON, and obsolete
  aliases are errors. Do not guess a default, silently drop a value, accept both
  old and new spellings, or keep legacy event tags. A contract change updates
  every producer and consumer in the same change.
- **Every monetary value is Decimal.** Prices, costs, balances, amounts and
  monetary rates use exact base-10 values. Persisted/configurable values obey a
  `NUMERIC(38,18)` boundary contract; calculated costs may carry additional
  fractional digits rather than round early. SQLite stores canonical fixed-point
  `TEXT`; JSON/IPC uses decimal strings; TypeScript performs authoritative
  arithmetic with integer-scaled decimal helpers. `f32`, `f64`, JavaScript
  `number`, `REAL`, `parseFloat` and `Number(...)` are forbidden for money.
  `NULL` means an unknown/unconfigured price and `"0"` means an explicit zero
  price. A nullable monetary request key is still required: omission is not a
  second spelling of `null`.
- **Every `api.ts` invoke response is runtime-validated.** The checked-in
  generated exact schema covers the complete reachable response type for every
  command, and the same validator guards local Tauri and remote `{ ok }`
  answers. After changing `api.ts` or `types.ts`, run `pnpm responses:generate`
  and `pnpm responses:check`; a generic cast or `unknown` passthrough is never a
  substitute for validation.
- Run `pnpm contracts:check` after model or protocol changes. It enforces these
  naming, strict-object and monetary representation rules and also runs against
  the staged snapshot in the pre-commit hook. The guard's syntax helpers have
  focused fixtures under `scripts/model-contract-rules.test.mjs`; run them with
  `node --test --test-isolation=none scripts/model-contract-rules.test.mjs`.

### Core decisions

- **Pure Rust backend**: No Python sidecar, no Codex submodule. Selectively port useful patterns from Codex (Apache 2.0) into our own code.
- **Local-first + optional cloud**: Default standalone desktop app. Optional connection to foxline-pro backend for billing, collaboration, multimedia generation.
- **Streaming via events**: the backend streams answers on the `chat-stream` channel and the frontend `listen()`s. Emit through `services.events`, never `app.emit` — see the bus below.
- **Multi-provider**: OpenAI-compatible base, extend to Anthropic/Google/Ollama etc.
- **The shell is what knows about Tauri; nothing under it does.** `agent/engine` carried this as a rule in its header for a long time — nothing in the turn loop may know about the framework — and noted that the rule is about the *import graph* rather than the text, because a file with no `tauri::` in it can still pull the whole thing in through one type. It had already been broken exactly that way once. It is a crate boundary now: `meridian-core` has no tauri dependency, so a violation is a build failure rather than something review has to catch.

  What that leaves in `src-tauri/src` is `lib.rs`, the IPC commands, `platform.rs` and the `Java_*` entry points. Everything a turn actually does is below the line. The one global, `APP_HANDLE`, lives up here for `android_bridge`, which is called from Java on a thread the app did not start and so has nowhere else to reach the app from.

  Reaching the app is otherwise `Services` (`services.rs`): one `Arc`, cheap to clone, holding the pool, registries, coordinators and `paths`. The shell converts a handle into one with `app.services()` and that is the only place a handle is used as a locator. `bootstrap(data_dir, events)` builds it; the shell answers only the question the framework alone can — where `data_dir` is.

  `commands/` stays in the shell whole. Splitting it into core functions plus wrappers was planned and turned out not to be needed: core's only dependency on it was two pure functions that belonged in `agent::skills` anyway. It becomes necessary the day something without a window needs to serve commands — a headless server — and not before.

- **`EventBus` is a sink registry, not a broadcast channel, and that is load-bearing.** The desktop's events *are* its answer: a window that missed one is showing a transcript that never catches up, so the turn producing it has to fail. A `broadcast` makes every send infallible from the sender's side and cannot express that. So delivery is synchronous and a sink is registered `critical` or not — `WindowSink` is, and that registration is where the rule now lives.

  The opposite case is just as deliberate. OneBot, the hook reviewer and sub-agents each emit to a window that may not be looking, and for them a failed send costs nothing; their `Emit` implementations swallow it and return `Ok`. Handing those three `BusEmit` would quietly turn "the window is closed" into "the sub-agent's turn failed". If you add a runner, decide which of the two it is before wiring the bus in.
- **Messages are a tree, read as one path.** Each row has a `parent_id`; each conversation has a `head_message_id` naming the leaf its active path ends at. Regenerating or editing writes a sibling and leaves the original reachable. Read a conversation with `db::ops::message::active_context` — `sort_order` is insertion order, not transcript position, once branches interleave. Write only through `append_message`, which links the row and moves the head in one transaction. Delete only whole subtrees: dropping a lone row strands its tool results or leaves an answer to nothing. `parent_id` carries no foreign key on purpose (see migration 21).
- **Branches switch the transcript, not the world.** The todo list, approved plan and collaboration mode stay per-conversation and do not follow a branch switch. Files edited and commands run cannot be rewound either, so making these alone branch-aware would imply more than actually happens.
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
  - **The checklist is frozen the same way.** `<todo_list>` used to sit at the
    end of the system prompt, and `update_todos` rewrites it several times a
    turn — so every turn after a change missed the cache from the system block
    on, which is to say entirely. `agent::todo_context` writes it as a
    `role="context"` row (`source="todo|list"`, or `todo|none` for the cleared
    marker sent once after a frozen list is finished), after the memory row and
    before the message, and only when it differs byte for byte from the most
    recent frozen one on the live path. One rule covers compaction and trimming:
    no frozen row on the live path means write the full block. The trailing
    order is fixed and tested — memory → todo → interrupted → message → roster —
    because the two persisted blocks stay where they land. `<approved_plan>` is
    still in the prompt; it changes once per implementation and can afford to be.
  - **A user message carries its send time, rendered from the row.** There is
    no clock in the system prompt — the template variables that put one there
    are gone, and a persona is sent exactly as written. Instead every persisted
    user message renders `<sent_at>…</sent_at>` from its `created_at`
    (`provider::format_sent_at`: local date, weekday, time to the minute, UTC
    offset), so the model knows when each thing was said and, from the newest,
    roughly what time it is. The marker is part of the cached bytes, so the live
    turn and the replay have to agree: `agent::persisted_user_message` is the one
    constructor for both, every live path carries the instant it writes as
    `created_at` into the `ChatMessage` (`Steered::received_at`,
    `IncomingMessage::received_at`, the desktop's `sent_at`), and the gates
    compare the two renderings on a fixed past instant — at minute resolution,
    two clock reads would agree by luck.

## Logging

`tracing` events at info and above go to `{app_data_dir}/logs/meridian.log` as JSONL, rotated by size (5 MB × 5). The user reads them in Settings → About → View logs; the assistant reads them through the `read_app_logs` tool, which the `meridian-diagnostics` skill drives. All three share `logging::reader::query`.

- **Never log message bodies, prompts or tool output.** Log a length instead (`chars = body.chars().count()`). Exported logs leave the machine.
- Credentials are redacted by field name plus `secrets::sanitizer::redact_secrets`, but do not rely on it — don't put a key in a log line to begin with.
- `error = %e` beats `format!("{e}")`: the visitor walks `source()` and records the whole chain.
- Open a span where a request begins (`info_span!("chat", conversation_id = %id)`). Everything logged underneath inherits it, which is what makes "why did *this* conversation fail" a single query.
- New call sites default to `debug!`. Only user-visible state changes and failures earn info and above, because only those reach the file.
- `RUST_LOG` steers stdout only. The file level is the `logging.level` preference, so a debug session cannot evict the records it was meant to keep.

## Reference Projects

- **Codex CLI** (`codex-rs/`): Apache 2.0. Port provider abstraction, SSE parsing, MCP patterns. Don't depend on it directly.
- **foxline-pro-backend-server**: Our Python SaaS backend. Borrow provider design (STI polymorphism), streaming architecture (Kafka+Redis), tool system patterns. Rewrite in Rust.
- **Cherry Studio**: AGPL, do NOT use any code. Reference for feature scope only.
- **sunime** (`~/Documents/Code/sunime`): the author's own 2026-07 input method
  prototype (GPL-3.0-only, sole author). Its FST dictionary, syllable DAG and
  beam search were the starting point of `ime/dict` and `ime/engine`; its IPC
  and host were replaced.
- **qingjian** (`~/Documents/Code/qingjian`): GPL-3.0-or-later. Design read for
  the input method — engine out of the DLL, host-drawn candidates, settings
  over the protocol, asynchronous edit sessions, Windows packaging pitfalls —
  no code taken.

## Development

```bash
git submodule update --init   # src-tauri/crates is the meridian-core repository
pnpm install
pnpm tauri dev        # Start dev (needs MERIDIAN_API_KEY env var)
```

The Rust suite is two runs: `cargo test` in `src-tauri` covers the shell, and
`cargo test --workspace --target-dir ../target` in `src-tauri/crates` covers
the core (the shared target directory is what keeps the second from
rebuilding everything). The core repository has its own rustfmt/clippy
pre-commit hook under `.githooks/`; the hooks here do not reach inside it.

**The Rust version is pinned, in two files kept in step.** `rust-toolchain.toml`
at the root and in `src-tauri/crates` both name one release; rustup picks it up
for every `cargo` here, and CI installs it with a bare `rustup toolchain install`
rather than `stable`. A floating `stable` failed CI twice on code nobody had
touched, each time a release added a clippy lint that an older local stable
could not see. Upgrading is its own change: bump both files and fix what the new
clippy reports, in the same commit. Android and 32-bit input-method builds need
their target added to that toolchain once (`rustup target add
aarch64-linux-android i686-pc-windows-msvc`).

**boardui is source in the tree, not a dependency.** `npx boardui add -d src <name>`
writes a registry item under `src/components/base/<group>/` and installs its npm
dependencies; no component is fetched at build time and no key is needed for
the free registry. Pro items need `npx boardui login <key>` once per machine. An
installed file carries only the React Aria contract and its recorded patches
(see "UI Conventions"), is listed in `boardui.json`, and must not be re-added
with `--overwrite`. `pnpm boardui:drift` compares every listed file with the
registry; it needs the network and fails without it.

**The fonts are fetched, not checked in.** `predev` and `prebuild` run
`scripts/fetch-fonts.mjs`, so the first `pnpm dev` (or `pnpm tauri dev`)
downloads about 450 MB of publisher archives into `.cache/fonts/` and extracts
the font files and their licences into `public/fonts/`. After that a run touches no network: a
cached archive or extracted file whose sha256 matches is not fetched again.
Offline with an empty cache, `dev` and `build` fail rather than start with
system fonts — deliberately, since a fallback would look fine on the machine
that produced it. `pnpm fonts` runs it on its own. Why they cannot be in git is
under "Fonts" in "UI Conventions".

**`pnpm dev` in a plain browser runs on demo data.** With no Tauri shell to
answer, `lib/transport.ts` hands every `invoke` and `listen` to a fixture
backend in `src/dev/demo/` — conversations in every shape the transcript draws,
settings pages with rows in them, approvals and a plan review waiting — and a
"演示数据" tab hangs in the gutter above the frame so nobody mistakes it for a
real backend. Three conditions all have to hold: a `DEV` build, no
`__TAURI_INTERNALS__`, and no remote configuration; `test` mode and
`#playground/*` are excluded, so neither the suites nor the playground frames
change. Sending a message replays a recorded turn (reasoning, a tool, a second
round, a command waiting for approval); writes live in memory until the page
reloads. `?demo=quiet` starts with nothing waiting on an answer, for
screenshots without approval toasts over them.

The fixtures are held to the backend's contract, not a looser one: every answer
goes through the same `assertInvokeResponse`, every event through the same
`parseAppEventPayload`, and `src/dev/demo/demo.test.ts` calls every handler
(and hydrates every snapshot through the store's own checks), so a fixture that
drifts — a price as a `number`, a field the schema dropped — is a red test.
Money is a Decimal string there too. A command with no handler answers `null`
or `[]` when its schema allows one, and otherwise rejects with
`DemoUnsupported: …`, which the page shows as an ordinary error. A handler
without a sample call in that test fails it. None of it ships:
`DEV` is a literal `false` in a release build, so the dynamic import is never
emitted — `grep -r demo-conv-scroller dist` after `vite build` finds nothing.

**The demo data is also what the visual baselines photograph.** `pnpm
test:visual` runs Playwright (`playwright.config.ts`, `e2e/`) against the demo
backend: every scene in `e2e/visual.spec.ts` — shell, transcripts, approvals,
inbox, menus, dialogs, plan review, the main settings pages — once in each
theme at 1280×800, and the ones tagged `@narrow` again at 390×844. This is the
gate for what tsc, eslint and vitest cannot see: a button that turned the
accent colour, a field that vanished into its card, spacing that drifted. The
clock is frozen with `page.clock` (the fixtures are relative to `Date.now()`),
timezone, locale, pixel ratio and motion are pinned, and the dev server runs
from `e2e/vite.config.ts`, which pre-bundles every dependency and turns HMR
off so no reload lands mid-test. **Baselines are per platform** under
`e2e/__screenshots__/<platform>/`: Windows and Linux rasterise fonts too
differently to share one, so each is compared only with itself. `win32/` is
made locally; `linux/` is CI's (the `visual` job), bootstrapped by running CI
with `update_visual_baselines` — or automatically when the directory does not
exist — and committing the `visual-baselines-linux` artifact it uploads.
Update baselines with `pnpm test:visual:update` only when a change is *meant*
to move pixels, look at every image it rewrote before committing it, and
update both platforms in the same change. It rewrites *every* image (`--update-snapshots=all`, as CI does), not only those past the 0.2% tolerance: the default mode left scenes that had moved by less than that on images of the old UI — the narrow provider list kept blank logo slots that way. A failure's expected/actual/diff
triple is under `test-results/` (CI: the `visual-diffs` artifact).

`pnpm add` / `pnpm update` on Windows fails outright with `ERR_PNPM_EPERM` if a
`vite`/`tauri dev` is running, because the dev server holds
`@rolldown/binding-win32-x64-msvc`'s `.node` open. Stop the dev servers first.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MERIDIAN_API_BASE` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `MERIDIAN_API_KEY` | (required) | API key |
| `MERIDIAN_MODEL` | `gpt-4.1-mini` | Model identifier |
