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
      migrations/           # embed_migrations! resolves against this crate root
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
- **The composer's three prefixes are control syntax, not model conventions.** `@` is parsed beside the visible prompt and resolves only through the conversation/project workspace; the backend freezes the selected file or directory before it writes the user row. `message_context_items` (migration 45) follows that row's branch and ordinary transcript DTOs expose descriptors only. Raw contents are rendered as `UserProvidedContext` inside `<untrusted_context>`, never as system instructions, and are bounded per reference, per turn and by the selected model's context budget. A queued follow-up freezes the same bytes when it enters `queued_prompt_context_items` (migration 47), not when it eventually runs; an interjection or in-flight steer refuses `@` because there is no new turn boundary at which to attach it.

  `/` is a frontend-owned command registry shared by completion and dispatch. A command is either immediate (`/help`, `/settings`, `/new`) or idle-only (`/compact` and turn configuration), and an unknown command is an error rather than a delayed prompt. Hosted sessions resolve model/mode/effort values from ACP's live configuration options instead of hardcoding Claude Code's current list.

  `!` is a literal user command, not a request for the model to call a tool. `run_user_command` takes the same per-conversation lease, project cwd, configured shell, timeout and sandbox/container path as `run_command`; only the exact persisted Windows restricted-token denial can be retried on the host, after a second confirmation. The visible `source = shell` row and its structured `shell_output` item make the operation idempotent by turn UUID, survive reload, and stay out of audit/training export. Native history reads the final attempt as untrusted user context. A hosted ACP session uses `acp_context_deliveries` (migration 46) to put undelivered shell results in front of exactly the next prompt whose adapter reply proves it was read. Standalone Android refuses the operation; a remote Android client routes it to its desktop host.
- **Assistant links never navigate the WebView.** Markdown targets are classified before activation: `http(s)` opens through the shell plugin, project-looking paths open the transcript's file-preview sheet, fragments scroll in place, and every other scheme becomes inert text. Plain path-shaped mentions are transformed at the Markdown AST text-node layer, so code fences, images, existing links and unfinished streaming blocks cannot be mistaken for files; before a candidate becomes interactive, a metadata-only workspace probe runs the same lexical/no-follow containment checks as the authoritative reader and confirms that the object exists. Probe promises are coalesced per conversation and path, while failures remain ordinary text rather than opening an error sheet. The compact label uses the existing Material Icon Theme lookup and keeps the full path in its accessible name/tooltip. Source previews reuse the app's bounded Shiki highlighter and show the complete bounded file prefix, using any cited range only for scrolling and highlighting. Markdown and HTML add a code/rendered switch; Markdown disables recursive file activation and implicit remote images, while HTML is staticised into a zero-network `srcDoc` under an empty iframe `sandbox`.
- **The transcript follows the stream, then hands it back.** `src/lib/message-scroller.tsx` is a fork of `@shadcn/react/message-scroller` (the package is gone; the styled wrapper in `components/ui` is unchanged). Upstream anchors a new turn to the top of the viewport and holds it there for as long as the answer streams — with a question taller than the viewport that hold never releases, so the whole answer is written off-screen. Here there are two modes: `follow` sticks to the live edge, `idle` moves for nobody but the reader. Anchoring falls out of following instead of competing with it — a spacer re-solved every frame makes "scrolled to the end" and "question at the top" the same position until the answer outgrows the viewport. A turn that stops streaming while the reader is still following scrolls back to the top of its answer (`MessageScrollerAnchor` / `answerAnchorId`); one they had scrolled away from does not move. Row identity is not a scroll trigger: re-keying a row when its reload lands used to jump to the top of the conversation. Drive changes through the harness at `#playground/scroll` — "跑全部场景" replays every behaviour above and asserts it.

  **The scroller owns the scroll position, and two things follow from that.** The viewport sets `overflow-anchor: none`: with fractional row heights the browser's own anchoring nudged `scrollTop` by a device pixel while the spacer was being re-solved, and an upward nudge that landed in the same event as the answer row appearing read as the reader leaving the live edge. Growth or shrink above an `idle` reader is compensated by `useHeightCompensation` and by `LazyTurn`'s own swap instead. And `syncAfterScroll` reads two kinds of upward move as nobody's: a programmatic scroll's *landing* (the command that issued it already set the mode) and a *clamp* — the browser pulling `scrollTop` down to the end because the transcript got shorter, recognisable because it lands exactly where the end was at the previous event. Both used to lose a race in which following scrolled to the end, the answer row arrived before the scroll event fired, and the event saw "moved up, not at the end" — the reader's signature — in a move the scroller or the browser had made. Measured on the harness, where "尾部有状态行" caught it, one run in three.

  **`data-autoscrolling` is a smooth scroll only.** Following the stream is an instant `scrollTo` on every chunk, and the viewport hides its scrollbar thumb under that attribute — so for as long as an answer streamed the thumb blinked once per chunk, which is what "the page flickers at the bottom" was. Measured on the harness: fourteen toggles over one answer, none after. The component library this replaced never hid the thumb at all; here it is hidden only for a smooth scroll, which is the one kind that is a journey rather than a jump.

  **Turns the reader has not reached are boxes** (`LazyTurn` in `chat-transcript.tsx`). `content-visibility: auto` is the browser's version of this and crashes desktop WebView2, so it is done by hand: an `IntersectionObserver` with two screens of margin says when a turn has come near, and until then it renders a box of an estimated height in place of its rows. The forty-turn window measured four thousand DOM nodes and half a second to mount before; the last six turns are drawn from the first render because that is where the transcript opens. **Drawn once, drawn for good** — the first version boxed a turn again once it scrolled away, and that cost the stream its following: a turn above the viewport turning into a shorter box is a height change the browser's scroll anchoring answers by moving `scrollTop` up, and the scroller reads an upward move it did not make as the reader leaving the live edge. With growth the only direction left, the only anchoring adjustment is on a reader scrolling up into a box, who is `idle` already. Every turn keeps its scroller item and id, so anchoring, the outline and "load earlier" are untouched. "铺 200 轮" on the harness is the stress case, and "跑全部场景" is what caught the regression.
