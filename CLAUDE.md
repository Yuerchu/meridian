# Meridian

Multi-provider AI desktop client with coding agent capabilities.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Tauri v2 (Rust backend + WebView frontend) |
| Frontend | React 19 + TypeScript + Vite |
| UI | Tailwind CSS v4 (shadcn/ui planned) |
| Backend | Rust (tokio async runtime) |
| AI Streaming | reqwest + eventsource-stream (SSE) |
| Database | SQLite (planned) |
| License | Proprietary (LicenseRef-Proprietary-Yuerchu) |

## Architecture

```
src/                  # React frontend
src-tauri/
  src/
    lib.rs            # Tauri app entry, IPC commands
    provider/         # AI provider implementations
      openai_compat.rs  # OpenAI-compatible SSE streaming
```

## Key Design Decisions

- **Pure Rust backend**: No Python sidecar, no Codex submodule. Selectively port useful patterns from Codex (Apache 2.0) into our own code.
- **Local-first + optional cloud**: Default standalone desktop app. Optional connection to foxline-pro backend for billing, collaboration, multimedia generation.
- **Streaming via Tauri events**: Rust backend streams AI responses via `app.emit("chat-stream", ...)`, frontend listens with `listen()`.
- **Multi-provider**: OpenAI-compatible base, extend to Anthropic/Google/Ollama etc.
- **Messages are a tree, read as one path.** Each row has a `parent_id`; each conversation has a `head_message_id` naming the leaf its active path ends at. Regenerating or editing writes a sibling and leaves the original reachable. Read a conversation with `db::ops::message::active_context` — `sort_order` is insertion order, not transcript position, once branches interleave. Write only through `append_message`, which links the row and moves the head in one transaction. Delete only whole subtrees: dropping a lone row strands its tool results or leaves an answer to nothing. `parent_id` carries no foreign key on purpose (see migration 21).
- **Branches switch the transcript, not the world.** The todo list, approved plan and collaboration mode stay per-conversation and do not follow a branch switch. Files edited and commands run cannot be rewound either, so making these alone branch-aware would imply more than actually happens.

## UI Conventions (v0–v1.x)

Follow shadcn/ui conventions (reference: local clone at `~/Documents/Code/shadcn-ui`, `apps/v4/registry/new-york-v4/ui/` for inline-Tailwind style, `bases/base/ui/` for base-ui structure). Meridian v2 plans to migrate to HeroUI v3 — design new component APIs in HeroUI's shape (compound components, prop names like `isStreaming`/`state`) so only the implementation layer changes later.

- **Colors: theme tokens only.** No raw Tailwind palette classes (`green-500`, `amber-500`, ...) in components. Status colors use the project-extension tokens `--success` / `--warning` / `--info` (light = 500 shade, dark = 400 shade, defined in `src/index.css`). Whitelisted exceptions: "default" star markers (`text-amber-500`, gold-star semantics) and `text-white` on `bg-destructive` (official shadcn convention).
- **Font sizes: Tailwind scale only** (`text-xs/sm/base/lg`). No px arbitrary sizes (`text-[11px]`). Sole exception: `button.tsx` `text-[0.8rem]` (rem-based, official lineage).
- **Radius hierarchy:** composer input `rounded-2xl` → chat/tool cards `rounded-xl` → settings cards & overlays (dialogs, menus) `rounded-lg`.
- **Component style:** `data-slot` on every DOM node, `cn()` with `className` last, cva for variants, base-ui `render`/`useRender` instead of `asChild`, base-ui data attributes (`data-open`, `data-starting-style`).
- **Dev playground:** browser-only preview of chat/tool components at `http://localhost:5173/#playground` (vite dev without Tauri; tree-shaken from release builds). Add new component states there.

## Android

- **File access model**: tools resolve paths through `ToolContext::resolve_and_validate` (`src-tauri/src/tools/mod.rs`). Desktop = `FileAccess::Unrestricted` (legacy working_directory check). Android = `FileAccess::Roots` whitelist built in `build_file_access` (lib.rs) from preferences `android.manage_storage_enabled` / `android.saf_roots` + the system grant. SAF I/O goes through `src/android_bridge.rs` (JNI) → `FileBridge.kt`.
- **run_command is compiled out on Android** (`#[cfg(not(target_os = "android"))]` in tools/mod.rs).
- **Hand-maintained files inside `src-tauri/gen/android/`** (tracked in git; if `tauri android init` is ever re-run, merge these back manually): `app/src/main/AndroidManifest.xml` (storage permissions), `app/src/main/java/cn/yuxiaoqiu/meridian/MainActivity.kt` (SAF picker + `nativeOnSafResult`), `FileBridge.kt` (ContentResolver ops), `app/build.gradle.kts` (androidx.documentfile dependency).
- **Build**: `pnpm tauri android build --target aarch64`. Rust-only check: `cargo check --target aarch64-linux-android` with NDK clang env vars.

## Reference Projects

- **Codex CLI** (`codex-rs/`): Apache 2.0. Port provider abstraction, SSE parsing, MCP patterns. Don't depend on it directly.
- **foxline-pro-backend-server**: Our Python SaaS backend. Borrow provider design (STI polymorphism), streaming architecture (Kafka+Redis), tool system patterns. Rewrite in Rust.
- **Cherry Studio**: AGPL, do NOT use any code. Reference for feature scope only.

## Development

```bash
pnpm install
pnpm tauri dev        # Start dev (needs MERIDIAN_API_KEY env var)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MERIDIAN_API_BASE` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `MERIDIAN_API_KEY` | (required) | API key |
| `MERIDIAN_MODEL` | `gpt-4.1-mini` | Model identifier |
