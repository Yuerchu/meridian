---
paths:
  - "src-tauri/src/command_table.rs"
  - "src-tauri/src/commands/**"
  - "src-tauri/src/platform.rs"
  - "src-tauri/src/fonts.rs"
  - "src-tauri/src/splash.rs"
  - "src-tauri/src/remote/**"
  - "src/api.ts"
  - "src/types.ts"
  - "src/lib/transport.ts"
---

# IPC Contract Standards

Every command registered in `src-tauri/src/command_table.rs` is part of one
closed, first-party protocol shared by the local Tauri WebView and the remote
HTTP/WebSocket client.

## 1. Command Naming (`<approved_verb>_<noun>`)

Command names are valid Rust `snake_case` identifiers following a closed
PowerShell-style **Verb-Noun** grammar:

- Always `<verb>_<resource>` — never `<resource>_<verb>`, never a bare verb,
  never filter-split suffixes like `*_by_project`, `list_all_*`, or
  `*_trash` when a typed filter request belongs on `list_<plural>`.
- Resource vocabulary is canonical across the whole table (`emoji`, never
  `sticker`; `remote`, never `listen`).

### Approved Verbs

- **Read / Query**: `list`, `get`, `read`, `search`, `fetch`, `test`, `resolve`
- **Lifecycle / Data**: `create`, `set`, `update`, `delete`, `restore`, `reset`
- **Process / Session / Action**: `start`, `stop`, `cancel`, `open`, `close`,
  `connect`, `disconnect`, `send`, `submit`, `invoke`
- **Transfer / System**: `import`, `export`, `upload`, `select`, `stage`,
  `attach`, `switch`, `register`, `take`, `complete`

`scripts/check-model-contracts.mjs` rejects any command whose prefix is not in
this closed list.

## 2. Single `request` Parameter & Rust-First `snake_case`

- Every command in `command_table.rs` takes **either** zero business parameters
  `()` **or** exactly one parameter named `request: <Name>Request`.
  Loose scalar parameters (`id: String`, `archived: bool`, `conversation_id: String`)
  are forbidden.
- Wire JSON follows Rust's `snake_case` standard end-to-end:
  - Shell `*Request` and `*Response` structs MUST NOT use
    `#[serde(rename_all = "camelCase")]`.
  - Enum variants use `#[serde(rename_all = "snake_case")]` (unless explicitly
    pinned to a closed literal such as `SecretKey::RemoteToken = "REMOTE_TOKEN"`).
  - `src/types.ts` mirrors the exact Rust `snake_case` field names.
- All `*Request` structs carry `#[serde(deny_unknown_fields)]`.
  - Nullable fields on create/read/set requests use `RequiredNullable<T>` (or
    `deserialize_required_nullable`): the key is required and `null` is explicit.
  - Clearable fields on partial `update_*` requests use `double_option` /
    `patch_nullable` (omitted = unchanged, `null` = clear, value = set).

## 3. Return Value Conventions

- **Every** `#[tauri::command]` returns `Result<T, String>`.
- Unpaginated collection commands return `pub type EntityListResponse = Vec<EntityInfoResponse>`
  (or `Vec<String>`), never a single-field wrapper object.
- Paginated or metadata-carrying list commands return `*PageResponse` /
  `*ListResponse` structs with explicit metadata (`items`, `total`, `next_cursor`, etc.).
- `create_*` and `update_*` return the resulting `*InfoResponse` when an entity
  snapshot exists; `set_*_config` returns the persisted `*ConfigInfoResponse`.
- Single-item `delete_*` returns `()`; batch deletes/restores return `usize` or
  a dedicated `*DeleteResponse` report.

## 4. Frontend API Surface (`src/api.ts`)

`src/api.ts` exposes commands grouped by resource namespace
(`api.conversations.list(...)`, `api.projects.create(...)`, `api.workspace.readFile(...)`,
etc.), keeping `invoke<T>(cmd, { request })` as the sole typed entry point for
`scripts/generate-invoke-response-schema.mjs`.

## 5. Wire Protocol Revision

Breaking command renames, parameter shape changes, or field casing changes bump
`API_REV`, `MIN_CLIENT_REV` (`src-tauri/src/remote/http.rs`), and
`CLIENT_API_REV` (`src/lib/transport.ts`) together in the same change. Never add
legacy command aliases or dual-casing fallbacks.
