---
paths:
  - "src-tauri/crates/core/src/container.rs"
  - "src-tauri/crates/core/src/sandbox.rs"
  - "src-tauri/crates/core/src/acp/mounts.rs"
  - "src-tauri/crates/core/src/acp/process.rs"
  - "src-tauri/crates/core/tests/docker_probe.rs"
  - "src-tauri/crates/sandbox-*/**"
---

# Running commands in a container

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
