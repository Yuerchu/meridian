---
paths:
  - "src-tauri/crates/core/migrations/**"
  - "src/dev/schema-*.ts*"
  - "scripts/check-db-schema.mjs"
---

# The schema canvas

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

## The schema canvas

`#playground/schema` (`pnpm schema`) draws the database with React Flow: every table
full-height with all its columns, edges anchored to the *column* rather than the table,
and a panel with the whole of what a table means. `src/dev/schema-lab.tsx` only draws —
whether an edge is a foreign key, whether a column is worth emphasis, all of it comes
from `src/dev/schema-data.ts`, which is the single source both halves of this feed on.

- **Half of that data is prose and only a person can write it.** Which table has which
  column is recoverable from the migration; *why `parent_id` carries no foreign key*, why
  `NULL` and `0` are different answers on the cache columns, why the price is copied onto
  the audit row — none of it is. A new column is worth a line saying what it decides;
  a new table is worth `note` / `rels` / `rules`.
- **The other half is checked by a machine, against a real SQLite.**
  `scripts/check-db-schema.mjs` runs every `migrations/*/up.sql` into an in-memory
  `node:sqlite` — under `PRAGMA foreign_keys=OFF`, which is how `db/mod.rs:78` runs them —
  and reads the result back through `PRAGMA table_info` / `foreign_key_list`. Structure
  that drifts is worse than no diagram: it is wrong in a way that reads as authoritative.

  It used to parse the SQL itself, and that version was wrong about the one thing worth
  being right about. `ALTER TABLE … RENAME TO` does not just rename: since SQLite 3.25 it
  **rewrites the `REFERENCES` clauses of other tables that point at it** — under both
  `foreign_keys` settings, measured on 3.50.4. Migration 24 is exactly that shape, and a
  checker that models a rename as a rename goes quiet precisely where it is needed.

  What that turned up was a real defect: migration 24 rewrote
  `tool_permissions.mcp_server_id` to point at `mcp_servers_old`, then dropped that table.
  Migration 48 removes `tool_permissions` because no runtime code ever read or wrote it,
  and removes the exception machinery with it. The checker now treats every dangling
  foreign key as an error; there is no waiver list that can make one look healthy.
- **`--staged` is what `pre-commit` runs**, and the distinction is the point: a working-tree
  check passes when the migration is staged and the matching edit to `schema-data.ts` is
  not, and then the commit contains a version where the structure moved and the diagram
  did not.
- **Needs Node >= 22.18** (`engines`, and the script says so itself before failing):
  it imports the `.ts` directly and relies on built-in type stripping, so nothing in
  `schema-data.ts` may be non-erasable syntax — no `enum`, no `namespace`. `node:sqlite`
  still needs a flag on Node 22, which the script re-executes itself to add, so callers
  only ever say `node scripts/check-db-schema.mjs`.
- **The layout is derived, not written down.** Nodes are as tall as their column count, so
  a hand-placed `y` would need rewriting every time a column lands. `schema-data.ts`
  declares only which canvas column a table sits in and in what order; the rest falls out
  of the row counts, and a table missing from that list throws rather than silently
  stacking at the origin.
- React Flow is a real dependency, not a dev-only one — the canvas is where it earned its
  place, but nothing about it is playground-specific.
