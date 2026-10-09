---
paths:
  - "src-tauri/crates/core/src/agent/queue/**"
  - "src-tauri/crates/core/src/agent/queue.rs"
  - "src-tauri/crates/core/src/db/ops/queue.rs"
  - "src-tauri/crates/core/src/db/ops/queued_prompt_context_item.rs"
  - "src-tauri/src/commands/queue.rs"
---

# The prompt queue

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
  `queue_release` is a person deciding otherwise. The agent board's card composer never
  calls it: a message typed on a card whose turn failed starts a new turn, and what was
  queued behind the failure stays held for the transcript to decide (`board.md`).
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
- **Attachments are frozen at enqueue, and an interjection is text.** A queued
  message carries the same parts envelope a sent one does (`content` has said so
  since migration 34), built and uploaded when it is queued — the copy the
  person saw, as an `@` snapshot is. Neither runner has anywhere mid-turn for an
  image or a file, so an interjection may carry neither attachments nor frozen
  `@` context, and the refusal lives in `db::ops::queue::set_delivery` as well
  as at enqueue: the queue's steer button switches a row's delivery and never
  passes enqueue, so a check made only there is one it steps round (a frozen
  snapshot steered in arrived without it). A hosted session is asked at enqueue
  whether its agent can take the attachments (`AcpSession::check_attachments`);
  at delivery a refusal **holds** the queue rather than returning an error,
  because an unclaimed item refused on every pump sits at the front blocking
  everything with nothing on screen. The in-doubt report names attachments
  rather than quoting the envelope's local paths.
- Known gap: a QQ turn started from the chat side drains its own inbox and not this table,
  so an interjection queued during one waits for something else to pump.
