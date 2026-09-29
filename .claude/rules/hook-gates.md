---
paths:
  - "src-tauri/crates/core/src/hooks/**"
  - "src/components/settings/hooks-settings.tsx"
---

# Hook gates

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
