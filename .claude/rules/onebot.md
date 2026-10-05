---
paths:
  - "src-tauri/crates/core/src/onebot/**"
  - "src-tauri/crates/core/src/voice_corpus/**"
  - "src-tauri/crates/core/src/voice_corpus.rs"
  - "src-tauri/crates/core/src/tts/**"
  - "src-tauri/crates/core/src/tts.rs"
  - "src/components/settings/onebot-settings.tsx"
  - "src/components/settings/voice-corpus-settings.tsx"
  - "src/components/settings/voice-settings.tsx"
---

# OneBot (QQ)

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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

- **Each inbound message keeps the instant it arrived, and that instant is what
  the model is shown.** `IncomingMessage::received_at` is the inbox item's
  `created_at`, written as the row's `created_at` and rendered as its `<sent_at>`.
  The rows of one round used to share a single `now_ms()` taken when the round
  began, so a message that waited in the inbox through a long turn was stamped
  minutes late; and the live `ChatMessage` was built before that `now` was even
  taken, so the replay could never have matched. `incoming_rows` builds the row
  and the live message from the same fields, and the gate test renders both and
  compares bytes on a fixed past instant. Nothing orders rows by `created_at`,
  so a queued message predating the previous round's assistant row costs nothing.

  **The speaker is resolved through the subject table on both sides.** History
  rows take their nickname from `memory_subjects`; the live message used to take
  it off the event, and an event with an empty nickname rendered `<sender>1</sender>`
  while its replay rendered `<sender>张三(1)</sender>` — a divergence at exactly
  the message the cache was keyed on. Live, steered and replayed messages all go
  through `sender_ref(uid, &sender_names)` now. That is also why `touch_subject`
  moved ahead of `try_begin_turn`: a message that gets *queued* returns from
  there without reaching anything below, and the round that drains it later
  reads names off a table its speaker was not yet in.

  **The roster is last, so a breakpoint only there is a prefix nobody repeats.**
  On Anthropic the cache marker went on the last block of the last message —
  the roster, rebuilt every turn and never persisted — and the next turn's
  history did not contain it, so no history token was ever read back from the
  cache on QQ. A third marker on the last persisted user message fixes it; see
  the Anthropic paragraph in `providers-and-billing.md`.

  **A private admin chat can hold a checklist; a group cannot.** `ToolExposure::All`
  reaches `update_todos` in a private chat, so the frozen `todo|…` row (CLAUDE.md,
  "Memory is frozen into the history") is written on QQ too, after the memory row;
  a group sees only `OPEN_REGISTRY_TOOLS` and the planner is a no-op there.
