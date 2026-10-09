---
paths:
  - "src-tauri/crates/core/src/background.rs"
  - "src-tauri/crates/core/src/tools/background.rs"
  - "src-tauri/crates/core/src/db/entity/background_task.rs"
  - "src-tauri/crates/core/src/db/sea/ops/background_task.rs"
  - "src-tauri/crates/core/src/db/sea/migration/m0003_background_tasks.rs"
  - "src-tauri/src/commands/background.rs"
  - "src/components/chat/background-tasks-chip.tsx"
  - "src/hooks/use-background-tasks.ts"
---

# Commands in the background

`run_command` with `run_in_background` answers at once with a task id and leaves the
command running (`crate::background`, table from `m0003_background_tasks`). Three tools go
with it — `read_background_output`, `stop_background_task`, `list_background_tasks` — none
of which asks permission, because each is scoped to its own conversation's tasks and only
reads or stops what an approved command started.

- **The same path as any other command.** `sandbox::execute_teed` is `execute` with a tee:
  the restricted token, the process-tree kill, the cancellation and the timeout (four hours
  here) are the foreground's, and each chunk of output is also appended to a log capped at
  16 MiB. A container returns its output only once it has finished, so a background command
  there is refused rather than run without the log it was started for.
- **Its ending is a debt, recorded on the row.** `notified_at IS NULL` on an ended task means
  the model has not been told. Every native turn pays it before it answers
  (`background::claim` in `chat_inner`, before the history is read), a turn already running
  pays it at its next round (`TaskNotices`, chained after the queue's interjections), and a
  completion or failure this process watched also *wakes* a turn to pay it — the queue's
  pump starts one through `StartTurn::start_unprompted`, ahead of the queue and even with
  the queue held, since it is something that happened rather than an instruction. The wake
  turn is `trigger = task_completion`, naming the task in `trigger_ref`, so the transcript
  draws it as a turn of its own.
- **What wakes nothing, and why.** A stop is somebody's decision: one by a person is still
  told at the next turn, one by the model is marked told at once. A task lost to a restart
  (`bootstrap::startup_recovery` turns `running` into `lost`, before anything can start a
  task) ended with nobody there — the queue's empty-room rule. Both wait for the next turn
  a person starts.
- **The notice is a `context` row, `source = background_task`, and never a user row.** The
  automatic reviewer weighs the two differently, and a notice filed as the user would be a
  model-written string (and the command's own output) carrying the user's authority.
- **The claim is one SeaORM write.** `mark_notified`'s affected-row count, the head read and
  the row (`sea::ops::message::append_context`) share one `BEGIN IMMEDIATE`, so a wake and a
  round boundary reaching the same task produce one notice. The context row goes through
  `append_context` rather than `append_message`: the latter also files a user row's audit
  copy, which a notice is not.
- **Only the desktop's own turns get a `Launcher`** (`ToolContext::background`). A
  sub-agent, a QQ session, the reviewers and the tool bridge get `None`, which is how the
  tool refuses there: a task that outlives its turn needs a conversation somebody returns
  to. Deleting a conversation stops its tasks and removes their logs; quitting stops all of
  them, bounded.
- **The window reads, it is not pushed.** `background-tasks-updated` is an invalidation key
  like `queue-updated`. The running tasks are a chip in the composer's status tab, beside
  the checklist's, with the list one press away; the output sheet polls the one task being
  looked at. The chip's icon is still, not a spinner — the checklist's ring beside it
  already moves — and elapsed time is in units (`12 分钟`), never `12:00`, which reads
  as a time of day.
- **Other conversations are marked in the sidebar, not on a session.** The conversations a
  running command matters for are mostly ones nobody has opened since, so the counts come
  from `background_task_running_counts` into `backgroundRunning` beside `sessions`, re-read
  on mount, on `background-tasks-updated` and on `remote-resync`. `ConversationIndicator`
  draws them as a hollow ring, below a running turn and above "answered, unseen".
- **A turn nobody asked for ends with an OS notification, not an in-app one.** The
  notification viewport holds questions only, so an unprompted turn's stop goes through
  `trySendNotification` under the same `shouldNotify` as a long answer, worded by its
  trigger (a task completed, or Claude Code carried on by itself).

Not built: the sandbox-escalation card for a background command a restricted token refused
(it fails, and the model can rerun it in the foreground), the journal's command bracket
(its "after" is hours away), a background command in container mode, and a hosted
session's own background tasks (the adapter's `asyncTasks`), which the `runner` column is
there for.
