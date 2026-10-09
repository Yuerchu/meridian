---
paths:
  - "src/components/board/**"
  - "src/stores/board-store.ts"
  - "src-tauri/src/commands/board.rs"
  - "src-tauri/crates/core/src/worktree.rs"
  - "src-tauri/crates/core/src/db/sea/ops/board_task.rs"
  - "src-tauri/crates/core/src/db/entity/board_task.rs"
---

# The agent board

The roadmap's control plane made concrete (`roadmap.md`): people run many
agents at once, and the scarce thing is knowing which one needs them. One card
is one task is one conversation is one git worktree. Decided over an
interactive prototype with the owner (2026-10-08/09); each rule below has a
reason that is not visible in the code.

## Columns are a person's; state is a mark

`board_tasks.stage` (backlog / running / review / done) is set only by a
person — moving a card — and by starting one, which moves it to running.
Nothing derives a column from what the agent is doing, and a card that starts
asking does **not** change places: the strip at the top is what is sorted
(oldest question first), and PageDown / PageUp walk it (bound only while
something waits; inside a text field they are the field's). Within a column,
cards keep their order. The one move without a drag is still a person's:
telling a card under review to keep working sends it back to running.

What a card says about its agent (`components/board/agent-state.ts`) is
derived, never stored, from the same places the transcript reads: the
attention queue for what waits on a person (it outranks everything — a turn
that asked is still "running" by its status), the session for what is
running, and the turns' durable status for how the last one ended. The model
wanting something from the person is always a question (`ask_user`, an
elicitation, a plan review); a turn that ends normally is "finished".

## Everything answered in place

A card opens where it stands, several at once, and nothing on the board makes
anything inert. An open card renders the **real** `ToolCallBlock` / ask form
from the session's messages (inside `TranscriptConversationProvider`, so panel
state lands on that conversation), not a summary of it.

A collapsed card answers with the **notification stack's rule, not a looser
one**: `attentionShape` decides whether Allow / Deny may be offered (a
read-only call drawn whole); everything else shows why not and offers to open
the card. The prototype allowed commands and short diffs on the card; the
owner rejected that. "Later" has no place on a board; "view" opens the card.

The board is the third exit of the attention queue (`frontend.md`): while it
is the page, its conversations' questions are `here` (`pending(…, onBoard)`),
so neither the floating stack nor the inbox lists them a second time; the
inbox says how many are on the board.

## The composer on every card

A started card's box follows the chat composer's rules: while a turn runs,
what is typed is a queued **follow-up** (an interjection is chosen on the
queued row, never by accident — the prototype's "interject" was dropped for
this); otherwise it starts the next turn (`useSendMessage`). A failed or
stopped turn holds its queue, and sending a new turn does not release it —
what was queued behind a failure is the transcript's to decide. A card that
has not started shows the agent choice (native / Claude Code, remembered per
machine) and its first message starts it.

## Worktrees

`<repo>.worktrees/<card id prefix>`, beside the repository so it never shows
in the repository's status, search or editor tree. Added **detached** at the
current HEAD, which is only a place to stand: the branch's name *and* its base
are the agent's to choose (a dev/test/main project defaults to main and works
from dev). The first message carries a note saying so. The card reads the
branch from git; a detached worktree shows "no branch yet".

- **Start** makes the worktree, then the conversation. A native card's
  conversation and its claim are one write (`claim_native`), so no
  conversation exists that should work in a worktree and does not; a hosted
  card's failure closes the session, deletes the conversation, removes the
  worktree.
- **The resolver** (`workspace::configured_dir_in`) answers a native card's
  conversation with its worktree; once the worktree is removed it is an
  error, never the project's path — every turn, queued prompt, `!` command and
  panel refuses instead of drifting into the main checkout.
- **Removal** is manual and refuses uncommitted changes and commits no branch
  holds (`worktree::remove`); it takes the conversation's lease and closes a
  hosted adapter first (Windows will not delete a process's cwd). The card
  moves to done.
- **Deleting** a started card deletes its conversation too, and only once the
  worktree is gone; deleting a card's conversation alone, or a project whose
  cards still have worktrees, is refused. Each would leave a conversation the
  resolver sends to the main checkout.

## Sandbox: no `.git` write access

A worktree session's writable roots are the worktree and TEMP only. Git
writing the repository's shared directory (a branch, a commit) is refused and
goes through the ordinary retry-outside approval. Granting `<repo>/.git`
would hand the agent `config` and `hooks/`, which run as the person the next
time they use git in the main checkout — a sandbox escape. Granting only
`objects/ refs/ logs/ worktrees/<name>/` was also declined: branching and
committing are rare enough to approve.

## Known gaps

- The transcript's approve / deny chords (`mod+shift+y/n`) target the active
  transcript; the open approval block on a card still prints their hints, and
  they do nothing on the board.
- A collapsed card's withheld reason reads "look at it in the conversation"
  (the stack's wording); on the board, opening the card is the way.
- No drag between columns, no double-click to draft, no file-conflict marks
  yet: the next phase.
- The full start → work → remove flow (a real worktree, a native turn and a
  hosted adapter in it) has no automated test; the shell has no test
  `Services` that avoids the OS keyring.
