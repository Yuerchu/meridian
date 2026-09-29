---
paths:
  - "src-tauri/crates/core/src/plan_files.rs"
  - "src-tauri/crates/core/src/db/ops/plan*.rs"
  - "src-tauri/crates/core/src/agent/modes.rs"
  - "src-tauri/crates/core/src/acp/plan_review.rs"
  - "src/components/plan-review/**"
---

# Durable plan documents

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
