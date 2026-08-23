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
src/                        # React frontend
src-tauri/
  src/                      # the shell: the only place that knows about Tauri
    lib.rs                  # setup, tray, window, generate_handler!, APP_HANDLE
    commands/               # #[tauri::command] entry points
    platform.rs             # platform detection + Android storage commands
    android_bridge.rs       # the Java_* symbols MainActivity.kt calls back into
  crates/core/              # meridian-core: everything framework-free
    migrations/             # embed_migrations! resolves against this crate root
    src/
      agent/engine/         # the turn loop, and the ports the runners plug into
      db/ provider/ tools/ mcp/ secrets/ …
      onebot/ hooks/        # the two non-desktop runners
      acp/                  # hosting another coding agent, as its client
      services.rs           # every long-lived thing, in one value
      events.rs             # EventBus: where an event goes once it has happened
      bootstrap.rs          # bootstrap(data_dir, events) -> Services
  crates/sandbox-types/     # sandbox policy types
  crates/sandbox-windows/   # Windows sandbox implementation
```

## Key Design Decisions

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
- **The transcript follows the stream, then hands it back.** `src/lib/message-scroller.tsx` is a fork of `@shadcn/react/message-scroller` (the package is gone; the styled wrapper in `components/ui` is unchanged). Upstream anchors a new turn to the top of the viewport and holds it there for as long as the answer streams — with a question taller than the viewport that hold never releases, so the whole answer is written off-screen. Here there are two modes: `follow` sticks to the live edge, `idle` moves for nobody but the reader. Anchoring falls out of following instead of competing with it — a spacer re-solved every frame makes "scrolled to the end" and "question at the top" the same position until the answer outgrows the viewport. A turn that stops streaming while the reader is still following scrolls back to the top of its answer (`MessageScrollerAnchor` / `answerAnchorId`); one they had scrolled away from does not move. Row identity is not a scroll trigger: re-keying a row when its reload lands used to jump to the top of the conversation. Drive changes through the harness at `#playground/scroll` — "跑全部场景" replays every behaviour above and asserts it.
- **One shell, on every platform.** `components/layout/app-shell.tsx` is the whole frame; there is no mobile variant and nothing branches on width. The sidebar *is* the conversation list — a panel above 768px, `Sidebar.Mobile`'s sheet below it, both rendered from the same tree — and settings is a page beside the chat rather than a screen over it. The chat stays mounted underneath, `inert`, because unmounting it loses the composer draft and the transcript's scroll position. There used to be a stack of screens for phones, selected by a width read once at startup; that seam is what made a narrow Windows window and a tablet in landscape both wrong. What survives of it is `useHistoryLevel`, which is about the back gesture and not about layout.
- **A question waiting on a person is not part of a session.** `sessions[id].pendingApprovals` says which id a *card* is waiting for and is only ever written for a conversation somebody has opened — `ensureSession` runs when `ChatView` mounts, and `handleToolApproval` returned early without one. That is right for a card and wrong for everything else: with several conversations working at once, the ones that stop for permission are mostly ones nobody is looking at, so the event announcing them was being dropped entirely. The sidebar dot never lit for them either.

  So `attention` / `attentionOrder` sit beside `sessions` rather than inside one, and every path that retires an approval — result, stop, orphan, nested resolve — clears the queue *before* its `if (!session) return`. `ConversationIndicator` reads the queue, not the session. `approval-toasts.tsx` draws the front of it as a stack of toasts and `commands::approval::all_pending_approvals` rebuilds it after a reload or a remote connect, since the announcing event is never replayed.

  **Order is ours, and reconciling it to `ToastQueue` needs two facts that the API hides.** `add` *unshifts* (`react-stately/dist/private/toast/useToastState.mjs`), and the frontmost row — the only one that is not `pointer-events-none`, and the only one in the tab order — is `visibleToasts[0]` (`isFrontmost = index <= 0` in HeroUI's `toast.js`). So the row added *last* is the one that can be pressed, and the queue is rebuilt back-to-front on every change of the *sequence*. Diffing by set instead is the trap: deferring the front of three visible rows leaves the same three ids on screen, so a set diff finds nothing to do and the button silently does nothing. Also pass `maxVisibleToasts` to the *provider* — the queue keeps its own copy but hands react-stately `MAX_SAFE_INTEGER`, so the stack depth is decided on the provider or not at all.

  **An answer has to retire the queue entry itself** (`retireAnsweredApproval`) — from the toast, from the approval card and from the `ask_user` form alike, since all three are places an answer can be given and none of them is on the queue's side of the wall. A delegated run's question is *asked* on the parent — `approval_adapter.rs` routes it there because nobody is necessarily watching the sub-agent — while its result and its stop are emitted on the sub-agent's conversation, and both retiring paths match on conversation id. Nothing would ever close it: a permanent dot on the parent and a dead row in the queue. For an ordinary approval the result does come, but minutes later, and in the meantime moving to another conversation would pop a toast offering buttons for a decision already made. What that call must *not* do is touch the card: clearing an ordinary card's `approval_id` leaves it at `status: 'pending'`, which `mapChatToolState` draws as `requires-action` — demanding an answer with no way to give one — and `handleStop` reads `pendingApprovals` to write off a call whose turn died before its result arrived.

  **Deferring is the only way past a row**, which is why there is no close button: the question is still owed either way, and a dismissal that ended a turn's only visible sign would make a mis-click expensive. The conversation being read is excluded, because its card is already at the live edge.

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
- **`ask_user` and the mode transitions are never answered here.** A `Response` is the
  answer to a question and only `ask_user` asked one; `exit_plan` is the user being shown
  a plan, not a permission being checked. Both go straight through.
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
- **Stopping does not abandon the request.** `session/cancel` is a notification, and the
  agent still answers the prompt it interrupts with `stopReason: cancelled`. Waiting for
  that reply is what lets a stopped turn end down the ordinary path with whatever text had
  already arrived; dropping the future instead leaves the adapter mid-turn with nobody
  reading, and the next prompt collides with it.
- **Approvals go through `services.approvals`, unchanged.** Same register, same
  `tool_approval_req` event, so the attention queue, the toast stack,
  `all_pending_approvals` after a reload and the turn guard all work here without knowing
  ACP exists. The cost: ACP offers four options and `ApprovalDecision` has two, so only the
  `_once` pair is offered — a card with two buttons must not produce a lasting decision the
  user was never shown.
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
- **The model is read off the session's config options.** ACP has no model field; it
  carries the model as a configuration option whose `category` is `model`, present in the
  `session/new` response and re-sent as a `config_option_update` whenever it changes. That
  is what lands in `messages.model_id`, so a hosted transcript names the model that
  actually answered. `claude-code` in that column is the fallback and means the adapter
  did not say — it is not a model id and nothing may treat it as one.
- **`toolCallId` is unique per session here, and nowhere else in this app.** So the ACP
  layer is the only place that may dedupe by it — and must, because the adapter announces
  a call as soon as it knows one is coming and again once the input has streamed. The
  front end deliberately does the opposite (`handleToolCall` pushes regardless): an
  OpenAI-compatible gateway reuses `"0"` within a turn and two cards there are two calls.
  A repeat revises the card instead; `reviseToolCall` is the only event allowed to match
  on id alone.
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

- **A load replays the whole conversation, and ignoring it is deliberate rather than
  lucky.** `session/load` re-emits the history as ordinary `session/update` notifications
  — every one of them a row this database already has. It happens to fall on the floor
  without any help, because each branch of `absorb` asks `with_turn` first and no turn runs
  during a load; but two branches do not ask, and that is two unrelated rules lining up
  rather than a decision. `Shared::replaying` says it instead, and the gate is held across
  the reply *and* a drain, because the reply takes a different route and overtakes the
  notifications. Saying it out loud is also what makes the opposite answer expressible:
  adopting a session this app did not start needs the replay *written*, since there it is
  the only transcript there is.

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

  What that turned up is a real defect, and how it is recorded is the point.
  `REWRITTEN_REFERENCES` restores **only the target table name** on the SQL side and hands
  the edge back for the ordinary comparison, so the column, the `ON DELETE` and the edge's
  existence on the doc side are all still checked. The first version suppressed the whole
  edge by key, which bought two holes: it could never notice it had become unnecessary, and
  it waved through a changed `ON DELETE` on the one edge already known to be suspect. A rule
  that stops matching is reported, so fixing the migration forces the rule to retire.
- **A defect has to be visible in the drawing, not just next to it.** That edge is
  `kind: 'broken'`, and what it *terminates on* is the part that matters: a tombstone node
  for `mcp_servers_old`, derived from the edge itself and parked left of every layout
  column. Ending it on the live `mcp_servers` would have the line assert the one thing that
  is not true — colour and a label do not outrank where a line stops, and the diagram is
  what gets believed. `to` stays the *intent* (which is what the checker compares against);
  `actualTarget` is the reality, and it is the end the canvas draws.

  The two halves hold each other up: an edge marked `broken` whose target is fine in the
  database is an error, and so is a rewritten reference the data still calls an ordinary
  `fk`. A tombstone is not a node type anyone adds by hand — it exists for exactly as long
  as a broken edge names it.
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

  Two consequences worth knowing before adding one. `useIsNarrow` must measure a
  box whose width does not depend on its own answer — never the column it decides
  whether to render — which is why `MasterDetail` has one unconditional root.
  And `container-type` brings `contain: layout`, making the container the
  containing block for `position: fixed` descendants: Pro's `ActionBar` is one
  and does not portal itself, so the two call sites do it for it.

- **Dev playground:** `http://localhost:5173/#playground` in any dev build (tree-shaken from release). `#playground/scroll` is the scroll regression harness, `#playground/heroui` probes CSS support against the WebView. Add new component states there.
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
- **Run that check before calling a refactor done.** A desktop build never compiles a line inside `#[cfg(target_os = "android")]`, so anything wrong in one is invisible to `cargo test`, to clippy, and to review. The core extraction hit this twice in a day: four state lookups in `platform.rs` and two `crate::` paths in `android_bridge.rs` that had been rewritten to `meridian_core::`, all of them inside android-only blocks and all of them green on the desktop. It needs `SHERPA_ONNX_LIB_DIR` from `scripts/fetch-sherpa-android.sh`, which must be exported into a subshell and not the session — see the Packaging note on why that variable must not outlive the build that set it.

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

Two things that setup does which are not wanted. It appends an `allowBuilds`
block to `pnpm-workspace.yaml` turning those same two build scripts back on —
**revert that**, the refusal above is the deliberate half of this arrangement.
And `pnpm add <anything>` can decide to rebuild rather than extend
`node_modules`, which empties the package again; on Windows it will also fail
outright with `ERR_PNPM_EPERM` if a `vite`/`tauri dev` is running, because the
dev server holds `@rolldown/binding-win32-x64-msvc`'s `.node` open. Stop the dev
servers first, then add, then re-run the setup and check the count.

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

1. Session panel — list sessions Meridian did not start, including ones from a terminal.
   **Not by tailing `~/.claude/projects/<project>/<session-id>.jsonl`**, which is what this
   said before the adapter was read properly: it advertises
   `sessionCapabilities: { list, resume, fork, delete, close }`, and `session/list` answers
   with `{ sessionId, cwd, title, updatedAt }` per session, scoped by directory. So there
   is no format to reverse-engineer and no file to watch — and what it returns is exactly
   what `acp_sessions` already stores, so adopting one is a conversation plus a row.
   It is also the way to rescue a conversation from before migration 38, which has a
   directory and no id: list that directory and let the user say which session it was.
2. Approval queue for those sessions — forward `PermissionRequest` to Meridian, card
   beside the thread. The timeout semantics are settled (see the correction above: it
   falls back to `ask`), and the queue itself already exists — `attention` /
   `attentionOrder`, which the ACP path reuses unchanged.
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
