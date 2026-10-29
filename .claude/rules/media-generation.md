---
paths:
  - "src-tauri/crates/core/src/agent/tool_media.rs"
  - "src-tauri/crates/core/src/tools/mod.rs"
  - "src-tauri/crates/core/src/mcp/mod.rs"
  - "src-tauri/crates/core/src/files.rs"
  - "src-tauri/crates/core/src/provider/mod.rs"
  - "src/components/chat/media-result.tsx"
  - "src/components/chat/media-preview-sheet.tsx"
---

# Media in tool results (phase 0 of image/video generation)

The plan these phases follow is `~/.claude/plans/humble-hatching-rain.md`.
Phase 0 is in: a tool's answer can carry pictures and other files beside its
text. Generation (phases 1 and 2) builds on exactly this.

- **A tool answers with `ToolOutput { text, media }`, and only the turn loop
  sees it.** `Tool::execute_rich` defaults to `execute`, so the thirty-odd tools
  that only print text are untouched; MCP's `call_tool_rich` decodes `image` /
  `audio` / `resource.blob` blocks into `MediaOut::Bytes` and describes what it
  cannot use (an unknown type, bad base64, a ninth item) in the text rather than
  dropping it. `call_tool` keeps its text-only shape for callers that want that.
  `SurfaceTools` (QQ) has no rich variant yet: none of them returns media.

- **The row stores `file://` references, never base64, and is marked
  `schema_version = 3`.** `tool_media::store` writes `MediaOut::Bytes` under
  `files/<conversation_id>/` and refuses a `ManagedFile` outside that
  directory, an unlisted mime type (`files::media_extension` is the list), a
  picture over 20 MB, anything else over 200 MB, more than eight items, or a
  surface with no attachment directory — refusing turns the *whole* result into
  an error, because a model told about a picture it was not shown describes it
  anyway. A result with no media is stored as the text it always was, version
  2, byte for byte. Only the loop writes version 3, so a tool printing
  something that looks like the envelope is still text; that discriminator is
  not something content can forge. On the wire the same row becomes
  `MessageOrigin::ToolParts`.

- **Pictures are inlined from the conversation's own directory, and an
  unreadable user attachment fails the turn.** `resolve_file_uris_in_messages`
  projects user attachments against `WireMediaPolicy` (the model's
  `readable_mime_types` intersected with this door's part shapes). A `file://`
  that cannot be opened is an error, not a leftover URI. Oversize files and
  MIME types this door cannot send become `[attachment: {path} ({len} bytes)]`.
  A `ToolParts` row is still only from `files/<conversation_id>/`
  (`files::resolve_conversation_attachment`). A tool picture that cannot be
  read is `[attachment unavailable]`; a model whose readable set has no images
  gets `[image omitted: …]`. Each replacement is a function of the file and
  the policy only, so a replay renders the bytes the first send did (CLAUDE.md,
  "What was sent is never dropped or rewritten");
  `a_tool_picture_replays_as_the_bytes_it_was_first_sent_as` pins it.

- **Each dialect carries the pictures where its wire allows.** Anthropic: image
  blocks inside `tool_result.content`. Responses and Codex: the
  `function_call_output.output` content list (`input_text` / `input_image`).
  Interactions: the `function_result.result` content list. Gemini
  generateContent: `functionResponse.response.output` is the text, and a
  caption plus `inlineData` parts follow the batch's responses in the same user
  turn. The chat-completions family (`openai_compat`, its Google flavour,
  `deepseek`, `gemma_tool`): `role: "tool"` is text only, so
  `ToolImageCarry` holds the pictures and emits one user message after the
  *last* tool message of the run — one between two results of a batch breaks
  the ordering rule. LiteRT-LM takes text only: a picture is a line saying
  it was omitted (its capabilities say no images, so resolution has already
  replaced it; the adapter does not rely on that). **Unverified against live endpoints**: the Interactions
  and Gemini shapes, and Codex accepting `input_image` in an output list, are
  from the documented schemas; a judgement request against each is still owed.

- **Every reader that is not a provider sees text and a count.**
  `tool_media::result_text` (`"captured [+1 media]"`) for the excerpt, the
  automatic reviewer's projection, compaction input and the SFT export;
  `message_text` for in-request messages. tool-result pruning turns an old
  `ToolParts` message into that text once the history passes half the window —
  the most expensive thing to keep resending, and an envelope cut by characters
  is a request the provider refuses. Redaction scans a `ToolParts` envelope part by part, like a
  user's attachments, so its base64 is not read as text.

- **The window is shown typed media, never the envelope.**
  `ChatStreamEvent::ToolResult` carries `result` (the text) and `media:
  ToolMediaResponse[]`; `MessageInfoResponse` carries `tool_media` and, on a
  tool row, `content` is only the text (CLAUDE.md, "JSON storage is not a
  public string contract" — the plan's parse-the-envelope-in-the-frontend was
  dropped for this). `export_media_file` copies one file out, held to the same
  directory, and is `local`: over remote access the file is on the other
  machine.

- **Known gaps.** Remote `/assets` still reads whole files under the 20 MB cap,
  so a large video does not play remotely (phase 2). `<video>` on WebView2 and
  Android WebView is not verified on hardware. The tokenizer counts an inlined
  picture's base64 as text, overestimating it.

- **Found on the way and fixed with it**: a tool or assistant row whose text
  began with `[{` (a JSON array) went through the user-attachment decoder in
  `openai_compat::content_value` and the Anthropic adapter, failed the strict
  decode and took every later request of the conversation down; and redaction
  read such a tool row as an envelope and scanned only its `"type":"text"`
  members — for ordinary JSON, nothing. Both now decide on the role.
