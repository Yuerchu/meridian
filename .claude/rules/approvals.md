---
paths:
  - "src-tauri/crates/core/src/agent/auto_review/**"
  - "src-tauri/crates/core/src/approval.rs"
  - "src-tauri/crates/core/src/agent/denied.rs"
  - "src-tauri/crates/core/src/agent/call_identity.rs"
  - "src-tauri/crates/core/src/agent/loop_guard.rs"
  - "src/components/settings/auto-review-settings.tsx"
---

# Approvals: automatic review and the approval lifecycle

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
