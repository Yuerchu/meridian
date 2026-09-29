---
paths:
  - "src-tauri/crates/core/src/acp/**"
  - "src-tauri/crates/core/src/db/ops/acp_*.rs"
  - "src/components/settings/acp-settings.tsx"
---

# Hosting Claude Code (ACP) and the tool bridge

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
`#[ignore]`d, spends quota, and should be re-run before the pinned adapter version
(`ADAPTER_PACKAGE` in `acp/mod.rs`) is moved.

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
