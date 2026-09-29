---
paths:
  - "src-tauri/src/remote/**"
  - "src-tauri/src/command_table.rs"
  - "src/lib/transport.ts"
  - "src-tauri/crates/core/src/listen_guard.rs"
  - "src/components/settings/remote-*.tsx"
---

# Remote access

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

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