- **Settings is pages on a stack, at every width.** `settings/settings-stack.tsx` is the one navigation model: a list is a page, the thing you opened is a page over it, its sub-thing is a page over that. There used to be two — a list beside its detail above 536px of *measured pane* and a drilldown below it — which is two layouts, two sets of state to keep honest and a threshold to argue about. The stack replaced `useMasterDetail` for providers; `MasterDetail` and `SettingsDrilldown` survive only until assistants, the tool marketplace and the emoji settings move over (MCP moved in 2026-09).

  **Every level stays mounted and only the top is visible** (`hidden` + `inert`). Indistinguishable on screen from rendering the top alone, and it buys three things: a draft two levels down survives a trip into a sub-page, its dirty registration stays registered so the shell keeps refusing to leave settings, and there is one scroller — `[data-slot="settings-scroller"]` — rather than one per page. `hidden` also takes a covered page out of the accessibility tree, so a screen reader is on one page too.

  **The leave guard is about what is being discarded, not about what is dirty.** `pop` asks only when something *above the destination* has unsaved work, so returning from a clean sub-page onto a dirty parent asks nothing — the parent is still mounted and still holding its draft. `push` never asks for the same reason. `reset` is the unguarded unwind, for after a delete, where the question would be about a row that no longer exists. Pages register through `useSettingsDraft`, which writes to both the shell's per-tab guard and the stack's per-level one.

  **A refused back gesture has to give its history entry back.** `settleTo` retires a level *before* calling its dismiss, so a page that says "ask first" and is then told to stay would hold no entry and the next press would leave settings. The claim is dropped and restored on the next frame, which is a fresh false-to-true edge — the only thing `useHistoryLevel` re-registers on. `Sheet` does the same dance for the same reason; both are one implementation of it, not two.

  **Esc goes back one page on a desktop**, where there is no back gesture, and is declined twice over: `useHotkey` ignores an event something nearer the key has already answered (React Aria's dismissable overlays), and the stack ignores a press that landed inside a dialog (one whose keyboard dismissal is disabled and leaves the event untouched). Each fails alone, so each has its own case.

  **Each page fetches what it needs by id, and refetches when it becomes the top page again.** That is what removes the coordination: a rename or a delete is picked up with no callback threaded down and nothing to invalidate. The second half is `useSettingsResume`, and it is load-bearing rather than an optimisation — since every level stays mounted, a page returned to is the same React tree it was when it was covered, so its mount effect does not run a second time and nothing else was ever going to tell it. This entry used to say "a list refetches on every return", which was never true of a stack that unmounts nothing: a deleted provider stayed in the list it unwound onto, and a model priced for the first time still read "not configured" on the page underneath. Nothing auto-selects — opening a page nobody asked for puts a back button in front of somebody who has not gone anywhere.

- **A settings page is rows in cards** (`settings/primitives.tsx`, boardui's grammar): `SettingsSection` is a muted label over a `SettingsCard`, whose `SettingsRow`s divide themselves and whose left padding lives on the card so each rule stops short of its edge. A row's label is a `<p>`, so **the control names itself** — either with its own `aria-label` or by taking the ids the row hands to a function child. A row whose control does neither is a switch a screen reader announces as "switch", with nothing to say what it turns on. `stacked` is the exception for a control that cannot shrink, and drops it under the label below `@sm/pane`. `SettingsNavRow` is the clickable one, named by its label with its value as a *description*: concatenated, "gpt-5.6" beside "Priced" is announced as one word.

- **One shell, on every platform.** `components/layout/app-shell.tsx` is the whole frame; there is no mobile variant and nothing branches on width. The sidebar *is* the conversation list — a panel above 768px, `Sidebar.Mobile`'s sheet below it, both rendered from the same tree — and settings is a page beside the chat rather than a screen over it. The chat stays mounted underneath, `inert`, because unmounting it loses the composer draft and the transcript's scroll position. There used to be a stack of screens for phones, selected by a width read once at startup; that seam is what made a narrow Windows window and a tablet in landscape both wrong. What survives of it is `useHistoryLevel`, which is about the back gesture and not about layout.
- **A question waiting on a person is not part of a session.** `sessions[id].pendingApprovals` says which id a *card* is waiting for and is only ever written for a conversation somebody has opened — `ensureSession` runs when `ChatView` mounts, and `handleToolApproval` returned early without one. That is right for a card and wrong for everything else: with several conversations working at once, the ones that stop for permission are mostly ones nobody is looking at, so the event announcing them was being dropped entirely. The sidebar dot never lit for them either.

  So `attention` / `attentionOrder` sit beside `sessions` rather than inside one, and every path that retires an approval — result, stop, orphan, nested resolve — clears the queue *before* its `if (!session) return`. `ConversationIndicator` reads the queue, not the session. It has two exits: `approval-notifications.tsx` draws the front of it as a stack of BoardUI notifications, and the header's bell (`notification-inbox.tsx`, the registry's `NotificationBell` over its `NotificationCenter`) lists all of it. `commands::approval::all_pending_approvals` rebuilds it after a reload or a remote connect, since the announcing event is never replayed.

  **Order is ours, and both exits are derived from it rather than synchronised to it.** `pending()` in `layout/approval-queue.ts` is the one derivation: `attentionOrder` minus the review page being read, split into `listed` and `here` — `here` being what the conversation being read is waiting on (unless settings or a review has made its transcript inert). `ApprovalNotifications` renders the front `MAX_VISIBLE` of `listed` straight into the one `NotificationViewport` as children keyed by `approvalId`; the inbox renders all of `listed`, grouped into approvals (tool calls) and questions (`ask_user`, ACP elicitation, plan review), and says of `here` only how many there are, with a button that asks the transcript (`lib/pending-reveal.ts`) to scroll to the turn holding `targetApproval`'s question. Rows for `here` would be a second place to answer a card already in front of the reader. There is no second queue: the React Aria `ToastQueue` this replaced only offered `add` (which unshifts) and `close`, so it had to be cleared and rebuilt back-to-front on every change of the *sequence*, and a set diff there made "defer" silently do nothing. Now deferring is one store write and the same render reorders the stack, with the viewport's layout spring moving the rows that stayed. Every visible row is a full card with its own buttons; the rest of the queue is not drawn there but is in the inbox. The inbox has no read state (`readable={false}`): a question is never "read", only answered, and an answered one leaves both lists by the same store write. A question's time is `askedAt`, stamped once by the backend when the question is registered (`PendingApproval::asked_at`) and carried on both the announcing event and `all_pending_approvals`, so one rebuilt after a reload or a remote connect keeps the time it was asked; the client never stamps its own, which would call an hour-old question "just now". A plan review rebuilt from a snapshot still has `null`, because its register does not say. There is no general-purpose notice store — the viewport carries questions and nothing else.

  **A row may offer Allow/Deny only for a call that only reads, and only if it shows everything that call will do** (`attentionShape`, shared by both exits through `attentionActionIds`). Risk decides, not how many arguments there are: a short `run_command` fits a row and is still the call most worth reading in context. So the decision is offered only for a tool on `READ_ONLY_TOOLS` — `read_file`, `list_directory`, `search_files`, `glob`, and Claude Code's `Read`, `Glob`, `Grep` — and everything else offers only Later and View with a line saying why: running a command (`run_command`, `Bash`, `SlashCommand`), writing, editing, moving or deleting a file, `apply_patch`, network requests, MCP and custom tools, QQ writes, anything unrecognised, and any call asking to leave the sandbox (an escalation retry, or `dangerouslyDisableSandbox`). A read is decidable when the row draws all of it: the identifying argument, the description, and the arguments its `READ_ONLY_TOOLS` entry names — the ones that only narrow what is read, such as `search_files`'s required `path`, `Read`'s `offset`/`limit` and `Grep`'s filters, drawn under the call. Any other argument, a non-scalar under one of those names, arguments that do not parse, or a summary past `INLINE_DECISION_LIMIT` withholds the decision too. The inbox groups its rows under their conversation (`showGroups`), each group where its first question stands in `attentionOrder` and its rows in that order.

  **An answer has to retire the queue entry itself** (`retireAnsweredApproval`) — from the notification, from the approval card and from the `ask_user` form alike, since all three are places an answer can be given and none of them is on the queue's side of the wall. A delegated run's question is *asked* on the parent — `approval_adapter.rs` routes it there because nobody is necessarily watching the sub-agent — while its result and its stop are emitted on the sub-agent's conversation, and both retiring paths match on conversation id. Nothing would ever close it: a permanent dot on the parent and a dead row in the queue. For an ordinary approval the result does come, but minutes later, and in the meantime moving to another conversation would pop a notification offering buttons for a decision already made. What that call must *not* do is touch the card: clearing an ordinary card's `approval_id` leaves it at `status: 'pending'`, which `mapChatToolState` draws as `requires-action` — demanding an answer with no way to give one — and `handleStop` reads `pendingApprovals` to write off a call whose turn died before its result arrived.

  **Nothing on the stack ends a question except answering it.** "Later" sends a row to the back; the close button, labelled "ignore", takes it off the floating stack and *only* there — the entry stays in `attention`, so the inbox lists it and the sidebar dot stays lit, and `stackIgnored` is cleared by `retireAttention` together with the question. That is why the close button was allowed back: the objection to one was a dismissal that ended a turn's only visible sign, making a mis-click expensive, and this one ends neither. The stack is also not drawn while a modal overlay has made it `inert` (`useMadeInertByModal` watches the attribute React Aria sets, so a non-modal popover leaves it alone) — above the dialog it looked pressable and could not be reached. The conversation being read is excluded, because its card is already at the live edge. ("Card" throughout this entry: since the transcript became bubbles, the card is the key's panel under the bubble, with the decision row at its top — the queue's side of the wall is unchanged.)

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

  **The test is what a definition reveals, not which registry it came from**, and
  reading it as the latter cost a group `web_search` for no reason: its
  description is our own fixed prose, it reads nothing on this machine, and a QQ
  session's file access is an empty root set either way. On the actual test it
  belongs with the QQ tools. `OPEN_REGISTRY_TOOLS` is that list and
  `ToolExposure::Only` is how it is applied — narrowing what `enabled_tools`
  already allowed, so naming a tool there cannot hand back one the user switched
  off, and leaving `Permission::Ask` alone, so a search still asks first. What
  `offered` authorises is read back off `tool_defs` rather than off the constant:
  a tool advertised to the whole group and then refused at dispatch is a model
  calling it over and over in front of an audience.

- **A quoted message is content, not a citation.** `quote::fetch` parses what a
  reply quotes into an ordinary `ParsedMessage` and the caller merges its media
  into the turn. It used to be flattened with `segments_to_text`, which is right
  for something a person reads and destroys everything else: a quoted sticker
  arrived as the five literal characters `[动画表情]`. That is not an edge case
  on a phone, where QQ gives no way to @ the bot *and* attach a sticker in one
  message — quoting one **is** how a group member shows the bot a sticker, and
  the empty-body check dropped the whole gesture besides.

  Three things hold the merge together. The quoted message is processed *first*,
  because that is where its sentinels land in the enriched text, and both media
  lists are concatenated in that order. `align_sticker_ids` pads each side to its
  own sticker count — a short list does not lose an id, it slides every sticker
  after the gap onto somebody else's. And voice is transcribed against the
  *quoted* id, not the turn's, which is why `process_media` takes one rather than
  reading `event`.

  A reply can quote anything, so `parse_segments` covers what people actually
  send: cards (`json`/`xml` — the payload is a JSON document inside a JSON
  string, and its shape is set by whichever app built it), files with their
  names, red packets, locations, dice. Each of these used to fall through to
  `_ => {}` and produce an *empty* message, which then read as the bot ignoring
  you. A merged forward is the one that cannot be resolved in a pure function:
  `FORWARD_SENTINEL` holds its place and `expand_forwards` exchanges the handle
  for the messages, two levels deep and twenty messages wide, with media inside
  left as placeholders — there is no turn for those sentinels to be aligned
  against.

- **Voice is kept where it is allowed to be kept, and the allowlist is a
  permission rather than a filter.** `format.rs`'s `record` arm used to set a
  bool and drop the segment's `url`/`file`, so every voice note was transcribed
  and its audio thrown away. `capture.rs` keeps it — but only for a
  `(bot account, session)` on `onebot.voice_capture_sessions`, because what is
  stored is a recording of a real person.

  **The capture point is between `parse_segments` and the group gate**, and that
  is the whole of it: inside the gate covers only un-@'d group messages, on
  `process_media` only @'d ones, and either way the collection is a badly skewed
  subset of exactly the data that is meant to train something. It creates no
  conversation and reuses no media pipeline, so an @'d note is transcribed twice
  — one API call for a boundary that does not leak.

  **Two tables, because the same audio sent by two people is two captures.**
  `voice_blobs` dedupes bytes per `(account, session, format, sha)`;
  `voice_clips` records each occurrence with its own sender. One table keyed on
  the hash keeps only whoever arrived first, which makes "delete everything from
  this person" quietly incomplete and mislabels the training data. The account
  is a dimension of the key rather than a footnote — two bots pulled into one
  group are two independent consents.

  **Ownership is fenced per task.** `owner_token` is unique per claim and
  `fence_epoch` is monotonic, both in the WHERE clause of the publish. Recording
  a process id looks equivalent and is not: two tasks *inside one process*
  running `CAS WHERE owner = <old>` both write back the same value and both
  believe they won. `publish_blob` returning false means the task may neither
  publish nor write a clip.

  **One writer, enforced by an OS lock on the corpus directory** (`File::try_lock`,
  stable since 1.89, so no dependency). Holding it means "is this `.part` someone
  else's work or last crash's debris" — unanswerable with several writers — does
  not arise, and recovery can clear stale rows unconditionally. Losing it
  disables capture rather than degrading into cross-process coordination — and
  that includes *deleting*, which is `require_writer` in `manage.rs`. A second
  instance's in-memory barrier constrains the one holding the lock not at all,
  so a delete run from it would report success while the other kept recording
  into the same directory.

  **Revocation waits, and it is hot.** A `CapturePermit` is held from before the
  fetch until the row is written, so `revoke_and_drain` waits for work in flight;
  and since a fetch is slow, `still_authorised` is asked again before the commit.
  Both are needed — the permit makes revocation *wait*, the recheck stops a
  capture whose grant moved from being written anyway. `save_config` is one
  transaction and the refresh runs on save, because for a setting whose purpose
  is revocation, "I turned it off and it kept recording" is the only failure that
  matters. The drain has a ceiling: the barrier stops new captures either way,
  and the person who pressed Save should not wait on a stuck download.

  **That ceiling is why a permit carries a per-scope epoch and not just the
  generation.** A *delete* neither touches the allowlist nor advances the
  generation — it raises a temporary barrier, drains, deletes, and lifts the
  barrier again. The drain is bounded and a download is not, so a capture that
  outlives the whole delete wakes up to an allowlist and a generation identical
  to the ones it left with, writes its clip, and puts back the audio somebody
  just asked to be rid of — after the delete has already reported success.
  `Grants::scope_epochs` moves the moment a barrier goes *up*, so lifting it
  cannot hand an old permit back.

  **And the recheck is inside the write transaction, not before it.** Asked
  outside, the answer can expire while the task is still waiting on the database
  lock. Inside, a delete starting at the same moment can only queue behind this
  commit and then take the clip away with it — which is the outcome it should
  have. The same transaction is what makes `record_clip`'s check-then-insert
  safe, and what stops `tombstone_unreferenced` from collecting a blob that
  acquired a clip between its `SELECT` and its `UPDATE`. `commit` in `capture.rs`
  and `tombstone_unreferenced` in `db::ops` are both `immediate_transaction` for
  that reason; `storage_key` is one too, so two first-time captures cannot mint
  two different keys and scatter the directory names.

  **A `.part` is cleaned up by `Drop`, because the common path is the one that
  forgets.** Most captures end by finding the bytes already stored and hanging a
  clip on the existing blob — nothing in that path is thinking about the file
  this task just downloaded. What it leaves behind is a real person's recording
  sitting outside the database, where deleting cannot find it and exporting
  cannot see it.

  **`ready` means the bytes are still the bytes.** Both places that ask —
  recovery at startup, and reuse before hanging a clip on an existing blob — run
  the sha rather than comparing the length. Length only catches truncation, and
  a half-written crash, a bad sector or an overwrite can all leave it exact. For
  a training corpus that is the expensive direction: a missing sample is missing,
  a wrong one gets used.

  **`stop()` has to finish stopping before the next generation may start.** The
  shutdown signal reaches each connection's *read* loop, not just its sink:
  `split()` hands out two halves of one stream, so dropping the writer leaves the
  reader taking events with the outgoing generation's permissions. Then it waits
  for those readers and `quiesce()`s the corpus, because `start()`'s first act is
  a recovery pass that clears every `.part` and every `pending` row
  unconditionally — sound only when there is no writer left.

  **The corpus outlives the conversation.** Not `files/<conversation_id>/` —
  deleting a conversation `remove_dir_all`s that, `/new` scatters a group across
  several, and it is the trust root for `resolve_attachment_uri`. Deleting is a
  selector with no defaultable shape (`Option<String>` would make a lost field
  mean "all"), and it tombstones only blobs that `NOT EXISTS` any clip, since two
  senders can share one recording. Export pseudonymises **sessions as well as
  senders**: a private chat's `source_id` *is* the other person's QQ number, and
  it appears in both the manifest and the directory path.

  **So the pseudonym is the only name a session has outside this process.** The
  corpus page is reachable from a phone by design, so the list may not carry
  `bot_self_id` (the bot's own number) or `source_id` (in a private chat, the
  other person's); `CorpusSelector::Session` takes the same pseudonym back and
  `resolve_handle` recomputes the HMACs to find it, so no reverse table exists
  either. The one raw id on that page is the sender somebody types in themselves.
  `get_onebot_config` is `local` for the same reason and a worse one: it returns
  `access_token`, the credential `guard_preference` already refuses to let a
  remote caller *write*.

  **"Forget me" is one backend call, in the order that makes it true.** Sent as
  a delete followed by an opt-out, the barrier comes down before the list is in
  force, and anything captured in that window is a recording nothing will ever go
  back for — while the button has already said it was done. `manage::forget_sender`
  writes the opt-out and applies it *first*, so by the time the delete runs there
  is no path left that could produce a new one.

- **A tool that speaks needs four things present, and missing one removes it from
  three places.** `send_voice` needs the switch, a model, a voice id and the Fish
  Audio key; `SessionPolicy` is resolved once and read by `definitions()`,
  `ordinary_names()` and `execute()` alike. Filtering only the first is not a
  boundary — `execute` checks `Scope` and nothing else, so the model reaches the
  tool by naming it. The key is part of readiness, which is why the refresh reads
  the keychain rather than watching preferences: rotating a key is precisely the
  change that turns a working session into a failing one.

  Two generation checks, not one: the model may call this having read a
  description written under the old settings, and the voice can change again
  during synthesis. The limiter counts **attempts** and lives on `Services` —
  counting successes lets a failing model exhaust a paid quota at zero, and
  living on the per-round executor would make "once per turn" constrain nothing.

  **Both halves of the policy are installed on every start, and forgetting one
  is invisible.** `start()` used to push only the capture allowlist, so in a
  fresh process `readiness` stayed `None` and `send_voice` was withheld until
  somebody pressed Save again. That failure says nothing anywhere: the switch is
  on, the tool is absent, and the model cannot explain it because the tool is
  missing from *its* view too — asked, it answers that it has no voice tool.
  `get_voice_send_readiness` exists so the settings page can name which of the
  four is empty, since one of them is a keychain entry the page cannot see. And
  a placeholder is enough to cause it: the model box shows `s2.1-pro-free` in
  grey whether or not anything is typed.

  **The last authorisation check only counts up to the moment the frame leaves.**
  `call_api_to_conn_within` gives the enqueue its own short ceiling for that
  reason — a full queue would otherwise let a checked-and-approved voice message
  sit for the whole twenty-second deadline, across a revocation, a voice change
  or the switch being turned off. A voice reply that late is wrong anyway.

  **A failed opt-out read is not an empty opt-out list.** That table is normally
  empty, so "the query failed" and "nobody objected" produce the same value, and
  taking the first for the second restarts recording somebody who explicitly
  asked not to be. `refresh_voice_policy` returns `Result` and `save_onebot_config`
  passes it on — the config is already written by then, so a silent failure would
  read as a successful save that changed nothing.

  **Cues are enforced in the backend.** Fish's S2 reads bracketed text as
  free-form natural language, so a closed list written only into the description
  constrains nothing and an invented tag is read aloud.

  `s2.1-pro-free` is announced as free only until 2026-08-31, so there is no
  default model. mp3 rather than wav: sixty seconds of wav is 5.3 MB and 7.1 MB
  base64'd, travelling whole inside one websocket frame.

- **An answer goes back to the adapter that asked.** `broadcast` reaches every
  connection, which with two accounts means a question is answered first by the
  adapter that never heard of the `message_id` — with an error, which the single
  echo-keyed waiter takes — and an outbound message is sent by both. `PendingCall`
  adds `expected_conn` to the *value*, since the broadcast path has no connection
  to key on, and the dispatch check compares the source **before** removing the
  waiter.

  `DirectedCallOutcome` has four states because the fourth is the point:
  `DeliveryUnknown` means the frame is queued and may well have been acted on, so
  reporting it as an error is how the same voice message gets sent twice. An
  answer carrying no `retcode` maps there too. The pending table is a
  `std::sync::Mutex` so `WaiterGuard` can retire an entry from `Drop` — the call
  gets cancelled, and then no return path runs at all.

  `stop()` now closes what it stopped accepting. It used to drop the listener and
  leave every connection reading, handling events and holding its original
  permissions — so restarting to apply a setting ran the old generation beside
  the new one. Existing tools still broadcast; that is a separate debt.

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
- **A request nobody typed still costs money, and `chat` was where that money disappeared.** The summariser, the title generator and the automatic reviewer are all requests the app makes on its own behalf. Two of them called `ChatProvider::chat`, which returns a bare `String` — so their usage was discarded at the adapter boundary and reached no ledger at all. On a long conversation the summariser's prompt is the whole history being compacted, which makes it the single largest request this app sends; it appeared on no bill for as long as it existed, and a comment claimed the turn had already recorded it, which was never true.

  Both now go through `chat_with_tools` with an empty tool list, purely for the usage it hands back, and land in `audit_messages` through `record_side_request` under their own role. **The roles are the point**: `UsageDimension::Kind` separates answering the user from summarising, naming and reviewing, and `BILLED_ROLES` is the one list the reporting query filters on — a role missing from it is spend reported as nothing, which is exactly how these two went unnoticed. Mid-turn compaction is still unrecorded and says so at the call site: it runs inside a turn and has no row of its own to hang a cost on.

- **A model is described once; reaching it through a provider is another thing.** The same Claude answers on Anthropic, Vertex and Azure, and the same DeepSeek on its own API and on a dozen relays. `model_profiles` (migration 61) holds what the model *is* — the context window, the compaction threshold, the output ceiling, the capability patch and, usually, the prices. `model_configs` keeps what one provider calls it on the wire, which profile that is, and the two things that genuinely differ per door: the rates, when a relay really does charge its own, and the provider-side tools, which are a fact about the upstream rather than about the model.

  **Nothing outside `agent::model_config` reads `overrides_pricing`.** A row and its profile go in, an `EffectiveModelConfig` comes out, and the turn loop, `audit::prices_for`, `usage::current_prices`, the sub-agent catalog and the settings page all read the same answer. A reader that resolved it differently from the billing path would be a bill nobody could reproduce — the same reason `compute_cost` is the only place a cost is computed. The IPC response carries `effective_pricing` for that reason too: the client is shown the resolved rates rather than re-deciding which side of the switch they came from.

  **Overriding takes the whole rate set, gaps included.** Filling blanks in from the profile column by column looks more helpful and is not: a relay that charges its own input rate and nothing for cache reads would inherit the vendor's cache rate and bill against a cache it may not keep. And a row that does not override may not carry rates *at all* — the save refuses it — because a number kept in two places is a number that comes to disagree, which is the duplication the split exists to end.

  **The migration gives every existing row its own profile and merges nothing.** Two rows naming `claude-sonnet-5` may be two deployments with two windows; only the user can say. Merging is choosing an existing profile on the model page, and the profile the last model leaves is collected (`delete_if_unreferenced`) so the picker does not fill with descriptions of nothing.

  **The model list is `cached_models` ∪ `model_configs`, not the fetch alone.** The two tables have deliberately never been joined — one is what the provider announced, the other is what the user configured — and reading only the first is what made a preview model impossible to configure at all.

- **An output ceiling is resolved, never guessed.** `agent::resolve_max_tokens` is the one rule every request goes through — turns, sub-agents, titles, summaries, reviews: the assistant's own `max_tokens` when it set one, otherwise the model's maximum output (`max_output_tokens` on the model page, or the catalog's figure), and `resolve_turn_params` refuses a model that has neither. The Anthropic adapter, whose wire requires the field, refuses a request that arrives without it instead of sending 4096 — a guessed ceiling cuts answers short and says nothing. The hook reviewer and a sub-agent with no override of their own get the model's maximum, not the baseline assistant's smaller one.
- **A bill is priced once, in `agent::pricing`.** `compute_cost` carries a rule no summation expresses: a cached token bills at the cache rate *instead of* the input rate, not on top of it. That formula has been wrong once — the old one reported a DeepSeek turn at a 90% hit rate as costing nearly six times what it did — and three tests now stand on it. So nothing else computes a cost: not SQL, not the front end. `db::ops::usage` reduces millions of audit rows to a few dozen groups and hands each to `cost_of`, which shares one formula with `compute_cost`, the live turn's. Two implementations would disagree in exactly the case the tests exist for. Report totals with `UsageDimension::Total` rather than adding a breakdown up, for the same reason. A part nobody can know is a gap, never a zero: `compute_cost` returns each part's known amount with `RequestCost::gaps` saying which are unknown — an unreported prompt or output count, a rate nobody configured for something that was actually counted — and `total()` refuses to call a partial sum the bill. The turn's own counts are `TokenTally`s for the same reason: one round that did not report makes the turn's figure unknown (the stop event sends `null`), and the reported part survives only as a lower bound. A missing *cache* figure is the one that reads as zero, and by contract rather than by guess: it itemises part of the prompt, absent means nothing was itemised, and those tokens bill whole at the input rate (`TokenUsage::billed_cache_tokens`).
- **What a reply cost is a fact about the past, so the price travels with it.** `audit_messages` snapshots the four token rates at write time (migration 30) and the independent provider-tool rate (migration 37), beside the `provider_name` and `sender_name` it already copied. Joining `model_configs` at read time instead would mean correcting a typo in a rate silently rewrites what last month cost. Rows older than those migrations have NULL there and fall back to today's exact provider/model configuration — the retroactive answer, kept only because it is the sole number those rows have. That fallback is marked in `estimated_messages` (and its token/tool component counters): it is an estimate, not a lower bound, because today's price can be either side of the historical one. Since migration 49, `NULL` is the only unconfigured price and an explicit Decimal `"0"` is free; the migration maps only the legacy base pair `0/0` to `NULL/NULL`, because the old defaults made those two states indistinguishable, while a single zero beside a non-zero rate stays an exact free component. `Prices::known()` therefore means both base token prices are present, including explicit zero. Provider-tool pricing is independent: a known token half remains in the input/output/cache costs when its tool rate is missing, and a known tool rate remains in `tool_cost` when token rates are blank. An explicit historical tool rate wins; a legacy NULL may fall back to today's exact provider/model rate just like the token columns. `unpriced_messages` is the per-reply union of token/tool gaps; `unpriced_token_messages` and `unpriced_tool_messages` say which component is incomplete without double-counting the union. A token report is incomplete when either input or output is NULL, while `missing_token_usage_messages` remains the stricter all-fields-NULL state used to distinguish an unavailable total from a partial one. The SQL computes uncached input per reply before summing, retains reported cache tokens as the prompt lower bound when input is absent, and the turn DTO keeps input/output/cache costs independently optional so a known output is not erased by a missing input. Explicit zero stays exact. With gaps alone, `UsageBucket.total_cost` is the known lower bound; with a current-price fallback it is a possibly-partial estimate. `metered_messages`, `subscription_messages`, and `external_messages` travel with every bucket so non-local billing can never be presented as an exact zero. Conversation snapshots aggregate the same durable rows once by `turn_id`, and migration 44's `(conversation_id, turn_id)` index keeps that batched read scoped to one conversation instead of scanning the whole ledger.
- **A reasoning token is an output token, and one dialect hides that.** OpenAI and DeepSeek count reasoning inside `completion_tokens`; xAI does not. A measured `grok-4.6` reply reported `prompt 214 / completion 1 / reasoning 59 / total 274` and billed all sixty — taken at face value that turn is reported at a sixtieth of its cost, and the number stays entirely plausible while being wrong. `billable_completion_tokens` folds them in, but decides from the provider's own `total_tokens` rather than from which vendor we think we are talking to: a dialect that already includes reasoning satisfies `total - prompt == completion` and is left alone, one that does not leaves exactly `reasoning_tokens` unaccounted for, and anything else is not evidence and changes nothing. A relay with a vague usage block can only be under-reported by its own numbers, never inflated by ours.

- **A price can move with the size of the prompt, and it is chosen once — at write time.** xAI doubles every rate on `grok-4.6` above a 200k prompt, Gemini has charged a long-context premium since 1.5, and OpenAI prices its long-context tiers separately. `model_configs.pricing_tiers` holds those as a JSON array and `agent::pricing::parse_tiers` is the only reader; migration 35 introduced the old `price_tiers` spelling and migration 49 renamed and strictly rewrote it.

  Two things about it are not the obvious reading. **The threshold counts the whole prompt, cached part included, and crossing it re-prices the entire request rather than the excess** — a 201k-token prompt costs double on all 201k. Read as a tax bracket, the formula comes out low by nearly the base rate; measured against the uncached remainder instead, a heavily-cached 400k conversation falls back into the cheap tier, which is the most likely case and the most expensive to miss.

  **And the tier is resolved where the prompt size still exists**, which is two places and neither of them is the report. `db::ops::audit::prices_for` picks it per row and snapshots *that tier's* rates into the four price columns migration 30 already had — so to `db::ops::usage`, crossing a threshold looks exactly like a mid-month price change, which is a thing it has handled since it was written. Nothing there re-decides, because a `SUM` over rows that were separate requests has no prompt size in it and inventing one is how a report comes to disagree with the stop event the user was already shown. The live half is `TurnPricing`, carried into `engine::run_turn` and applied per round, for the same reason in miniature: five 50k requests and one 250k request leave identical totals behind and are billed differently, so `progress.cost` is summed as the turn goes rather than computed from `progress.input_tokens` at the end. A prompt size the provider did not report chooses no tier: on a tiered model the token rates come back unknown (`pricing::rates_for`), so the audit row snapshots none and the live cost has a gap, rather than billing at the base rate — which for a long prompt is the cheap one. A model without tiers has one rate at every size and needs no size to find it.

- **A tool the provider runs is announced, never dispatched.** Grok and DeepSeek will both search the web on their own side, and by the time a `web_search_call` item reaches us the upstream has already run it and fed the result to the model. So `StreamEvent::ServerToolCall` is deliberately not a `ToolCall`: routed through the tool machinery, the loop would try to run `web_search` locally, ask the user to approve it, and send back a result the model never asked for — while the real one is already in its context. What it changes is only what the reader sees, which without it is a minute of silence followed by an answer from nowhere. The front end draws it as an ordinary tool card because that is what it is minus the running, and the two announcements share an `id` so the second revises the first: xAI's opening event carries an empty query and no sources, and both arrive on completion.

  **They exist only on the Responses API, which is why `xai` and `deepseek` each speak two dialects.** Measured: xAI's chat-completions endpoint answers `{"type":"web_search"}` with a 422 — "expected `function` or `live_search`". That makes `api_format` load-bearing for those two rather than cosmetic, and it drags the cache key with it: `prompt_cache_key` is a body field on Responses, while `x-grok-conv-id` is the chat-completions header. Getting that wrong silently costs the cache rather than failing.

  **The list is intersected with the model's capabilities every turn, not read.** A stored `["web_search"]` outlives the support it names — switch the model back to chat-completions and the row still says it — and an unknown tool type is a 422 on *every* request, so one stale setting becomes total failure. `capabilities::server_tools` says what a model can run and `model_configs.server_tools` says what it will; `resolve_turn_params` is where they meet. The catalog side is deliberately short: only xAI (measured) and DeepSeek (its compatibility table) are listed, because a wrong wire name is that same 422.

  **Enabling the provider's search removes ours from the tool set** (`turn_config`, via `superseded_local_tool`). Two ways to search is worse than either alone: the local one stops for approval and needs a Tavily key, so a model that picked it would ask permission and then fail, having had the better option taken away. The map is partial on purpose — `x_search` and `code_execution` displace nothing.

  **What that removes in a QQ group is the approval, and the group section's promise with it.** That section says a search "still asks first", which was true while the only searching was `web_search` at `Permission::Ask`. A provider-side one is never asked about, so with it switched on any group member's message can have the bot search on the owner's account and bill. It is opt-in per model and off by default; it is not something the group's own narrowing controls.

  **`x_search` arrives as `custom_tool_call`, which is also DeepSeek's `apply_patch` envelope.** The name is a field rather than the item type (`x_keyword_search`, `x_user_search` — xAI decomposes the requested `x_search` into those), and the arguments are a JSON string in `input`. That shape was excluded at first as "somebody else's tool", which made every X search invisible: no card, nothing between the question and a minute of silence. Treating an unrequested one as provider-side is safe only because this app never asks for a custom tool; if that changes, the test has to become "did we ask for this one by name".

  **They cost money outside the token price, and that is a fourth thing a bill has to carry.** A measured `grok-4.6` reply with one search billed $0.012818 against $0.007818 of tokens — the difference is xAI's $5 per 1000 invocations. So `TokenUsage::billable_tool_calls` counts them, `model_configs.server_tool_price` holds the rate (migration 37, per *thousand*, which is the unit upstreams publish), and `RequestCost::tool_cost` is its own slot: it divides by nothing the token costs do, and a total nobody can decompose is one nobody can act on.

  Two details are easy to get wrong. **The count is narrowed on the way in**, from `server_side_tool_usage_details` rather than `num_server_side_tools_used` — image understanding inside a search and remote MCP calls are free, and billing those would inflate every search that happened to look at a picture. **And a tier never carries the rate**: a tier describes what a large prompt costs, an invocation costs the same whatever the prompt was, so `with_tool_rate` keeps the base rate across a tier switch. Without that, the long requests — the ones most likely to have searched — would silently stop being charged for it.

  One rate rather than one per tool, because the three this app can ask for are all $5/1k. The ones priced differently (`attachment_search` at $10, `collections_search` at $2.50) are ones it never requests, and if one appears anyway the count excludes it and says so in the log rather than pricing it at a rate nobody configured.

- **A wire DTO names every field the specification does; `extra` is for what it does not.** `warn_extra_fields` exists to say the wire moved, and it can only say that if the documented shape leaves it silent — a `/v1/models` reply tripping it on `created` and `owned_by` every fetch was a warning nobody read. So fields this app reads are declared, fields it does not are declared as `IgnoredAny` under their wire name, and an unknown stream event goes through `warn_unknown_event` rather than a bare `_ => {}`. The same rule for output items and events: a list of the ones the spec names and this app ignores, and a warning for anything outside it. The three adapters were aligned against the official references in 2026-09 (Anthropic's Messages docs; OpenAI's from the SDK type definitions, since the reference site refuses fetches).

  **What the Messages API sends back has to go back exactly as it came, so blocks are kept raw.** `ProviderStatePayload::AnthropicContentBlocks` holds every block of an assistant turn that is not `text` or a client `tool_use` — `thinking` with its signature, `redacted_thinking`, `server_tool_use`, the result blocks — verbatim with its position, the way `CodexReasoning` keeps its items; the streaming adapter folds deltas into each block and hands it over at `content_block_stop`. The old signature-only payload is still read for rows written under it. That is what makes a `pause_turn` resumable: the turn loop pushes the paused round back with its state and asks again, bounded by `MAX_PAUSE_CONTINUATIONS`, and `serialize_messages` replays an assistant row whenever it has blocks for this model even with no text and no call. A row whose blocks were signed for another model is left out rather than sent empty, which is a 400.

  **Three things the request did not say and had to.** `thinking.display: "summarized"` — from Opus 4.7 on the default is `omitted`, which streams thinking blocks with empty text, so those models showed no reasoning at all. Two `cache_control` breakpoints, on the system block and on the last block of the last message — Anthropic caches nothing without one, so the prefix-cache design above did not apply to it at all; a string body is promoted to a text block to carry the marker. And `is_error` on a `tool_result`, which is the only wire format with a field for it. `refusal` and `content_filter` end a turn as `ChatStopReason::Refusal` and a length cut-off as `MaxTokens`, read off the last round's `finish_reason`, so an answer withheld is not shown as an answer that was empty. Web search is offered on the Messages API under the dated name the generation accepts (`web_search_20260209` from 4.6 on, `web_search_20250305` before), and `server_tool_use.web_search_requests` is what `billable_tool_calls` counts.

- **A Responses assistant message carries a `phase`, and dropping it is a documented way to get worse answers.** OpenAI's reference puts `commentary` / `final_answer` on both the input and the output shape and asks for it back: "for models like `gpt-5.3-codex` and beyond, when sending follow-up requests, preserve and resend phase on all assistant messages — dropping it can degrade performance." That is a failure with no error attached — the request succeeds and the replies get duller — which is the same shape as the cache-key and missing-field problems above, and the reason it went unnoticed: nothing in this app had ever heard of the field.

  **It is stated by the upstream and returned, never derived here.** A row could be labelled from whether it ended in a tool call, and that guess would be wrong exactly where the model cared. Absent is its own answer and the common one — Codex says the same about its own copy ("providers do not emit this consistently, so callers must treat `None` as phase unknown") — so `assistant_message_item` omits the field rather than writing null, which is also what keeps this from becoming a new way to get a 400 from a relay that predates it. A label this app has not heard of is warned about once and dropped, not stored and handed back.

  **It lives in `provider_state`, in one payload with the reasoning, because a turn produces both.** `ProviderStateAccumulator` holds exactly one payload and answers two kinds with "a response mixed incompatible provider state" — right for two vendors, and a failed turn for two facts about the same reply. So `ResponsesTurn { reasoning, phase }` replaces `CodexReasoning`, which is still read for rows written before the phase had anywhere to live. That also keeps it out of the schema: a column would have meant a migration, a `MessageRow` field and a `ChatMessage` field for something only these two adapters can read.

  **Unlike the reasoning beside it, the phase is not model-matched.** That is an encrypted blob bound to its producer and replaying one against another model is a 400; a phase is a plain label about what an assistant message *was*, and the next model is being shown that message either way — withholding the label from it is the degradation the field exists to prevent. Vendor and protocol are what keep it off a reply from somewhere else. `RESPONSES_PROTOCOL` exists beside `CODEX_RESPONSES_PROTOCOL` for the ordinary API, which stores its own reasoning and so has only this to keep.

  **The last message item's phase wins, and that is a limitation rather than a choice.** One round is one response and one row, whose `content` is every message item of that response joined — so only one label can travel with it. A response that narrates and then answers is stored `final_answer`, which is what the merged text ends as; the narration inside it is labelled with the answer's phase and nothing can say otherwise without splitting the row. Known gap: the capture is tested as a function, and the two stream call sites that invoke it are not — deleting either leaves the suite green, the same hole `reasoning_update` has.

- **A tool that changes something says in one line what it is doing; a tool that reads does not.** `tools::description_property` is the one definition of that parameter, and it goes on `run_command`, `apply_patch`, the four file-mutating tools, `send_sticker`, and — via `qq_tools::with_description`, keyed off `needs_approval` so it cannot drift — every QQ write. Not on the reads: `read_file`'s path and `search_files`'s pattern already *are* the summary, and a description there is output tokens spent restating what the card is showing. Claude Code reached the same answer and gives it to `Bash` and `Task` alone.

  Two things about it. **It is optional**, because required it would turn a model's omission into a call that fails validation mid-turn, while missing it only costs the card its prose and falls back to the argument — the failure of the soft version is the one the card already handled. In QQ it reaches further than the card: `handler::make_approval_fn` prints the arguments verbatim into the approval message, so for an admin being asked about a ten-minute mute this is the only part of that prompt written for a person.

  **And it is drawn beside the identifying argument, never instead of it** — `ChatToolTrigger`'s `subtitle`, on a second line. Letting it win the one summary line reads better and is a security defect: it takes the path off a `write_file` card, and because `toolFileDiffs` renders a diff there rather than the raw arguments, what is left is the file's own name in the diff header with the directory only in a `title` — which a touch screen cannot reach. Approving a write is exactly when the directory matters. (That basename is itself only correct *because* the trigger prints the full path above it; the note in `fileNameOf` says so, and this is what invalidated it.) The two lines answer different questions — which call this is, and what it is for — and on a narrow card competing for one row leaves neither readable. The approval notification draws the same two lines, for the reason `ToolArgsSummary` is shared at all.

- **A balance is asked for, and the alert lives with the thing that can speak.** `provider::balance` is a `match` over provider types rather than a `ChatProvider` method, because almost nobody publishes one: DeepSeek does, Anthropic and xAI publish nothing, and OpenAI withdrew the endpoint that used to. A trait method would put an unimplementable obligation on every adapter to answer a question only one of them can. Nothing is cached — a stale balance is the number somebody decides not to top up on — and `is_available` is kept apart from the figures because it is the more reliable signal: it accounts for postpaid arrangements and expired grants, which a total does not show.

  The watcher is in `onebot/balance_watch.rs` rather than beside `bootstrap`, and that is the whole design: the notification *is* a QQ private message, so a watcher that outlived the listener would have found the problem and had nowhere to say it. It starts and stops on the server's own shutdown signal, so a restarted server does not leave one behind holding the outgoing generation's admin list. Off unless `balance_alert_threshold` is set **and** an admin is configured — it makes periodic requests with the user's API keys, so it exists because somebody asked rather than because they installed the app. `Some(0)` is a real setting distinct from `None`: keep checking, but say something only when an upstream reports the account unusable. The desktop's half is a button in provider settings, which is where somebody is already looking.

- **A cache key is the conversation, and only the two real loops set one.** `ChatParams::cache_key` becomes xAI's `x-grok-conv-id` on chat-completions and `prompt_cache_key` on the Responses API — the spelling follows the dialect, not the vendor. It is what routes a request back to the server already holding its prefix; without it their own docs say you often pay full input price on a cold cache, and nothing about the reply says so. The desktop and OneBot loops set it. Everything else goes through `without_thinking`, which clears it along with the thinking knobs: a summariser, a title, an extraction pass and a review each send a prompt that is *not* the transcript's prefix, so pinning them to the server holding it buys nothing and would make this paragraph false.

  **`without_thinking` clears the provider-side tools for a harder reason.** A summariser handed `web_search` is a background request that can reach the open internet, on a query the model composed out of whatever it was summarising, billed per call and reported to nobody. For `auto_review` it is worse: it is shown a projection built from untrusted tool output, its verdict goes back into the chat, and searching needs no approval — which is the exfiltration path the `FileAccess` rule in that module exists to close, reopened through another door. The hook reviewer clears the same field by hand, because it resolves its parameters without going through there. It is a flavor of `openai_compat` rather than an adapter of its own (`OpenAICompatFlavor::Xai`): the wire format is unchanged and one header is the whole difference. Sending that header to a generic OpenAI-compatible relay is not free — a vendor header it does not know may be rejected outright — so it is gated on the flavor and tested for its absence elsewhere.

- **Chart series colours are the registry's.** `--color-chart-1`…`-5` (and the `-active` step beside each) come from boardui's `theme.css`; nothing here defines them any more — this used to be a note that they were *ours*, because the HeroUI Pro charts read variables its unimported base theme defined, and undefined they drew every series transparent. They are categorical rather than a ramp. A chart that needs a series to *mean* something — success, warning, danger — takes the status tokens instead, because a series that happens to land on an amber is read as a warning.

## Durable plan documents

Plan mode owns one app-private `plan.md` per unfinished planning episode. The
chat no longer carries the document as `exit_plan` arguments: `read_plan`
returns the current snapshot plus its generation and SHA-256, `update_plan`
applies one patch against that token, and an empty `exit_plan` seals the saved
head for review. The patch parser and applicator are the same ones
`apply_patch` uses, narrowed to one logical `plan.md`; delete, move, multi-file,
empty and stale changes are rejected before any revision is written.

- **SQLite is canonical; the file is a projection.** `plan_documents` points at
  immutable full-snapshot `plan_revisions`, while `plan_materializations`
  records the expected and desired hashes for the app-private file. A database
  commit therefore survives a crash before the atomic rename. Startup can
  replay a pending materialisation, but never overwrites bytes whose hash it did
  not expect. That becomes a visible conflict, and only the explicit “restore
  from database” action authorises replacing it.
- **A submitted plan ends the turn in `waiting_review`; it does not hold an
  approval waiter open.** The review row, draft row, tool-call association and
  turn status commit before the worker releases the conversation lease. Startup
  reconciliation only converts `running` rows to `interrupted`, so a review
  remains reviewable after a restart. Nothing starts a model turn merely because
  the app opened again: a recorded but undelivered continuation is resumed by an
  explicit user action.
- **The editor is a review projection, not a second canonical source.** Markdown
  that round-trips through the supported Tiptap grammar opens in the app's Tiptap
  `RichTextEditor`; unsupported constructs open in exact source mode. Draft JSON,
  normalised Markdown, exact source text, schema identity, selection and comments
  are all persisted with a generation. A second window must save against that
  generation rather than silently winning last-write-wins.
- **Inline comments are anchored, then mapped.** Rich mode stores a ProseMirror
  range plus quote/prefix/suffix context and maps the decoration through editor
  transactions. Source mode stores an exact character range with the same text
  context. A range that can no longer be located is kept as orphaned feedback,
  never guessed onto different words.
- **User edits are suggestions.** Requesting changes seals the edited draft as a
  `user_suggestion` revision whose parent is the submitted assistant revision;
  it does not advance `plan_documents.head_revision_id` or rewrite `plan.md`.
  The assistant receives that suggestion, its patch, inline comments and the
  global note, then answers with another `update_plan` patch. Approve is only
  valid for a pristine draft with no active feedback, so the approved revision
  is always exactly the one the assistant submitted.
- **Delivery is its own durable state machine.** Native feedback is queued for a
  later turn; ACP feedback targets the existing session. `queued`, `dispatched`,
  `acknowledged`, `held` and `in_doubt` distinguish “not tried” from “may already
  have crossed the process boundary”. An in-doubt ACP send is shown for manual
  continuation and is never retried blindly. Decision ids and delivery attempt
  tokens make double presses and known retries idempotent.
- **The old `mode_artifacts` rows remain readable.** Migration 51 backfills them
  into immutable legacy revisions in Rust because SQLite cannot calculate the
  content hash. The conversion is idempotent; new writes use only the document
  tables, and a completed conversation marks its unfinished plan document done.

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

## Automatic approval review

`agent/auto_review/` answers a tool approval with a second model instead of a card.
It is a **decorator over the `Approvals` port**, so `turn.rs` asks the same six places
and never learns some answers were not typed. Off unless `autoreview.enabled` is set
*and* a model is named; `AutoReviewed::wrap` returns an inert wrapper otherwise, which
is why the two call sites do not branch. Everything it decides lands in
`messages.auto_review` keyed by call id (migration 33), and everything it costs lands in
`audit_messages` as `role = 'auto_review'` — `UsageDimension::Kind` is what separates
that from answering the user, because a total nobody can decompose is one nobody can act on.

- **The fail rule is the inverse of `hooks/`, and that is the whole point.** A missed code
  review costs one missed code review, so that gate fails open. A permission prompt that
  proceeds because nobody answered is not a permission prompt, so this one does not — but
  it does not blanket-deny either. An unreadable answer, a timeout, a refused connection:
  none of those are evidence *about the action*. Where a card can be drawn they fall back
  to drawing it; where nothing would be drawn (`unattended`, which is QQ) they refuse.
  Reading "deny" out of an unparseable reply would let a bad connection become a policy.
- **`ask_user` and mode changes are never answered here.** A `Response` is the
  answer to a question and only `ask_user` asked one; entering plan mode is a
  user choice, while `exit_plan` now creates a durable review instead of an
  approval request. None of them is an action for the reviewer to authorise.
- **The reviewer is shown a projection, not the conversation.** The assistant's prose is
  excluded — it is model-authored, and "the user approved this earlier" costs nothing to
  emit. Trust is labelled per line and JSON-encoded so a tool result cannot forge a
  `{"user":…}` line. Tool output, MCP results, compaction summaries and the frozen memory
  block (`role = "context"`) are all `untrusted_*`: a memory written under an earlier
  injection must not be launderable into user intent. In a group chat the admin roster
  decides whose words can authorise anything at all — the same split `qq_tools.rs` makes
  for the tool set, made here for consent.
- **"How many people are here" is not "who is on the roster."** `projection::Party` says
  the first and only the second carries the list. A QQ private chat has one counterpart
  *and* an empty roster; reading the emptiness as "trust nobody" filed the person asking
  for the thing as a bystander to their own request — while the header, reading the same
  emptiness the other way, told the reviewer that `user` was the key to trust. Both are
  now derived from the one value.
- **Risk and authorization are scored separately**, because the most common correct
  `allow` is an action that is genuinely dangerous *and* was asked for. Nothing re-derives
  the outcome from the other two; the policy tells the model how to weigh them and the
  model's `outcome` is what is obeyed.
- **The escalating pass is its own loop, not `engine::run_turn`.** That loop writes rows,
  and a review is a decision *about* a message rather than a message. Four read-only tools
  (`tools::READ_ONLY_TOOLS`, shared with the hook reviewer), executed directly rather than
  through `Approvals` — the whole stack is already inside an approval, and a reviewer that
  could trigger a review would recurse.
- **It runs inside the reviewed turn's `FileAccess`, never a wider one.** Hardcoding
  `Unrestricted` there reads like a simplification and is a hole: a QQ turn runs with
  `Roots(vec![])` and no working directory, and `Unrestricted` with no root means
  `verify_path` skips the prefix check — the whole disk. The reviewer's `rationale` goes
  back into the chat, so that is an exfiltration path any group member can trigger by
  asking for something that needs approval.
- **The deadline is enforced at each await, not by a `select!` around the loop.** The
  outer race cancelled a token and then awaited the same future; the only reader of that
  token is a check at the top of the loop, while what the loop blocks on is
  `chat_with_tools`, which has never heard of it. A wedged endpoint held the 60s budget
  open indefinitely with a person waiting on the tool call.
- **`autoreview.` is in `SERVER_OWNED_PREFIXES`** for a different reason than the other
  three. Those are self-lockout and other servers' credentials; this one grants capability
  by its *value* — pointing `autoreview.model` at something permissive, or appending a line
  to `autoreview.allow_rules`, turns a settings write into permission to run anything.

## How long a question stands, and who may end it

`crate::approval` owns the wait every asker does — the desktop's cards, ACP permissions,
ACP elicitation forms. All three had written the same `select!` by hand; a deadline arm
added to two of three copies is a card that expires in some conversations and hangs in
others, with nothing in the code saying which.

- **Removing an entry is what ends a wait**, because dropping the sender wakes the
  receiver. So "who removes it" and "who ends it" are one question, and approve, deny,
  cancel and expiry all race for it. `ApprovalWaiters::claim` is the answer: an atomic
  take whose `Some` is the *right to act*. The name carries that — `remove` invited
  `let _ = …`, which is the call that produces two accounts of one question.
- **There is no sweeper.** A timer, a filter over the list and a background pass would be
  three competing removers for one entry, and the removal already wakes the waiter. The
  waiter is by definition present, so it owns its own deadline; the filter in
  `views_for` / `all_pending_approvals` survives as belt and braces and hides rather
  than removes.
- **Only expiry is announced.** Cancel and turn-gone happen as a turn ends, and its own
  `stop` already tells every client its questions are over. Expiry has nothing else — the
  turn is still running — so `tool_approval_expired` exists, and its handler settles the
  *card* as well as the queue. That is the opposite of `retireAnsweredApproval`, which
  deliberately leaves an ordinary card holding its `approval_id` because the question is
  still owed; here it is not, and a card left `pending` with no id draws as
  `requires-action` — a demand with nowhere to send an answer.
- **Timing out is `Ok(None)`, never a denial.** The tool does not run and the turn says
  so, rather than the model being told the user refused, which nobody did.
- **OneBot is not on this**, and that is a fact about its register rather than an
  omission: its approvals are keyed by chat session, answered with typed text, and its
  sixty-second timeout is already the sole owner of that wait. Moving it here is a rewrite
  of that model, not a timeout.

`agent::denied` is the other half — a turn-scoped set of what has already been refused, so
a model that retries an identical call is answered from memory instead of putting a second
card in front of somebody who has already said no.

- **Different arguments ask again**, which is the line between this and
  `agent::loop_guard`. That one watches for a model *stuck* and holds a single
  fingerprint, so anything in between resets it. This holds a set and never forgets — but
  a model that reads a refusal and proposes something narrower is doing what was asked,
  and must reach the user.
- **A `None` is not remembered.** Nobody answering is not a refusal, and remembering it
  would let a deadline quietly become a policy.
- **The wrapping order is `DeniedMemory(AutoReviewed(asker))`.** The reviewer answers some
  calls without the asker underneath it being reached; those are the denials cheapest to
  repeat — nothing stopped to ask a person — and a memory placed *inside* would be exactly
  the one that never saw them. Demonstrated by a test that wraps it both ways.
- **A hosted ACP session is not covered.** `session/request_permission` is answered
  directly and never touches a `dyn Approvals`, so there is no decorator position; giving
  it the same memory means lifting the set somewhere both paths reach.
- **`agent::call_identity` is what "the same call" means**, shared by both guards so they
  cannot disagree. It replaced a `DefaultHasher` into a `u64`, neither half of which
  survives being a protocol. `1` and `1.0`, `0` and `-0.0`, and the two spellings of `é`
  are all deliberately *different* calls: being too fine costs one extra question, being
  too coarse costs an unasked one. Object keys sort, array order does not. **An escalation
  is its own `Aspect`** — refusing to run something outside the sandbox is not refusing to
  run it, and the sandboxed attempt afterwards is the safer of the two. The golden vector
  is what detects a change to any of it; the field framing is unambiguous by construction
  and, measured, no single prefix in it is individually load-bearing today.

## Hosting Claude Code (ACP)

`src-tauri/crates/core/src/acp/` runs another coding agent *inside* Meridian. This app is
the ACP **client**; `claude-code-acp` is a child process it speaks JSON-RPC to over stdio.
The turn runs in the adapter, the transcript and the approval cards are ours. Desktop only
— every session is a child process. The adapter is not bundled: it is a node package, and
the machines that want this already have node and a signed-in `claude`.

- **It is a peer, not a caller, and that is why none of `mcp/` is reused.** `mcp/stdio.rs`
  pairs one request with one reply and discards everything in between; ACP holds a
  `session/prompt` open for the length of a turn while narrating it in notifications and
  stopping mid-way to ask the user something. What *is* copied from `mcp/` is what it
  learned the hard way: `read_line` is not cancel-safe so one task owns the stream end to
  end, stderr is drained continuously or the child blocks, `kill_on_drop`, and
  `CREATE_NO_WINDOW`.
- **The reader must never await the handler.** An inbound `session/request_permission` is
  answered by a person, minutes later. Handled inline it would stall the same pipe carrying
  that turn's own output, and the session would look frozen for exactly as long as the card
  was on screen — so requests are spawned and only the reply goes back through the writer.
  Notifications are the opposite: queued and handled one at a time, because they are text
  chunks and spawning loses their order.
- **Read against the schema, not against the adapter — two hangs came from the difference.**
  `claude-agent-acp` is generous: it answers `session/load` with a whole
  `NewSessionResponse`, when `LoadSessionResponse` has *no required field at all* and not
  even a `sessionId`. Both of the following were latent behind that generosity and neither
  fails visibly:

  `result: null` is a **success** carrying nothing, and it is the emptiest conforming answer
  to a load. Read as an absent member — which is what a plain `Option<Value>` does with an
  explicit null — the line is classified as junk, the pending slot is never completed, and
  the caller waits until the process dies. `Incoming::result` is `Option<Option<_>>` with a
  `deserialize_with` for that reason: the derive alone still collapses the two, because it
  is the outer `Option` that turns null into `None`.

  And the reply is parsed as `LoadSessionResult`, whose every field is optional, with the
  requested id as the fallback when it names none. Parsed as a new session, every
  spec-shaped answer looks like a failure — sending a reopen down the `session/new` path and
  losing the agent's memory of the conversation without a word. The fake adapter answers
  `sess-terse` the way the schema permits so both stay tested.
- **A pending slot is registered and then the death is asked about again.** The adapter can
  exit between the check at the top of `Peer::request` and the insert below it: the reader
  sets `death` and drains the table, and the entry landing afterwards is one nothing will
  ever complete. For `session/prompt` that is a turn which never ends on a conversation that
  can never be used again.
- **Stopping does not abandon the request.** `session/cancel` is a notification, and the
  agent still answers the prompt it interrupts with `stopReason: cancelled`. Waiting for
  that reply is what lets a stopped turn end down the ordinary path with whatever text had
  already arrived; dropping the future instead leaves the adapter mid-turn with nobody
  reading, and the next prompt collides with it.

  **A stop that beats the first poll is the exception, and it costs a second fact.**
  `Peer::request` is lazy, so a token cancelled a moment earlier can win the select's very
  first pass and put `session/cancel` on the wire ahead of the prompt it is meant to stop —
  which an adapter with no turn ignores, leaving the prompt to run with `cancel_sent`
  blocking any second attempt. So the loop is `biased;` and the already-cancelled case does
  not send at all, ending the turn from a reply this app writes itself.

  That reply is the trap. `finish` settles what the prompt was carrying — the
  interrupted-turn report, the in-doubt queue items, the memory-loss notice — on the
  evidence that `session/prompt` answered, which is sound for every reply the *adapter*
  sends and false for the manufactured one. All three clear exactly once, so settling there
  spends them on an agent that received none of them and the next turn says nothing.
  `PromptDelivery` is the missing half, and `PromptDelivery::read_by` is where the two are
  combined; inferring it from the outcome alone is the defect, not a shortcut.
- **Approvals go through `services.approvals`, unchanged.** Same register, same
  `tool_approval_req` event, so the attention queue, the notification stack,
  `all_pending_approvals` after a reload and the turn guard all work here without knowing
  ACP exists. The cost: ACP offers four options and `ApprovalDecision` has two, so only the
  `_once` pair is offered — a card with two buttons must not produce a lasting decision the
  user was never shown.

  `ExitPlanMode` is the exception to that approval bridge. ACP necessarily sends
  a full plan snapshot rather than Meridian's patch-only `update_plan` calls, so
  the adapter imports that snapshot as an assistant revision and opens the same
  durable review page. It does not squeeze four upstream choices into a
  two-button approval card. Approval may select the one-shot `default`; requested
  changes are retained as a suggestion and delivered back to the existing ACP
  session. Once that delivery may have crossed the process boundary, a lost reply
  is `in_doubt` and requires an explicit continuation rather than a blind retry.

- **A question is not a permission, and asking one needs a capability we nearly did not
  declare.** `AskUserQuestion` reaches an ACP client as `elicitation/create`, and the
  adapter decides at `session/new` whether to offer the tool at all:
  `disallowedTools = elicitationSupport.form ? [] : ["AskUserQuestion"]`. So a client that
  says nothing about elicitation does not merely fail to draw a form — the tool is withdrawn
  from the model, in subagents too, and the user is told that asking questions is disabled
  in this session. `ClientCapabilities` therefore has one field set to true, and it is the
  whole feature; `acp/elicitation.rs` is what has to exist behind it.

  **Presence is the answer there, not a boolean**: each mode is typed object-or-null, so
  `{}` means supported and `false` is not a legal value for either.

  **The form is translated into `ask_user`'s shape rather than given a UI of its own**, down
  to the "Other" box — upstream models that as a companion field beside each select, which
  is what the card already draws beside each question. What the card sends back is keyed by
  the *schema's* field names, which is why the approval carries the translated form and
  `AskUserBlock` prefers it over the call's own input: answering under the announced input
  keys every question as `undefined`.

  Four things about the return trip, all of the same shape — a reply that is well formed,
  wrong, and reported by nobody. **`const` is the answer and `title` is the drawing**: the
  same string for `AskUserQuestion`, different for the refusal-fallback prompt, whose
  `const`s are the CLI's wire values.

  **A selection and the note beside it are one string by then, standing for two actions, and
  the schema has a property for each.** Read as free text the pair goes only to the companion
  — a *different* property — so a required question answered from its own list arrives
  missing and the whole form is thrown away over an answer that was given. Both are filled:
  the `const` in the property itself, and the whole joined string in the companion, because
  upstream reads a companion answer as replacing the selection and the note alone would
  report the annotation as the answer.

  **And the separator joining them is a candidate boundary, not a landmark.** An option's
  label is model-written and may contain one; cut at the first occurrence, that label picked
  on its own is severed where no boundary was, and the prefix either names no option — the
  required field missing again — or names a *different* one, submitting a choice nobody made.
  Every occurrence is tried alongside the whole string and the answer is taken only where one
  reading resolves. Which is the same rule as the multi-select below, and the same reason:
  what separates is decided by the options, not by the punctuation.

  **An accept is all or nothing, so `required` is enforced on the card.** Upstream validates
  the whole `content` against the schema it sent, and the adapter's comment on its own guard
  is that a malformed accept "yields empty content" — every field dropped, not the offending
  one. So a form answered everywhere except in the one place the agent marked required loses
  *all* of it. `required` therefore travels to the card, which withholds that question's skip
  button and the form's submit button until it is answered. The backend's own check is a
  backstop and could not be the mechanism: by the time it declines, the card has reported
  success and retired the queue entry, so the other answers are gone with nothing said. A
  required field this app cannot draw refuses the form up front, before anybody fills in the
  rest for nothing.

  **So "answered" is a question about the schema, not about whether anything was typed.** The
  free-text box beside an enumerated question is a *different property* — the adapter's
  companion field — so filling that in leaves the required one just as missing, and the card
  holds a required enumerated question to a selection. Where there is no companion the box is
  withheld entirely (`accepts_text`): the value has to be one of the `const`s, so text there
  could only be an accept the asker rejects, and it would take a valid choice down with it,
  since `formatAnswer` folds a note into the selection it sits beside and the pair resolves
  to neither.

  **And a joined multi-select is reversed only where it has one reading.** Naively splitting
  is all-or-nothing, so a string it cannot take apart falls through on its own — the case
  that does not is `"A, B"` against options `"A, B"`, `"A"` and `"B"`, where picking the two
  produces the label of the one, confidently, as a selection nobody made. The ambiguity is a
  property of the *answer*: refusing every field where some label contains `", "` also costs
  `"C"`, and `"A, B, C"`, both of which have exactly one reading. So the readings are
  enumerated and only a unique one is taken. Falling through costs `AskUserQuestion` nothing
  — the companion answer is recorded verbatim, and it is the same string the tool's own path
  would have joined.

  **The uncertain cases decline rather than cancel, which is the inverse of the permission
  path.** A permission that cannot be asked about must not be granted, so that one cancels.
  A question that cannot be asked is one the agent should carry on without: `cancel` aborts
  the tool call and takes the turn with it. That covers an elicitation with no `toolCallId` —
  MCP-originated ones have none, and the card an answer is typed into is the tool call's own,
  so registering it would light the attention dot for a form that exists nowhere. `cancel` is
  kept for the one case that means it: the turn ended while the form was on screen.

  **The card is registered as `ask_user` while the transcript keeps the agent's name.** Three
  places key off the tool name — `kind: 'ask'` in the attention queue, `pendingAsks` rather
  than `pendingApprovals`, and a notification that offers a way in instead of two buttons — and all
  three are right for a form. The transcript says `AskUserQuestion`, because that is what ran;
  the front end matches both names rather than translating either.
- **`usage_update` is reported, never priced.** Those tokens are billed to whatever
  `claude` is signed in as, and this app has no rate for them. Running them through
  `agent::pricing` would produce an authoritative-looking number that is wrong; see the
  bill-priced-once rule above for why there is exactly one place a cost may come from.
- **`acp.` is in `SERVER_OWNED_PREFIXES`, and for a worse reason than the other four.**
  `acp.command` names a binary this app executes. A remote caller who can write it has
  arbitrary code execution on the host — not the self-lockout the rest of that list guards.
  `acp_save_config` and `acp_check_adapter` are `local` for the same reason.
- **A hosted conversation is an ordinary row set, down to the round boundaries.**
  `agent_kind = 'claude_code'`, written with the same `begin_assistant` /
  `complete_assistant` / `append_tool_result` a native turn uses, so search, branching and
  the transcript view need no special case.

  The adapter goes round the model several times inside one `session/prompt`, and each
  round gets its own assistant row: the prose that introduced a call stays with the call,
  the result is its own row, and what the agent says next opens the next row. This was
  flattened onto a single row to begin with, on the reasoning that the shape was legal and
  only lost which text came before which call. It lost more: `lib/turns.ts` reads the
  steps *after* the last tool call as the turn's conclusion, so a flattened turn has none,
  and a turn with tools and no conclusion is drawn as `interrupted` with its whole answer
  folded away as process. Every finished hosted turn that touched a tool was reported as
  stopped. A shape that is merely legal is not the same as one the reader agrees with.

  **All three of prose, reasoning and a tool call open the next round**, and the third was
  missing. A round that ends and is followed by another call with nothing said in between —
  Claude acting twice in a row, which is ordinary — put the second call on the row that made
  the first, recording `assistant(A, B) → result A → result B`: two calls issued together,
  when B was in fact decided after seeing A's result. A serial dependency persisted as a
  parallel one. `import.rs` had the same hole from the same omission.
- **The model is read off the session's config options.** ACP has no model field; it
  carries the model as a configuration option whose `category` is `model`, present in the
  `session/new` response and re-sent as a `config_option_update` whenever it changes. That
  is what lands in `messages.model_id`, so a hosted transcript names the model that
  actually answered. `claude-code` in that column is the fallback and means the adapter
  did not say — it is not a model id and nothing may treat it as one.
- **Thinking has to be asked for, and the ask goes in `_meta`.** Recent models default
  `thinking.display` to `omitted`, which still streams thinking blocks — signature only,
  with empty text — and the adapter emits an `agent_thought_chunk` only for a block that
  has text. So every one of them was dropped and a hosted turn showed no reasoning at all,
  while a session imported from a terminal carried it on most of its rows: the CLI asks for
  the display when a person is at the terminal, and nothing here was asking. Measured on
  adapter 0.70.0, one prompt asked twice: zero thought chunks without, four with.

  `SessionMeta` is that request, on `session/new` **and** `session/load` — a resumed
  session builds its query through the same call, so leaving it off the load would mean
  thinking is shown until the app is restarted and never afterwards. It travels as
  `extraArgs`, not as the SDK's own `thinking` option, which is a tagged union: setting the
  display through that means also declaring `adaptive` or a token budget, which decides
  *whether* the model thinks rather than whether we are shown it. The value is `summarized`
  because the flag takes exactly two, and the other one is what we already had.

  **And because it lands as a command-line flag, it has to be droppable.** This app pins
  neither end: `acp.command` may name any adapter, and the `claude` behind it is whatever
  the user installed. A binary that has never heard of the flag does not ignore it — it
  exits 1 with `error: unknown option '--…'` before running, which arrives as an ordinary
  refusal, so insisting would mean *no hosted session at all* rather than one without
  thinking. `ask_for_the_thinking` asks once with and once without, reports the second
  attempt's error (the first can be blamed on a flag; an expired login cannot), and warns
  only when dropping the options is what fixed it. Measured against the real adapter: the
  refusal does not poison the process, and a plain `session/new` on the same one succeeds
  immediately after. `--help` and `--version` prove nothing here — commander answers both
  before it validates anything, which is exactly what made an unknown flag look harmless.
- **`toolCallId` is unique per session here, and nowhere else in this app.** So the ACP
  layer is the only place that may dedupe by it — and must, because the adapter announces
  a call as soon as it knows one is coming and again once the input has streamed. The
  front end deliberately does the opposite (`handleToolCall` pushes regardless): an
  OpenAI-compatible gateway reuses `"0"` within a turn and two cards there are two calls.
  A repeat revises the card instead; `reviseToolCall` is the only event allowed to match
  on id alone.

  **And the dedupe is asked of the session, not of the row being written** — `Shared::announced`,
  not `t.row.tool_calls`. The row is the wrong scope by exactly one boundary: the two
  announcements come from two sources that can arrive in either order, and
  `Call(A) → Result(A) → Call(B)` rotates the round in between, so a late repeat of `A`
  meets a row holding only `B` and reads as new. That draws a second card no result will
  ever close, and leaves the round with more calls than results — which is the test
  (`results.len() >= tool_calls.len()`) that puts the phase back to `Streaming`, so the
  turn sits at `RunningTool` and a crash there is reported as "a tool may already have
  run".

  **And the repeat is the one that carries the arguments**, so it may not simply be
  dropped once its round has closed. The first announcement is routinely a placeholder —
  the adapter knows a call is coming before it knows what it is — and `Call(A) {} →
  Result(A) → Call(B)` puts `A`'s row in the database before the real arguments arrive.
  `Shared::revise` therefore has two places to look: the open row, and failing that
  `db::ops::message::revise_tool_call`, which finds the call by id among the turn's stored
  rows and patches it in place. Stopping at the open row leaves `{}` in the transcript and
  in the audit copy for ever, which reads as a call that genuinely took no arguments. Both
  paths only ever *add* — a revision with neither a name nor arguments is an ordinary
  progress beat and returns before it costs a scan.
- **The tool's name is in `_meta.claudeCode.toolName`.** ACP's own fields cannot supply
  one: `title` is prose for a person and `kind` is one of five categories. Reading `title`
  put "Terminal" on every shell command — the adapter's stand-in for a `Bash` call whose
  command it has not been told yet — and then the command itself, which belongs in the
  arguments the card already renders.
- **A hosted session does not fire the hook gates**, and that needs both repositories.
  The agent inside loads the user's own Claude Code configuration, plugin included, so a
  hosted turn otherwise ends by asking *this* app to review it over the loopback endpoint:
  a second model for minutes while the turn waits on the hook, and another conversation in
  the sidebar — for a transcript this app already has. `AdapterProcess::spawn` sets
  `MERIDIAN_ACP_HOSTED` on the child and the two hook scripts in
  `~/.claude/plugins/local/meridian-plan-gate/scripts/` stand down when they see it. The
  gates keep doing what they are for: sessions Meridian did not start. The variable name
  is a contract across the two repositories.
- **A session is resumed, not restarted, and `acp_sessions` is what makes that possible.**
  The working directory used to be a preference (`acp.cwd.<conversation_id>`) holding half
  the answer: the directory survived a restart and the session id was never written down at
  all, so reopening started a fresh agent in the same folder. That is worse than amnesia.
  A hosted prompt carries only the newest message — this app's transcript never enters the
  agent's context — so a fresh agent is not hazy about what came before, it cannot see any
  of it while the person it is talking to can see all of it.

  Three things about the table (migration 38) that are not the obvious reading.
  **One row per conversation, not per session**: resuming reuses the id and failing to
  resume overwrites it, and `AcpRegistry` is keyed the same way — a table able to describe
  a state the registry cannot is describing something that does not happen. **A NULL
  `acp_session_id` is a state, not a gap**: it is what a conversation from before the table
  gets, and what one whose adapter came up but never opened a session gets, and both mean
  the same thing to every caller. **And the id that gets stored is the one in the reply.**
  `session/load` resumes through the SDK, which answers with whichever session it actually
  recovered; writing back the request instead would have the next launch chase an id that
  never existed.

- **A load replays the whole conversation, and what that recital is for is a mode, not a
  flag.** `session/load` re-emits the history as ordinary `session/update` notifications.
  Reopening a conversation this database already holds, every one of them is a row said
  twice — and it happens to fall on the floor without any help, because each branch of
  `absorb` asks `with_turn` first and no turn runs during a load; but two branches do not
  ask, and that is two unrelated rules lining up rather than a decision. `Replay::Discard`
  says it instead, and the gate is held across the reply *and* a drain, because the reply
  takes a different route and overtakes the notifications.

  `Replay::Collect` is the other answer, and the one `acp/import.rs` exists for: a session
  started in a terminal has no rows here, so the recital is the only transcript there is.
  Same frames, opposite conclusion — which is why `user_message_chunk` stopped being
  `Ignored` in the mapping and started being dropped in `absorb`. That it is an echo of a
  row this app wrote before sending is a fact about the live path, not about the update.

- **A recital is not the session. Above 5 MiB it is the tail after the last compaction.**
  Measured on a real 39.7 MB transcript: 17 of its 199 questions came back, everything
  before its final compaction absent. That is `getSessionMessages` inside the Agent SDK
  (`if (t > 5242880) return postBoundaryBuf`) — no flag, no error, nothing on the wire
  saying so, since `compact_boundary` is a `system` message and the adapter asks for none.
  The sessions worth importing are exactly the ones this hits.

  The one signal is that the SDK opens the recital with **its own summary**, so
  `CONTINUATION_PREFIX` is what the import matches on, and that decides two things.
  `ImportOutcome::truncated` carries it back to the picker, which says it on the row — the
  only place the user will ever be told. And the summary is written `role = "context"`, not
  `user`: filed as a question it would be a model-written wall of text in the one trust
  layer `auto_review`'s projection lets authorise anything, while its contents came out of
  the tool output of the conversation it summarises. Not `is_compact_summary` either, whose
  invariant wants an anchor and no turn — this row has both.

- **What else an import rests on.** **The row boundary comes off the wire where it can and
  off the rhythm where it cannot.** `messageId` is documented as "a change indicates a new
  message has started", and for an assistant message that is exactly one API response —
  prose plus the calls it issued, the shape a live turn writes a round as. It is not enough
  alone, twice over: a row opened by a `tool_call` carries no id to compare against, and
  the retired `@zed-industries/claude-code-acp` stamps none at all. So a landed result
  closes a row here too, the way `open_round_if_settled` closes one live. Measured without
  it: 82 turns in 2064 ended on a tool result with their closing sentence sitting *before*
  the call, which `lib/turns.ts` draws as `interrupted` — the exact failure the
  row-per-round shape exists to avoid — and with ids stripped entirely every turn collapsed
  into a single row.

  **A result belongs to its call, across turns.** Somebody typing while a tool runs closes
  the turn between the call and its answer; scoped to the open turn, 40 results in 2064
  turns were being dropped, each leaving a `tool_calls` entry with nothing answering it and
  a card that never finishes.

  **It is one transaction and writes its own rows**, not `begin_assistant` /
  `complete_assistant`: those are a round trip each and the second files an audit copy of
  every reply. Live hosted replies belong in that ledger under `billing_mode=external` —
  `turn_origin=claude_code` is the request-level fact, with migration 43 backfilling rows
  written before that classification. An imported recital has no trustworthy per-message
  usage to put on such a row, so its assistant messages remain outside the audit ledger and
  all-or-nothing falls out for free. **And a recital that lost an update is refused rather than written**: `peer`
  drops notifications on a full queue and counts them, and a transcript with an invisible
  hole in it would be believed. Measured, that guard does not fire in practice — the
  recital is capped by the context window at ~1100 frames and the notifier keeps up at 50×
  that — so it is cheap insurance rather than a limit on long sessions.

  The clock starts at the session's own `updatedAt` rather than at the import, because
  `trg_messages_count_insert` drags `conversations.updated_at` to the last row's
  `created_at` — stamped now, every session imported in one sitting piles up at the top of
  the sidebar in the order it was clicked.

- **What an import cannot bring across**, none of it recoverable at this layer, all of it
  measured. An `Edit`/`Write` diff: ACP sends it as a `diff` block, only text is stored,
  so 181 edits in one session became 181 empty tool cards — the same as a live hosted turn
  after a reload, so not a regression, just concentrated. Images, which reach
  `ContentBlock::as_text` as `None`. Slash commands with their output, which the adapter
  strips whole, leaving the conversation looking as if it skipped. And per-message
  timestamps, which exist in the JSONL and ACP does not forward — so every imported turn
  reports a few milliseconds of elapsed time.

  Two more that are about scale rather than fidelity. `session/load` on a large session
  takes ~37 seconds inside the SDK, and it is paid *again* on the first message after every
  app restart, because that is when the lazy reopen resumes it. And `session/list` returns
  596 sessions on one working laptop, which is why the picker draws only the most recent
  hundred and counts the rest.

- **Attaching writes the id and nothing else, and never opens an adapter.** The other half
  of importing, for a conversation from before `acp_sessions` existed: it has a directory
  and no session id, so every reopen starts a blank agent under a transcript it cannot
  see. Its rows came from that same session, so replaying them would double the
  transcript — which is also why the list is enough evidence that the session exists and
  nothing needs loading to prove it. Whatever adapter the conversation had is closed, and
  the next message resumes against the new id down the path that already exists; the
  memory-loss notice below then simply does not fire, with no second mechanism.

- **When a session cannot be resumed, the agent is told — and it is the agent that tells
  the user.** The notice rides `Owed`, beside the interrupted-turn report and the queue's
  in-doubt items, under the same rule: reading it is not saying it, so it is cleared only
  once a prompt carrying it came back. It goes first of the three, because the other two
  describe things that happened inside a conversation the agent is assumed to be following
  and this one says it is following none of it. There is no second UI for it: the agent's
  own first sentence lands exactly where the confusion would have been.

  Existing conversations from before migration 38 have no id to resume and never will.
  They get the notice instead of silently pretending. `session/list` is how they could be
  attached to a session found on disk, and that is the same call the sidebar of
  terminal-started sessions needs — see the roadmap.
- **`fs` and `terminal` capabilities are declared unsupported.** The agent does its own IO
  and we only hear about it in `tool_call` notifications. Turning `fs` on means answering
  `fs/read_text_file` and `fs/write_text_file`, after which every file it touches goes
  through this app — which is what a changes panel and a `FileAccess` policy would need.

## The tool bridge

`acp/bridge.rs` is a loopback MCP server, one per hosted session, lending the agent
inside the things only Meridian knows — this conversation's memories, the app's own log,
what the conversation has cost. Not what it already has: duplicating Claude Code's files
and shell would be two routes to one effect with only one of them going through this
app's approvals. The endpoint is a port the OS picked, a path nobody can guess and a
bearer token, all three travelling together in `mcpServers` and none of them written to
disk. `tests/mcp_bridge_probe.rs` is where the protocol facts below were measured; it is
`#[ignore]`d, spends quota, and should be re-run before any of them is trusted again,
since the adapter is deliberately unpinned.

- **The server may be as small as the spec permits, and that is measured rather than
  assumed.** POST only, one route, pure JSON: no SSE, no `Mcp-Session-Id`, no GET stream,
  no DELETE. The client asks for the notification stream once, takes `405`, and carries
  on. Two details a server written from the guess alone gets wrong — every request
  *except the opening `initialize`* carries `MCP-Protocol-Version`, so requiring it
  unconditionally rejects the handshake; and `tools/call` arrives with `_meta` carrying
  `claudecode/toolUseId` and a `progressToken`, so refusing unknown members refuses every
  call. `mcp/protocol.rs` grew `Incoming`/`Outgoing` for this direction rather than
  widening `JsonRpcRequest`, which would let what a peer might send decide the type of an
  id we choose ourselves.
- **The server lives as long as the session; what it may *do* lives as long as the turn.**
  A session outlives many turns and sits idle between them with no turn id, and a
  `ToolContext` with `turn_id: None` breaks four things at once — per-turn limits stop
  counting, the cancel token belongs to no prompt, a call arriving after its turn ended
  still runs, and rows are filed under nothing. So a turn installs a snapshot, taken
  **once** per call rather than read field by field, and re-checked at each of the three
  points an await can end a turn underneath it. `tools/list` answers regardless: it
  describes capability and executes nothing, and an idle session reporting no tools would
  teach the model they do not exist.

  The window is keyed on the **turn id**, not on a generation `begin_turn` hands back. A
  counter works as an identity and fails as an API: it is a token the caller carries to
  wherever the turn ends, and `finish` has a path where the turn's own state is already
  gone — which would leave a window open with nothing able to name it. The id is known
  everywhere, so `end_turn` sits above that early return.

  **What it cannot do is reject a delayed call from an earlier turn**, and that is the
  protocol rather than a gap. Nothing on the wire carries the issuing turn, so "issued in
  A, arrived in B" and "issued in B, arrived in B" are the same bytes. Telling them apart
  needs a per-turn URL; measured, a `session/load` *can* replace the descriptor, so the
  price is a full reload per turn, which recites the whole history. Not worth it — and it
  is the other reason the first tools here are read-only, bounded and idempotent. A test
  pins the limitation so nobody later reads it as a guarantee.
- **Scope is the wrapper's job, not the whitelist's.** A list of names says which tools
  and nothing about how much each sees, and all three defaulted outward: memory falls back
  to the *client-global* scope when a conversation has no project, `read_app_logs` has
  `this_conversation` defaulting to **false**, and usage had no scope field at all until
  `tools::usage` was written for this. So the bridge *builds* its tools rather than
  filtering names, each already carrying the scope it may not leave, and `tools/call`
  resolves against the same list `tools/list` renders — the "check what was actually
  offered, not what a constant says" rule with the two made structurally identical.

  The wrappers **overwrite** the scope on the context rather than asserting on it, so a
  mistake in how the context is built cannot widen them. The log one closes two holes and
  either alone leaves the other open: the argument, and the context — the tool resolves
  "this conversation" from `context.conversation_id`, and `None` there means no filter at
  all, which is the same unrestricted read reached from the other side. Memory is hidden
  entirely when there is no project rather than offered and refused: project membership
  cannot change under a session, so the list is stable, and a model that cannot see a tool
  will not keep trying it or tell the user about a capability it lacks. None of this
  changes what these tools do on the desktop.
- **Permission is not the boundary, even though the adapter does ask.** Measured: a
  `session/request_permission` arrives before an MCP tool call, offering
  `reject_once`/`allow_once`/`allow_always`, and lands on `acp::approvals::ask` with no
  code in the bridge at all. That is a bonus. The same probe found the session's `mode`
  option offers `bypassPermissions`, `dontAsk` and `auto` — the user's to set, invisible
  from here, and the first removes the ask entirely. So every tool on this bridge has to
  be one that needs no permission. A writing tool waits for the bridge to ask on its own
  behalf, which is also the point at which `auto_review` not covering hosted sessions
  stops being a known trade-off and becomes a blocker.
- **A missing bridge degrades visibly, which is the inverse of the `hooks/` rule.** That
  gate fails open because a missed review costs one missed review. This is a set of
  capabilities already promised to an agent: absent silently, it works around them or says
  it saved a memory using a tool that was never there. The notice rides `Owed` under the
  same "reading it is not saying it" rule, and goes *behind* the memory-loss one, which
  says the agent cannot see the conversation at all. A session that asked for no tools is
  not missing any — an import opens a session only to read its recital — so the flag is
  the conjunction, never `bridge.is_none()`.
- **Both openers advertise it.** `session/new` and `session/load` alike, because a resumed
  session builds its query through the second: advertised at only the first, a conversation
  has tools until the app is next restarted and none afterwards. They go through
  `new_session_params` / `load_session_params` rather than being built inline, and that is
  a test seam rather than tidiness — a version asserting on `advertised()` alone stayed
  green while `session/load` was mutated back to `Vec::new()`.
- **The user's own MCP servers are still not forwarded**, and `NewSessionParams`'s comment
  now says which of the two it means. Those are wired to this app's tool loop and its
  approvals; handing them over gives another agent a second, unowned route to the same
  side effects. The distinction is ownership, not the field.

## The prompt queue

`queued_prompts` (migration 34) is what a person stacks up while an agent is working.
Steering already existed for delegated runs and lives in a `Mutex<HashMap>`, which is right
for what that is — a sub-agent's inbox only means anything while the run is going, and the
run goes with the process. A queue is the opposite: typed minutes before it is needed, a
record of what somebody meant to happen next, and losing it silently on a kill is losing
work they did.

- **Two modes, because one is not enough.** `follow_up` waits for the turn to reach an
  ending and then starts a new one; `interject` goes in at the next point the agent accepts
  input, between rounds of the turn already running. Claude Code offers only the second,
  which makes every thought queued while something long runs an interruption — the opposite
  of what queueing is usually for. Which mode a row carries only means something *while a
  turn is running*: idle, the front of the queue goes whatever it says, because there is
  nothing to wait for and an `interject` left over from a turn that has ended would
  otherwise block the queue for ever.
- **Nothing pumps at startup.** A queue found on disk says only that the app died before it
  was finished; delivering it into an empty room, where the next thing that happens is a
  tool call nobody approved, is the failure this must not have. Exactly three things move
  it and all are somebody being there: an item added, an item switched to `interject`, and
  a turn reaching its ending. A turn that did *not* reach one holds the whole queue —
  "now rename that function" means nothing if the function was never created — and
  `queue_release` is a person deciding otherwise.
- **The two runners take it by opposite routes, and the asymmetry is the design.** A hosted
  session is *asked*: `_session/steering` and `session/prompt` are requests and the reply is
  the only evidence there is. A native turn is *offered* — `agent::queue::Interjections` is
  the `Steering` port the loop drains between rounds, so the queue never pushes and never
  has to know where the turn has got to.

  That is the same split the ledger rests on. A native turn resends its whole history, so
  the transcript row **is** the delivery and `db::ops::queue::take_next` makes the row and
  the item's removal one transaction; there is no in-doubt state on that side to report. A
  hosted turn's history lives in the adapter, so a row here proves nothing and the doubt is
  real.

  **Which of the two is read off `agent_kind`, never off the registry.** Asking whether an
  adapter is alive answers a different question, and the two come apart exactly when it
  matters: after a restart, or once an adapter has died, a hosted conversation has no live
  session — and `native::pump` would then answer its queue with the user's own provider and
  this app's tool set, appending a turn to a Claude Code transcript whose agent knows
  nothing about it. Wrong agent, wrong bill, wrong conversation. A dormant hosted
  conversation goes to `hosted::pump`, which does nothing, and the queue waits.

- **A claim on a queued item is the affected-row count, and every caller has to look.**
  `mark_dispatched` only matches a row that is still undelivered, so its count is what says
  who won it — two pumps can read the same item (a turn ending as the user adds one, a
  window and a phone) and both go on to deliver it otherwise. `write_prompt_row` and
  `run_turn` roll back on zero; the steer path was discarding it, which is the one place
  where losing meant sending "delete the old migration" twice.

- **A crash holds the queue, and that is written where the crash is noticed.**
  `ops::turn::reconcile_interrupted` marks the killed turns *and* `hold_all`s the
  conversations they were on, in one transaction. The rule that only a turn reaching an
  ending lets the next item go otherwise survived everything except the one event it exists
  for — nobody is present at a crash, and the next enqueue would pump a follow-up whose
  premise died with the process.

  **A hold reaches a row that is merely claimed, and that is the other half of it.** A
  claim is not a delivery: `hosted::steer` marks the row dispatched *before* asking the
  adapter, the answer can be `promptRequired` — the agent saying it did not take the
  message — and `undispatch` puts it back. `hold_all` used to skip dispatched rows, so a
  hold landing inside that round trip missed the only row it was about: the turn failed,
  the claimed item came back plainly `Queued`, and the instruction ran on a premise that
  had died without anybody pressing release. Marking it costs nothing while the claim
  stands, because `QueueState` reads `dispatched_at` before `held_at` and an in-doubt row
  is already a barrier — the flag only starts meaning something at the moment the dispatch
  is cleared, which is exactly when it should. `release_all` clears it there too, and
  `dispatched_at` still outranks it, so releasing a held queue cannot resurrect an item
  whose delivery is unresolved.

  The pump's half is to **ask the queue again** after a `NotTaken` rather than deliver the
  row it read before the claim. That row is stale by exactly the window the hold can land
  in; reusing it leaves `mark_dispatched` to refuse the claim and roll the turn back —
  correct, and reported as a failed turn rather than as the barrier it is.

- **A barrier cannot be dragged past.** `reorder` moves only rows that are still queued,
  and places them after the last `held` or `in_doubt` position — otherwise a drag puts a
  later message in front of an unresolved one, `next_pending` reaches it first, and the
  instructions run out of the order they were written in. The drag handle is withheld from
  those rows too, so the affordance does not offer what the write refuses.
- **`dispatched_at` without `settled_at` is never re-delivered.** Re-sending "delete the old
  migration" because we are unsure whether it landed is how a queue becomes dangerous — and
  what it guards is not the agent's memory, which died with the adapter, but the *effects*
  of a command, which did not. So it is reported instead, on the same terms `interrupted.rs`
  reports a cut-off turn: reading the record is not telling anyone, so `reported_at` is only
  written once a reply has been read to the end. An in-doubt row also **stops** the queue
  rather than being stepped over, because the instructions were written as a sequence.

  Only one answer ever puts an item back: ACP's `promptRequired`, which is the agent saying
  it did not consume the message. A timeout, a dead pipe, an unreadable reply are an
  *absence* of evidence and stay in doubt.
- **`Steering::drain` is async, and `Steered::row` may already be set.** The trait was
  deliberately sync while every implementation was a queue behind a lock. A table is not:
  taking an item off it is a transaction, it belongs on a blocking thread, and it has to
  include the row write. A loop that wrote its own row anyway would put the same sentence in
  the transcript twice and hang the rest of the turn off a row the queue has never heard of.
- **A steered message's row is owed to the next round boundary**, not written when it is
  sent. Written at the send it forks the transcript: the open assistant row's children are
  its own tool results, and a user row landing beside them makes two branches out of one
  round. So the front end keeps a settled row visible until `settled_message_id` is filled —
  for a follow-up those are one transaction, for a steer they can be a whole tool call
  apart, and in between the message would otherwise be nowhere anyone could see it.
- **`StartTurn` on `Services` is the one thing core needs from the shell.** Running an
  ordinary turn is `commands::chat`, and the queue lives below the line. A `OnceLock` the
  shell fills at startup is a far smaller answer than moving `commands/` down for one call;
  unset, a follow-up is simply never delivered and the item stays visible.
- Known gap: a QQ turn started from the chat side drains its own inbox and not this table,
  so an interjection queued during one waits for something else to pump.

## The input method

`src-tauri/ime/` is a Windows input method — pinyin and zhuyin, plus the grid
layout the phone keyboard types — that installs with Meridian and does not
need it running. It is in the shell workspace and not in core because a
headless server and `meridiand` must not carry one, and it is ten crates
rather than one because the boundaries are the design.

- **The DLL holds no engine, reads no file and computes no path.** A text
  service is loaded into every process with a text field, including store
  apps in an AppContainer that cannot see `%APPDATA%`, and a panic in it is a
  crash in Word. So `meridian-ime-tsf` forwards keys over a named pipe, applies
  the answers to the document, and nothing else; settings it must know before
  the first key (`page_size`, punctuation, the scheme) arrive in `Welcome`.
  Every COM entry point is under `catch_unwind` and a key whose handling
  panicked is passed through. The crate boundary is what enforces it: the DLL
  depends on `meridian-ime-proto` alone.
- **One host per login session, one `Session` per text field.** The pipe is
  `\\.\pipe\meridian-ime-s<session id>`, so a remote-desktop session and a
  fast-switched second user each get their own host, and the first instance is
  created with `FILE_FLAG_FIRST_PIPE_INSTANCE` so the kernel, not a mutex,
  refuses a second host. Its ACL names the user, `ALL APPLICATION PACKAGES` and
  `ALL RESTRICTED APPLICATION PACKAGES` with a low mandatory label, which is
  exactly the set that has to reach it: an AppContainer's access check needs
  the user *and* the package SID, a browser renderer is at low integrity, and
  the prototype's `Everyone` was not a boundary. The DLL starts the host when
  the pipe is absent — from a medium-integrity process only, behind a named
  mutex and a cooldown — and while it is absent letters go into the document
  as typed rather than vanishing.
- **Edit sessions are asynchronous, always.** `TF_ES_SYNC` inside the key sink
  is documented as allowed and measured (by qingjian) to crash applications
  whose text store lives in another process, which is the current Notepad. So
  `OnKeyDown` updates the local "are we composing" view from the host's reply
  and then requests the session; the document catches up a moment later on the
  same thread, and `OnTestKeyDown` never contradicts it. A key the DLL promised
  to eat and the host then declined is inserted by the DLL itself, because some
  applications drop a key that was declared eaten and then was not.
- **Privacy is two gates, and neither is a filter.** The DLL reads
  `GUID_COMPARTMENT_KEYBOARD_DISABLED` per key and the input scope
  (`IS_PASSWORD`, `IS_PRIVATE`, the PIN scopes) per focus change, and the host
  wraps the learner in `Muted` for that session: reads unchanged, writes
  swallowed, no flag anywhere that a write path could forget to check.
  `private_apps` in `host.json` is the same wrapper keyed on the executable.
  Nothing an input method sees reaches Meridian's memory yet; when it does, it
  goes through `services.redaction` first and lands as `UserProvidedContext`.
- **Dictionaries are imported, not shipped.** A Rime `.dict.yaml` (rime-ice is
  the one to start with) is converted by `meridian-ime-dict::rime` into an
  `.mdict` — one memory-mapped file whose layout is its in-memory layout, with a
  `META` section carrying the source's own SPDX licence — and cached by a hash
  over every file it imported plus the format, importer and syllable-table
  versions. The importer reads the YAML header's `columns` rather than
  assuming them: rime-ice's `tencent` table is `text weight` with no code, and
  the prototype, assuming `text code weight`, filed half its dictionary under
  the code `100`. Codes are validated against the syllable table; an ASCII-only
  text (`A A`, the capital-letter rows) is refused rather than filed under `a`.
  `POST.entry_count` is 32 bits because the prototype packed 16 into the FST
  value and overflowed it, and the test that writes seventy thousand entries
  under one code is what keeps it that way.
- **Three schemes, one lattice.** Pinyin, zhuyin and grid are `SchemeParser`s that
  turn keys into the same syllable DAG — an edge is a canonical pinyin
  syllable, `complete` or the start of one — so the dictionary, the lattice,
  the beam search and the learner never know which keyboard was used. A bare
  initial anywhere and an unfinished syllable at the end are edges too, which
  is what puts candidates on screen from the first key. Under zhuyin the tone
  keys are boundaries and the tone value is ignored, since the dictionaries are
  toneless; digits are bopomofo keys there, so candidates are chosen with
  Up/Down and Enter, and Space after a toneless syllable is the first tone.
- **The grid is fuzzy by design, and its fuzziness is data.** Nine columns of
  pinyin-lettered keys with zhuyin's structure: `z` `c` `s` each stand for
  both the dental and the retroflex initial, `ng` is the only nasal key, and
  tones are optional keys (ˉ ˊ ˇ ˋ ˙) that close a syllable when typed. A
  syllable's keys come from its bopomofo spelling through two tables,
  `grid_initials.txt` and `grid_rimes.txt`, and every syllable a key sequence
  can mean is its own edge from the same start to the same end — so `z w ng`
  is zhong, zong, zhun and zun at once, with no change to the dictionary.
  `shared_spellings_are_only_the_designed_merges` is the gate on those tables:
  syllables may share a spelling only if they are equal once retroflex folds
  to dental, ㄤ to ㄢ and ㄥ to ㄣ, so an edit that merges more fails. One key
  is one `char` — the multi-letter keys are private-use code points, the tone
  keys are the tone marks — so the key string, `Candidate::consumed` and
  Backspace keep counting characters, and the preedit shows labels, never a
  private-use character. Space only commits (the first tone has its own key)
  and digits select. **A long press is the precise key**: `z` offers `z_`/`zh`,
  `c` and `s` likewise, `ng` offers `er`/`-n`/`-ng`, each spelling exactly one
  of what the tap covers (which also separates dun/dong and jun/jiong, merged
  as a side effect of the single nasal key). `GridToken::variants` is the
  menu, so the keyboard reads it rather than keeping its own list. A precise
  key is only precise if its *unfinished* edges are too: they are looked up
  by prefix, and `z` as a prefix is also every `zh…`, so `cover` splits a
  prefix by its next letter until it reaches nothing the keys exclude.
  **Both spelling habits are accepted at once.** A pinyin typist drops the
  `e` of ㄣ/ㄥ after a medial (dun `d w ng`), a zhuyin typist keeps it
  (ㄉㄨㄣ `d w e ng`); the zhuyin spelling is an alternative marked
  `zhuyin:` in `grid_rimes.txt`, so there is no setting, and `SpellingHabit`
  only picks which one `keys_for_habit` / `bench --habit` types. In the
  zhuyin habit jun and jiong share `j v e ng` on a tap, accepted because
  jiong's characters are rare; a long press on the nasal separates them. `Scheme::Grid` on the wire is why `PROTOCOL_VERSION` is
  2: the wire enum has no catch-all, so an older DLL fails the `Welcome`
  rather than silently typing pinyin. `grid_table_sha256()` is what a model
  trained on the layout is checked against.
- **`keys_for` turns toned pinyin into any scheme's keys.** The evaluation set
  stores what a sentence says (`ni3 hao3`), not what was typed, so one set
  scores every scheme and every tone habit (`TonePolicy`). `meridian-ime keys`
  prints the same strings for the training repository to compare byte for
  byte; `bench --eval` reports top-1, keystrokes per character and cache
  misses per keystroke. Measured on rime-ice, 2026-09, toneless: pinyin 3.27
  KPC, zhuyin 2.48, grid 2.74 (2.87 in the zhuyin habit); grid's worst
  keystroke 6–8 ms against a 30 ms budget, which is why pruning dead lattice
  paths is not built.
- **The language model scores candidates; it never chooses them.**
  `meridian-ime-lm` implements `SentenceScorer` over ONNX Runtime opened at
  run time (`load-dynamic`, API 17): the host finds the copy sherpa-onnx
  already installs in `$INSTDIR`, `MERIDIAN_ORT_LIB` overrides. It is asked
  once per query about the beam's readings *and* the best whole-input words
  — without the second, 你/尼/泥 for one syllable could never be reordered —
  with the text around the cursor (`ScoreRequest.left/right`, from the app or
  from what the session committed) and, where allowed, memory hints. Three
  things keep it from costing a keystroke: a budget from the manifest after
  which the run is terminated and the answer is "no opinion", a breaker that
  stops asking for two seconds after five misses, and a cache per context.
  The score is mixed in as `RERANK_MIX · (lm − static)` after the manifest's
  `scale` puts it on the dictionary's footing. A private session tells it
  nothing — no left, no right, no hints — and keeps no context to tell later.
- **A model bundle is refused, not tolerated.** `<ime>/models/<id>/` holds
  `score.onnx`, `vocab.json` and a `manifest.json` with `deny_unknown_fields`
  whose file hashes, grid table hash and syllable table hash must all match
  this build; the graph's contract is in `lm/src/backend.rs`. A personal
  bundle (`personal: true`, trained on the person's own exported typing) is
  preferred and never published; the public one is static. The host reloads
  when a manifest appears or changes; the settings page installs from a
  directory and removes manifest-first so the host lets go before the files
  go. The tests generate a contract graph as protobuf by hand, so they need
  neither a checked-in binary nor Python, and run against the real runtime
  when `resources/onnxruntime.dll` or `MERIDIAN_ORT_LIB` is there.
- **Memory hints flow from Meridian to the input method, never back.**
  `src/ime/hints.rs` writes `<ime>/context/memory-hints.json` every minute
  when it would change: client-global memories only, cut into 2–32 character
  mostly-Chinese phrases, a memory any redaction rule touches dropped whole,
  no id, scope, person or time. It is recomputed rather than hooked because
  the agent saves memories inside core where the shell never sees it. The
  host hands them only to sessions in `meridian.exe` or an app listed in
  `context_apps`, never to a private one; without a model they still lift a
  whole-input word of two or more characters that a hint contains
  (`CONTEXT_BONUS`).
- **Frequencies are normalised against the total of every file together.**
  Against its own total, a two-hundred-word domain table makes each of its
  words commoner than 你好 and the composer prefers them everywhere. A user's
  own word is scored as `USER_WEIGHT_SCALE` per lesson so one lesson makes it
  a common word, not a negligible one.
- **Learning is four readable TSV files with an undo for each write.** A
  commit records the word, the choice for its key string, and the transitions
  between its words (twice for an explicit choice, once for a composed
  sentence, so the composer's own output does not echo back at full weight);
  the last four commits are kept so that deleting one with Backspace and
  retyping the same keys with a different choice takes the lesson back. A
  buffer chosen in several pieces is remembered whole, and after two
  repetitions becomes a user word. Files are written atomically and flushed
  every minute and at exit; a store that cannot be opened degrades to learning
  in memory, never to writing an empty table over the user's.
- **`host.json` is the one source of truth and the host polls it.** Meridian's
  settings page writes it, the host reloads it within a second, and nothing is
  mirrored into the preferences table where it could disagree. Dictionaries
  live in `catalog.toml` beside the files for the same reason.
- **On Android the engine is in the keyboard's own process, so there is no
  host to talk to.** `meridian-ime-android` is `ImeHost`: one `Session`,
  called directly over JNI from the keyboard service in `:ime`. One keyboard
  types into one field at a time, so there is no `Router` either. What it
  reads from disk it reads through `meridian_ime_host::data` — the same
  loaders, the same watch, the same fail-soft rules as the Windows host — so
  the two cannot disagree about what a file means; that module is why
  `meridian-ime-host` is a library as well as the Windows binary. The field
  decides privacy (`start_input(package, private)`: a password field, or
  `IME_FLAG_NO_PERSONALIZED_LEARNING`) together with `private_apps` keyed on
  the package; memory hints go to Meridian's own package and to
  `context_apps` only, and a private session withholds them itself. The
  layer on screen picks the scheme (`set_scheme`), not `host.json`. A key
  crosses JNI as four integers (`bridge.rs`, tested on the desktop); what
  comes back is the session's own JSON. Every `Java_*` function is under
  `catch_unwind`: a panic is an `IllegalStateException`, not a dead
  keyboard in somebody's chat.
- **`meridian-ime` is the harness.** `type "nihao<space>"` replays a key
  script through the same `Session` the host runs, `lookup` ranks candidates
  against the imported dictionaries and says how long it took, `bench` scores
  the composer against expected sentences (28/30 top-1 on rime-ice at ~2 ms a
  query). The golden tests in `session/tests/golden.rs` are the same scripts.

Measured but not built: downloading a model bundle (nothing is published
yet), the tone filter the bundle's `readings.tsv` is for, the TSF DLL
reporting the text around the cursor (`surrounding` exists on the wire; the
DLL sends `None`), a language-bar button, traditional output,
`ITfTextLayoutSink` for the cases where `GetTextExt` answers
`TF_E_NOLAYOUT`, and `uiAccess` so the candidate window can sit over the
Start menu's search box.

## Remote access

`src-tauri/src/remote/` serves this desktop to another device: the phone runs the same
frontend, the turn runs here. No synchronisation anywhere — a connected client reads the
same rows the window does, and closing it does not stop a turn. It lives in the shell
rather than in core because what it dispatches to are the Tauri commands.

- **One command table, two consumers.** `command_table.rs` is expanded by both
  `generate_handler!` and `remote::dispatch`. A second list is the one that would quietly
  fall behind — a command added for the window works at once, and nobody finds out it is
  unreachable from a phone until they try. Rows say `async` / `sync` (a dispatcher cannot
  `.await` a plain `fn`) or `local`.
- **`local` and `LOCAL_COMMANDS` are different things.** `local` in the table means the
  *server* refuses it. `LOCAL_COMMANDS` in `lib/transport.ts` means the *client* answers it
  itself. Most rows are one or the other; the pickers are both, and for unrelated reasons:
  `take_photo` runs on the phone because that is where the camera is, and its `content://`
  result is unreadable to the host — so remote mode routes attachments through a real
  `<input type="file">` and `/upload` instead.
- **The generic key-value commands are a hole in `local`.** All three listeners keep their
  configuration in `preferences`, so `set_preference` reaches what `save_listen_config` is
  marked `local` to protect. `guard_preference` refuses the `remote.` / `hooks.` /
  `onebot.` prefixes for remote callers. Two of those keys are worse than self-lockout:
  `hooks.token` and `onebot.access_token` are other servers' credentials, and
  `onebot.admin_users` decides who is an admin in QQ — writing it is escalation against a
  third party.
- **The guard is the inverse of the hook endpoint's, deliberately.** `hooks/http.rs`
  refuses anything carrying an `Origin`, because its only legitimate caller is a local
  process. Here the caller *is* a page on another device and its `fetch` is cross-origin by
  construction, so preflights are answered and the bearer token is the whole boundary. Do
  not copy either guard into the other.
- **Three credentials, three shapes, and none of them interchangeable.** HTTP takes a
  bearer header. The websocket takes its token in the first frame — a browser cannot set a
  header on a `WebSocket`, and a query string ends up in logs. `/assets` takes a ticket,
  minted per socket and dropped when it closes, because an `<img src>` cannot carry a
  header either and the bearer token must not be spent in a URL.
- **A client that stops reading is disconnected, not waited for.** Bounded queue per
  connection, `try_send`, full queue closes it, nothing replayed. The fan-out is registered
  non-critical, so none of it can fail the turn that was emitting — the same `critical` flag
  the window uses, for the opposite purpose. A reconnect emits `remote-resync` and the
  client refetches; a transcript with a hole in it is worse than one that reloads.
- **Android permits cleartext in every build.** Remote access dials `http://192.168.x.x`
  and `networkSecurityConfig` matches hostnames, not the CIDR a router hands out. The
  boundary is the token, which `listen_guard` refuses to let be shorter than 16 characters
  off loopback. Tailscale is the answer for anyone wanting the transport encrypted.

## Running commands in a container

`crate::container` places a conversation's commands in a Docker container instead of
on this machine. Turned on per install with `sandbox.enabled = container`; `auto` is
the old behaviour (a Windows restricted token, nothing elsewhere) and remains the
default. Every claim below was measured —
`src-tauri/crates/core/tests/docker_probe.rs` is the measurement, it is `#[ignore]`d,
and it should be re-run before any of it is relied on, against Docker Desktop 28.4.0
with linux containers on Windows.

- **One container per *conversation*, entered per command.** That is what makes the
  filesystem continuous — something `pip install`ed is still there next command,
  measured — and it is why there is a lifecycle owner, an ownership label, and
  reclaim of what a crash left behind. `docker exec` needs a container that already
  exists, which is the gap in "just wrap the argv".
- **Killing the exec client does not kill the process inside.** Measured: it was
  still running afterwards. So a container backend owes its own cancellation and
  cannot reuse `execute_unsandboxed`'s process-tree kill — otherwise "cancelled"
  means "we stopped watching", with the command still writing to the workspace and
  the next command entering a container with a predecessor loose in it.
- **And the obvious way to reach it is wrong.** `pkill -f <pattern>` from a second
  exec exits 143: its own argv contains the pattern, so it kills its own shell, and
  whether the target died first is a race. What works is a marker the target
  *carries* and the killer only *names* — `docker exec -e MERIDIAN_EXEC_ID=…`, found
  through `/proc/*/environ`. A pid is not available; the client is never told one.
  So every command needs an id, and cancelling is a second exec.
- **The writable layer carries between execs; the working directory does not.**
  `cd /tmp` in one exec leaves the next at `/`. So each exec starts at the
  conversation's project root, exactly as `working_dir_or_current()` already resolves
  per call — and a logical cwd maintained by parsing `cd` out of shell commands is an
  approximation that can never be made to agree with what the shell did. If a
  persistent cwd is wanted it has to be an explicit operation.
- **`ran_under` is an enum and `without_sandbox()` was the danger.** The escalation
  path removes the whole policy and runs on the host. For a container that turns "the
  container refused this" into a card offering a retry that actually means "run it on
  your machine instead" — the worst kind of mis-authorisation, because the wording
  hides the size of it. `SandboxBackend::may_retry_on_host` answers for exactly one
  backend, and `run_command` checks it *as well as* the denial heuristic: the
  heuristic's keywords are a restricted token's own words, so asking the backend too
  is what stops a new backend inheriting the card by being added to the list.
- **Nothing falls back to the host, at either of two gates.** `resolve_sandbox_policy`
  refuses to *build* a container policy it cannot satisfy — a missing connector is
  `Infrastructure`, a conversation with no project to mount is `Unsupported` — and
  `execute` refuses to *honour* one that arrives without a connector anyway. The old
  `default_policy_if_enabled` could only answer `None`, and `None` runs on the host
  without anybody being told, which is the failure the whole feature exists to
  prevent. It survives for `ExecutionMode::Auto`, where `None` is honest.
- **A setting that cannot be read is not a setting that is unset.** Absent
  `sandbox.enabled` is `Auto`, so the old `.ok().flatten()` turned a database that
  failed to answer into "run on the host" for somebody who had chosen a container,
  with a log line as the only witness. `sandbox::CommandSettings` reads `shell` and
  `sandbox.enabled` together (they fail together) and says `Unreadable(error)`
  instead, which becomes `CommandSandbox::Unreadable` on the `ToolContext`. Under it
  `run_command`, custom tools and `run_user_command` run nothing anywhere; they
  answer with the escalation the restricted-token denial already uses
  (`ApprovalRetryKind::SettingsUnreadable` on the same retry card, the read error
  shown on it), and only the user's explicit yes runs the call — through
  `ToolContext::without_sandbox`, on the host, with the platform's default shell,
  which the card says. No, no answer and an expired card all leave it unrun. Nobody
  unattended may say yes: QQ's `ChatApprovals` and an unattended `AutoReviewed`
  refuse it without asking, and the reviewer never judges it on the desktop either —
  it goes to the person. A stored value that *was* read and is not ours still fails
  the turn: that is broken data, not a question.
- **The mode has three values, not two, and `Auto` is why.** The preference was
  on/off and had to mean "the best this platform has". Read as a request for a
  *particular* backend it would fail on Linux for everybody, so "whatever you have"
  stays its own value. One key, more values: a second key would be one that could
  disagree, and there is no reading of "enabled=false, mode=container" that is not a
  bug. An unset value is `Auto`; a value that is not one of the three is an
  error, never a guess at which of them was meant.
- **Secrets do not travel in `-e`.** Measured: an environment variable is in
  `docker inspect` for the life of the container, readable by anything that can reach
  the daemon. Nothing is passed yet, which is correct and incomplete.
- **A label is enough to find every container this app owns**, which is what reclaim
  after a crash needs, and `docker stop` returns with `.State.Running` already false —
  the same invariant `acp::peer` holds for the adapter. Reclaim is `reconcile`, judged
  against `conversation::all_ids` — the *unfiltered* list, since an orphan judged
  against the sidebar's filtered one is an archived conversation's container. A live
  conversation's container is stopped, never removed: its writable layer is the
  continuity `ensure`'s restart branch resumes, and the old remove-everything reclaim
  contradicted that branch. Wired at startup (which is what covers a crash), at exit
  (`stop_owned`, bounded), and into `delete_conversation` beside the ACP close.
- **`custom.rs` goes in too.** It used to pass `None` and always run on the host,
  which was defensible while the only sandbox narrowed a command on this machine
  anyway. `run_command` inside a container and a user's own command tool outside it,
  in the same turn, is not a session sandbox — it is a sandbox with a documented way
  round it. The cost is real and belongs to the user: a custom tool written against
  the host's toolchain will not find it inside, and the setting says so.
- **OneBot stays on the platform default, and that is a boundary rather than an
  oversight.** A container mounts the conversation's project and a QQ session has
  none, so routing it through the resolver would fail every QQ turn the moment
  somebody set container mode for their desktop work. What confines a headless
  session is already stricter where it matters — its `FileAccess` is an empty root
  set, so paths fail validation before a command is reached.

### Putting the hosted agent in one

`acp.command` has always been free-form, so `docker run -i --rm … claude-agent-acp`
already launches a hosted session inside a container without any support from this
app. That is not the same as the feature being built, and one part of it was
silently broken.

- **`MERIDIAN_ACP_HOSTED` did not survive.** `AdapterProcess::spawn` sets it with
  `.env`, which reaches the child — and measured, `docker run` does not forward the
  client's environment past itself. So the agent inside could not see it, the
  `meridian-plan-gate` plugin did not stand down, and every hosted turn ended by
  asking this app to review a transcript it already had: a second model for minutes
  and another conversation in the sidebar. Nothing failed. It just cost twice.
  `forward_marker_into_container` injects `-e MERIDIAN_ACP_HOSTED` — the bare form,
  so the value stays decided in one place — immediately after the `run`, because
  anywhere past the image name it is an argument to the agent instead.

  Rewriting somebody's configured command is intrusive, and it is done only where
  the meaning is unambiguous: a known launcher, a `run`, nothing forwarding it
  already. Everything else is left exactly as written.

- **The working directory is translated, and the mount table is the command the user
  already wrote.** `session/new` refuses a directory that does not exist, and
  `C:\work\repo` does not exist inside the container — so an adapter launched that
  way never opened a session at all, with an error saying the path was wrong rather
  than that it was in the wrong coordinate system. `acp::mounts` reads the `-v`,
  `--volume` and `--mount` flags off `acp.command` and translates both ways. A second
  setting listing the mounts would be a second thing that can disagree with the
  command, and the disagreement looks exactly like this failure.

  **The colon is the part that fails silently.** `-v C:\work\repo:/repo` has three
  colons and only the second separates. Split on the first and the host path becomes
  `C`, which Docker does not refuse — it creates a named volume — so the agent gets an
  empty directory instead of the project and nothing anywhere says why. The container
  half is always absolute and POSIX, so the split is decidable from the right; the
  tests exist because the failure is invisible.

  A path that maps nowhere is passed through unchanged rather than guessed at: the
  adapter's own "no such directory" names the path it really looked for.

- **The rest of containerising the agent is not built**, and the reasons are worth
  keeping. Paths coming *back* — the ones in `session/update` — are still shown in the
  container's terms, so a tool card names `/repo/src/lib.rs` rather than something the
  reader can open. `kill_on_drop` kills the `docker` client and not the container, the
  same finding `crate::container` is built around. `~/.claude` would need mounting
  read-only to reuse the login. And the tool bridge only reaches the host on Docker
  Desktop — measured — so a Linux daemon needs it to bind wider or not at all.
- **The bridge conflict is real but not where it was expected.** `acp::bridge` binds
  `127.0.0.1`, and loopback inside a container is the container. Measured on Docker
  Desktop, a host server on `127.0.0.1` *is* reachable through
  `--add-host=host.docker.internal:host-gateway`, because that name resolves to a proxy
  (`192.168.65.254`) which connects from the host side. **This does not generalise**: a
  native Linux daemon resolves it to the bridge address, the connection arrives on a
  real interface, and a loopback-only server is not listening there. So until a
  boundary-crossing endpoint is built, a containerised launch (a `run` on a known
  launcher — `process::launches_in_container`, the same reading the marker rewrite and
  the mount map use) is not offered the bridge at all: the descriptor would advertise
  tools every call to which dials the container's own loopback, and the model would
  keep trying them or claim to have used them. Withholding rides the existing
  `tools_lost` conjunction, so the agent is told by the `NO_TOOLS` notice instead of
  discovering it one dead call at a time. Binding wider stays refused by default —
  widening makes the bearer token the only boundary instead of the second one.
- **Two containers per conversation is the thing to rule out.** A hosted ACP agent runs
  its own tools and never goes through `run_command`, so giving it both an agent
  container and a command container produces two independent writable views of one
  workspace. Native conversations use the command container; `agent_kind =
  'claude_code'` uses the agent container as its only execution environment.

## Logging

`tracing` events at info and above go to `{app_data_dir}/logs/meridian.log` as JSONL, rotated by size (5 MB × 5). The user reads them in Settings → About → View logs; the assistant reads them through the `read_app_logs` tool, which the `meridian-diagnostics` skill drives. All three share `logging::reader::query`.

- **Never log message bodies, prompts or tool output.** Log a length instead (`chars = body.chars().count()`). Exported logs leave the machine.
- Credentials are redacted by field name plus `secrets::sanitizer::redact_secrets`, but do not rely on it — don't put a key in a log line to begin with.
- `error = %e` beats `format!("{e}")`: the visitor walks `source()` and records the whole chain.
- Open a span where a request begins (`info_span!("chat", conversation_id = %id)`). Everything logged underneath inherits it, which is what makes "why did *this* conversation fail" a single query.
- New call sites default to `debug!`. Only user-visible state changes and failures earn info and above, because only those reach the file.
- `RUST_LOG` steers stdout only. The file level is the `logging.level` preference, so a debug session cannot evict the records it was meant to keep.

## The schema canvas

`#playground/schema` (`pnpm schema`) draws the database with React Flow: every table
full-height with all its columns, edges anchored to the *column* rather than the table,
and a panel with the whole of what a table means. `src/dev/schema-lab.tsx` only draws —
whether an edge is a foreign key, whether a column is worth emphasis, all of it comes
from `src/dev/schema-data.ts`, which is the single source both halves of this feed on.

- **Half of that data is prose and only a person can write it.** Which table has which
  column is recoverable from the migration; *why `parent_id` carries no foreign key*, why
  `NULL` and `0` are different answers on the cache columns, why the price is copied onto
  the audit row — none of it is. A new column is worth a line saying what it decides;
  a new table is worth `note` / `rels` / `rules`.
- **The other half is checked by a machine, against a real SQLite.**
  `scripts/check-db-schema.mjs` runs every `migrations/*/up.sql` into an in-memory
  `node:sqlite` — under `PRAGMA foreign_keys=OFF`, which is how `db/mod.rs:78` runs them —
  and reads the result back through `PRAGMA table_info` / `foreign_key_list`. Structure
  that drifts is worse than no diagram: it is wrong in a way that reads as authoritative.

  It used to parse the SQL itself, and that version was wrong about the one thing worth
  being right about. `ALTER TABLE … RENAME TO` does not just rename: since SQLite 3.25 it
  **rewrites the `REFERENCES` clauses of other tables that point at it** — under both
  `foreign_keys` settings, measured on 3.50.4. Migration 24 is exactly that shape, and a
  checker that models a rename as a rename goes quiet precisely where it is needed.

  What that turned up was a real defect: migration 24 rewrote
  `tool_permissions.mcp_server_id` to point at `mcp_servers_old`, then dropped that table.
  Migration 48 removes `tool_permissions` because no runtime code ever read or wrote it,
  and removes the exception machinery with it. The checker now treats every dangling
  foreign key as an error; there is no waiver list that can make one look healthy.
- **`--staged` is what `pre-commit` runs**, and the distinction is the point: a working-tree
  check passes when the migration is staged and the matching edit to `schema-data.ts` is
  not, and then the commit contains a version where the structure moved and the diagram
  did not.
- **Needs Node >= 22.18** (`engines`, and the script says so itself before failing):
  it imports the `.ts` directly and relies on built-in type stripping, so nothing in
  `schema-data.ts` may be non-erasable syntax — no `enum`, no `namespace`. `node:sqlite`
  still needs a flag on Node 22, which the script re-executes itself to add, so callers
  only ever say `node scripts/check-db-schema.mjs`.
- **The layout is derived, not written down.** Nodes are as tall as their column count, so
  a hand-placed `y` would need rewriting every time a column lands. `schema-data.ts`
  declares only which canvas column a table sits in and in what order; the rest falls out
  of the row counts, and a table missing from that list throws rather than silently
  stacking at the origin.
- React Flow is a real dependency, not a dev-only one — the canvas is where it earned its
  place, but nothing about it is playground-specific.

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

  **A tool call is drawn, never dumped, and a new tool is registered before it ships.** `lib/tool-renderers.ts` decides per tool how its arguments (`fields` / `diff` / `command` / its own block) and its result (the `tool-output.ts` parsers, `markdown`, `text`, `structured`) are drawn; `tool-renderers.test.ts` reads every built-in name out of the Rust sources (the `Tool` impls under `tools/`, the `…_TOOL` constants, the QQ tool table) and `HOSTED_TOOL_NAMES`, and fails for any without an entry. MCP and custom tools, whose names cannot be known, get the generic renderer: `components/ui/tool-value.tsx` draws any JSON value as fields, tables, lists and tokens and MCP `content` arrays by part, and streaming arguments are read with `parsePartialObject` rather than shown as a fragment. `meridian-ui/no-json-tool-display` refuses `JSON.stringify` on the rendering path; a payload rather than a display takes a disable comment with a reason.

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
- **Controls and dialogs are the base layer's, not the browser's.** `<details>`, `<progress>`, `<meter>`, `<select>` and friends, and `alert` / `prompt` / `window.confirm`, are UI nobody designed, and the lint names the base replacement for each (`Disclosure`, `ProgressCircle`, `Select`, `useConfirm` / `AlertDialog`). A native `title` is no longer on that list: the ban came from the HeroUI-era taste profile, not from BoardUI, and it bought a tab stop or a wrapper per hint for the sake of a delay and a font. Use `title` for plain overflow text; reach for `ui/hint.tsx` (a `Tooltip.Trigger` rendered *as* the text's own element) when the extra text is something a keyboard user needs too.
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

**Android gets its sherpa-onnx libraries from the crate, like every other
target.** Up to 1.13.5 `sherpa-onnx-sys` had no Android entry in its download
table, so `scripts/fetch-sherpa-android.sh` fetched them, `SHERPA_ONNX_LIB_DIR`
pointed the build at them and a second gradle `jniLibs` source directory
packaged them. 1.13.8 downloads the Android archive itself and copies the
libraries into `gen/android/app/src/main/jniLibs/<abi>/` beside Tauri's
`libmeridian_lib.so`, stamping `.sherpa-onnx-version` there (ignored, like the
`.so` files). The old arrangement was removed rather than kept beside it: the
crate's copy has no switch, and with the second source directory still in
place the same library would reach gradle twice and AGP refuses duplicates.

Two things about the crate are worth knowing. **Leave `SHERPA_ONNX_LIB_DIR`
unset.** It is still honoured for every target without checking which, and
cargo caches the resolved path in
`target/<profile>/build/sherpa-onnx-sys-*/output` past the variable being
cleared — a desktop build in a shell still holding an Android path fails at
`link.exe` with `LNK1181` naming neither. **And delete
`src-tauri/target/sherpa-onnx-prebuilt/jniLibs` before building after a
sherpa-onnx upgrade.** The Android archive has no top-level directory, so it
unpacks to that unversioned path, and the next version's build script finds it
before it looks for its own archive — then stamps the old libraries with the
new version. CI is not exposed: rust-cache keys on `Cargo.lock`, so an upgrade
is a cold cache there.

### The input method

**Both Windows installers carry it as an optional component, and both are
built from forked templates.** `tauri.ime.conf.json` is the whole switch:
`pnpm tauri build --config src-tauri/tauri.ime.conf.json`, which the
release workflow passes on Windows, points `bundle.windows.nsis.template`
at `src-tauri/nsis/installer.nsi` and `bundle.windows.wix.template` at
`src-tauri/wix/main.wxs` — each a verbatim copy of tauri-bundler 2.9.4's
template (the bundler inside `@tauri-apps/cli` 2.11.4) with every change
marked `Meridian:`, and a header saying to re-diff against upstream on a
Tauri upgrade. A plain `pnpm tauri build` uses the stock templates and
produces the old per-user installer without the input method, which is
what a development build wants. The artifacts are *not* in
`bundle.resources`: the stock resource list lands in the mandatory part of
both installers, which is exactly what optional means they must not do.

**NSIS: a components page, a read-only main section, and everything the
input method does in `nsis/ime-hooks.nsh`.** The fork adds
`MUI_PAGE_COMPONENTS`, names the stock `Section Install` and marks it
`SectionIn RO`, and adds `Section "Meridian 输入法" SecIME` whose body is
`IME_SECTION_INSTALL` from the hooks file — copy the files, `icacls`
`*S-1-15-2-1` (AppContainer apps must read the DLL, and the name of that
group is localised), `regsvr32 /s` both DLLs, prune older versions, an
all-users Startup shortcut for `meridian-ime-host.exe`, and
`nsis_tauri_utils::RunAsUser` to start the host. The section body stays in
the hooks file rather than the template so the template's diff against
upstream is a few dozen lines, and the hooks include is moved below the
`!define` block because the hooks file names the DLL after `${VERSION}` at
include time — where upstream puts it, at the top, that define does not
exist yet. `${SecIME}` likewise only exists once the section has been read,
so the `.onInit` logic is a function defined after the sections.
`IMEInstalled=1` under the product's uninstall key is the marker: `.onInit`
preselects the section from it, so an update — the updater's `/UPDATE /P`
never shows the page — keeps the input method exactly when it was there
before, and a hidden section after `SecIME` takes an earlier install's
input method out when the box was unticked. `/NOIME` on the command line
deselects it, for silent and passive installs. The uninstaller unregisters
only what it finds on disk, and only when not updating. Bundling with the
config and without the staged artifacts is a `!error` at makensis time,
not an installer whose section copies nothing.

**The DLL is version-named and the old one is never unregistered.** A text
service is mapped into every process with a text field, so the file in use
cannot be replaced in place: `build.rs` stages
`meridian_ime_tsf-<version>.dll` (and `meridian_ime_tsf32-<version>.dll`),
the new version registers the same CLSID over the old, and older files are
deleted with `/REBOOTOK` once nothing holds them. `regsvr32 /u` on an old
file would remove the registration the new one had just written, because
they share it. That is also why `build.rs` asserts `tauri.conf.json`'s
version equals `Cargo.toml`'s: the NSIS `${VERSION}` names the file.

**`$WINDIR\Sysnative\regsvr32.exe`, not `$SYSDIR`.** The installer is a
32-bit process, so `$SYSDIR` is redirected to `SysWOW64` and would register
the 64-bit DLL with the wrong loader; `Sysnative` is the alias that reaches
the real `System32` from a 32-bit caller. The x86 DLL goes through
`SysWOW64\regsvr32.exe` explicitly. TSF profile registration is what makes
the installer `perMachine`: `DllRegisterServer` writes the CLSID and the
zh-CN / zh-TW profiles under HKLM, and there is no HKCU registration path
that `ctfmon` honours. The hooks run the previous per-user copy's
uninstaller first so the machine install does not leave two copies.

**MSI: a `Feature Id="IME"` in `wix/ime.wxs`, registered by the SelfReg
table.** `SelfRegCost="1"` on the two DLLs has Windows Installer call
`DllRegisterServer` / `DllUnregisterServer` itself, in a surrogate of the
DLL's own bitness — so the 32-bit DLL has to be a `Win64="no"` component,
and ICE80 refuses one of those under `ProgramFiles64Folder` as an error
(Tauri passes light no `-sice`), so it lives in
`Program Files (x86)\Meridian\ime` with its own copy of the icon, which
`DllRegisterServer` looks for beside the DLL. No custom action registers
anything; the one deferred custom action is the `icacls` grant,
`Return="ignore"`. The feature is `Level="1"` (selected by default) with
`AllowAdvertise="no"`, and `msiexec REMOVE=IME` leaves it out. Three things
the stock template could not give it. The fork swaps `WixUI_InstallDir` for
`WixUI_FeatureTree`, because the stock UI has no dialog in which a feature
can be unticked (the directory is still changeable, through Browse on the
`ConfigurableDirectory` feature). It hoists `featureRefs` to top level,
because the stock template makes them children of the untitled `External`
feature. And the versioned file names come through `resources/ime.wxi`,
which `build.rs` writes (`write_ime_wxi`): Tauri runs a fragment through
Handlebars only to scan it for extension namespaces, so `{{version}}` stays
literal there, and light resolves a relative `Source` against
`target/<profile>/wix/<arch>`, so the include also carries the absolute
staging directory. The feature title is ASCII because the database is code
page 1252. Across a major upgrade the old product's `SelfUnreg` runs before
the new `SelfReg` (`Schedule="afterInstallInitialize"`), so the
registration is briefly absent and then rewritten; the NSIS path never has
that gap.

**The x86 DLL is a second cargo invocation outside Tauri's build, and the
whole input method builds into `target/ime/`.** 32-bit apps (WPS, the
32-bit QQ) load a 32-bit text service, and Tauri's build has one target.
`pnpm ime:build` builds the x64 DLL and host, then the DLL again with
`--target i686-pc-windows-msvc` (`rustup target add` it first), all under
`--target-dir target/ime`; `build.rs` copies whatever it finds there into
the gitignored `resources/ime/`, warns when something is missing, and
panics instead under `MERIDIAN_IME_REQUIRED=1`, which the release workflow
sets so an installer without the input method cannot ship by accident.
The separate target directory is not tidiness: the MSI bundler ships every
`*.dll` it finds beside the main binary, so an unversioned
`meridian_ime_tsf.dll` in `target/release` would be packaged a second time,
in the root, registered by nothing. `resources/ime.stamp`, touched by
`pnpm ime:build`, is what makes `build.rs` re-run for artifacts that did
not exist on the previous build — cargo treats a missing
`rerun-if-changed` path as always changed, so the artifacts themselves are
only watched once they exist.

### The Android keyboard

**`libmeridian_ime.so` is a third cargo invocation, and Gradle makes it.**
`scripts/build-ime-android.mjs` builds `meridian-ime-android` for
`aarch64-linux-android` and copies the library into
`src/main/jniLibs/arm64-v8a/`, beside what Tauri and sherpa-onnx put
there; `buildImeRust{Debug,Release}` in `app/build.gradle.kts` runs it
before every JNI merge, so `pnpm tauri android build` cannot produce an APK
without the keyboard. It takes the NDK from the environment the release
workflow already exports, and otherwise finds the newest one. It is Node,
not bash, because Gradle on Windows can resolve `bash` to WSL's. arm64 only.

**The library must be 16 KB aligned, and the script refuses it otherwise.**
A 16 KB-page device will not load anything less, and the symptom is a
keyboard that never appears. NDK r28 aligns to 16 KB by default; the check
(`llvm-readelf -lW`, every LOAD segment) is what keeps that true, and
linking with `max-page-size=4096` was used to see it fail. It links no ONNX
Runtime: the scorer opens sherpa-onnx's `libonnxruntime.so` by name at run
time.

**Three version ceilings, all measured on 2026-09-25.** Kotlin is 2.2.21
because Tauri's own Android projects (built from the cargo registry, so not
ours to edit) still write `kotlinOptions { jvmTarget }`, which 2.3 made an
error — Tauri's dev branch has moved to `compilerOptions`, so this lifts
with the next release. Compose stays on 1.11 (BOM 2026.06.01) because 1.12
needs compileSdk 37 and AGP 9.1, and AGP 9's built-in Kotlin conflicts with
those same projects applying `kotlin-android`. And material3 is
1.5.0-alpha18, because 1.4.0 keeps the Expressive API internal and alpha18 is
the last 1.5 built on Compose 1.11. The comments beside each pin say the same.

## Android

- **File access model**: tools resolve paths through `ToolContext::resolve_and_validate` (`src-tauri/src/tools/mod.rs`). Desktop = `FileAccess::Unrestricted` (legacy working_directory check). Android = `FileAccess::Roots` whitelist built in `build_file_access` (lib.rs) from preferences `android.manage_storage_enabled` / `android.saf_roots` + the system grant. SAF I/O goes through `src/android_bridge.rs` (JNI) → `FileBridge.kt`.
- **run_command is compiled out on Android** (`#[cfg(not(target_os = "android"))]` in tools/mod.rs).
- **Hand-maintained files inside `src-tauri/gen/android/`** (tracked in git; if `tauri android init` is ever re-run, merge these back manually): `app/src/main/AndroidManifest.xml` (storage permissions), `app/src/main/java/cn/yuxiaoqiu/meridian/MainActivity.kt` (SAF picker + `nativeOnSafResult`, window insets, and `handleBackNavigation`), `FileBridge.kt` (ContentResolver ops), `app/build.gradle.kts` (androidx.documentfile dependency, Compose, `compilerOptions`, `buildImeRust*`), `build.gradle.kts` (the Kotlin and Compose compiler plugin versions; see "The Android keyboard" under Packaging).
- **The keyboard is a padding, and every `svh` between it and the composer defeats it.** The WebView is not resized when the soft keyboard opens — `MainActivity` measures it and reports `imeBottom`, and `app-shell.tsx` shrinks the frame with `pb-[var(--ime-bottom)]`. That only reaches the composer if nothing in between insists on a viewport height. HeroUI Pro's sidebar did (`.sidebar__main` was `min-height: 100svh`); the base sidebar that replaced it sets none, and `Sidebar.Main` keeps `min-h-0` so that a height floor reintroduced there cannot quietly leave the pane a full screen tall while the frame around it shrinks. Nothing catches this: it is correct on every desktop, and `tsc`/`eslint`/`vitest` have no layout between them. The bottom insets are also exclusive, never summed — while the keyboard is up it covers the navigation bar, so `MainActivity` reports `bottom: 0` and the whole gap as `imeBottom`.
- **The back key is the web history.** `WryActivity` routes it through `WebView.canGoBack()`, the generated `TauriActivity` disables that, and `MainActivity` turns it back on. So something is undone by the back gesture exactly when it pushed a `history` entry for itself — `useHistoryLevel` is the only way to do that, and `lib/history-bridge.ts` the only writer of history. Never call `history.back()` anywhere else: the store is updated from `popstate` alone, which is what keeps it from drifting. There are no screens to go back to any more, only levels inside one — a drawer, a detail pane, a non-empty selection. `useBackGesture`, called once by the shell, decides whether the gesture is ours at all; everything below it is inert on a desktop.
- **History is reconciled, not commanded.** A level changes the store and calls `syncHistory`, which brings `window.history` to `levels.length` on the next microtask. It is deferred because a hand-over — the drawer closing as a page opens, which is every row in the mobile sheet — changes the store twice in one commit, and the two eager operations that used to produce do not commute: `history.go(-n)` resolves its target against the entry current when it is *called*, so a `pushState` landing in between is skipped and the traversal overshoots. Settings opened and was closed again by the popstate its own drawer had queued, which read as the page flashing and bouncing back. Coalesced, a hand-over costs no history operation at all. Nothing else may call `pushState` or `go`, and a level's effect must not assume its entry exists yet — it does not until the microtask runs, which is why the tests need an awaited `act` around anything that opens a level.
- **Build**: `pnpm tauri android build --target aarch64`. Rust-only check: `cargo check --target aarch64-linux-android` with NDK clang env vars.
- **Run that check before calling a refactor done.** A desktop build never compiles a line inside `#[cfg(target_os = "android")]`, so anything wrong in one is invisible to `cargo test`, to clippy, and to review. The core extraction hit this twice in a day: four state lookups in `platform.rs` and two `crate::` paths in `android_bridge.rs` that had been rewritten to `meridian_core::`, all of them inside android-only blocks and all of them green on the desktop. It needs the `aarch64-linux-android` target on the pinned toolchain and the NDK clang variables; the sherpa-onnx libraries download on their own (see the Packaging note).

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
`run_command` and writes. On that path, "nobody answered" must mean **deny**.

This paragraph used to end by warning that Claude Code proceeds on a timed-out hook and
that the feature should not ship if it could not be made to fail closed. That is the rule
for most events and not for this one: `PermissionRequest` has error handling of its own,
and a hook that times out, crashes or prints something unparseable falls back to **`ask`**
— the ordinary prompt in the terminal. Exit code 2 is ignored there; denying is done
through the `decision` field. So the failure mode is "the user is asked normally", which
is the safe one, and the blocker this named does not exist. (Not that it now matters for
hosting, which went the ACP route — but it still decides how a `PermissionRequest` gate
would behave for sessions started outside Meridian.)

**Design the queue around "a pending request from some agent", not around Claude Code's
payload.** Codex, OpenCode and the rest each need an adapter; the queue, the cards and
the status derivation should be shared. Shaping the queue to one vendor's hook format
means rewriting it for the second.

**Order of work.** This was written cheapest-first and step 3 was done first anyway,
because ACP turned out to cost far less than the paragraph above assumed — the protocol
carries the lifecycle, so there was nothing to reverse-engineer. What is left:

1. ~~Session panel~~ — done, see `acp/import.rs`. Worth keeping the correction it turned
   on: **not by tailing `~/.claude/projects/<project>/<session-id>.jsonl`**, which is what
   this said before the adapter was read properly. It advertises
   `sessionCapabilities: { list, resume, fork, delete, close }`, and `session/list` answers
   with `{ sessionId, cwd, title, updatedAt }` per session, optionally scoped by directory.
   So there was no format to reverse-engineer and no file to watch.

   What that leaves is a session started anywhere becoming a conversation here, transcript
   and all — and the rescue of a conversation from before migration 38, which has a
   directory and no id, through the same list.

   Two things it does *not* do, both deliberate. It **takes a session over rather than
   copying it** (`session/fork` exists but does not replay, so a copy would cost a load and
   a fork), which means importing one a terminal still has open leaves two processes
   appending to one file — the list shows `updatedAt` and nothing enforces more. And it
   **cannot exclude Meridian's own sessions from the list**: the SDK's `includeProgrammatic`
   defaults to true and the adapter does not forward the parameter, so they are marked
   against `acp_sessions` instead — which is the better answer anyway, since hiding them
   makes "where did that session go" unanswerable.
2. Approval queue for sessions Meridian is *not* hosting — forward `PermissionRequest` to
   Meridian, card beside the thread. The timeout semantics are settled (see the correction
   above: it falls back to `ask`), and the queue itself already exists — `attention` /
   `attentionOrder`, which the ACP path reuses unchanged. Less pressing now that a terminal
   session can simply be imported, which brings its approvals onto the ACP path with it.
3. ~~Hosting a session in-process~~ — done, see the ACP section.

**Deferred from remote access**, roughly in order of how much they are missed:

- **Tools run wherever the turn runs, which is the host.** Choosing a device per
  conversation means turning the tool surface into a port a device registers against, and
  approval cards naming which machine a command lands on. It is the prerequisite for
  editing the desktop's files from a phone, and the reason `run_command` is not offered a
  choice today.
- **Per-connection event filtering.** Every authenticated client gets every event and
  filters by conversation as the window already does. Fine for one owner; it is both the
  privacy prerequisite for more than one and a bandwidth win on mobile.
- **Attachment thumbnails in remote mode** — needs an object URL per `File` and a
  revocation lifecycle. They fall back to the extension icon.
- **Pairing by QR and mDNS discovery**, so the address and token are not typed by hand.
- **Transport encryption** — a self-signed certificate with fingerprint pinning, or making
  "LAN cleartext, use Tailscale if you want more" the documented position.
- **Remote voice input**: PCM over a binary frame, which would let the microphone stay on
  the device the user is holding.
- **A headless `meridian-server`.** `bootstrap` is already framework-free; what it needs is
  `commands/` moved into core, which is the one thing PR1 found it did not have to do.

**Hosting is built — see `src-tauri/crates/core/src/acp/`.** This paragraph used to say
the shape to copy was `~/.claude/ide/`, where the *editor* drops a lockfile and acts as
the server, and that copying it would give Meridian no session-lifecycle events. That is
true of that mechanism and it is not what Zed uses: Claude Code is reached over **ACP**
(the Agent Client Protocol), where the editor is the *client* and the agent —
`@zed-industries/claude-code-acp`, a wrapper over the Claude Agent SDK — is a child
process it speaks JSON-RPC to over stdio. The lifecycle is the protocol, so the objection
does not apply. Driving `claude --print --output-format=stream-json` directly was the
other candidate and lost on portability: ACP is one vendor-neutral shape, and the second
agent to be hosted costs an adapter rather than a rewrite.
