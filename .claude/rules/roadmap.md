---
paths:
  - "src-tauri/crates/core/src/acp/**"
  - "src-tauri/crates/core/src/hooks/**"
  - "src-tauri/src/remote/**"
---

# Roadmap

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
