/**
 * How each tool this app knows by name is drawn, decided once per tool.
 *
 * **Adding a tool means adding it here.** `tool-renderers.test.ts` reads every
 * built-in tool name out of the Rust sources (`meridian-core`'s tool
 * definitions, the plan/skill/sub-agent constants and the QQ tool table) and
 * fails for any name missing from `TOOL_RENDERERS`; `HOSTED_TOOL_NAMES` is
 * the list of Claude Code tools the same test holds to the same rule. A tool
 * with no entry would otherwise reach the generic path and be drawn as
 * whatever its arguments and result happened to look like — which is how a
 * transcript filled up with JSON.
 *
 * Tools whose names cannot be known in advance — MCP (`mcp__server__tool`,
 * including this app's own bridge as `mcp__meridian__…`) and the user's custom
 * tools — get `GENERIC_RENDERER`: arguments as typed fields and a result read
 * as structured data when it parses, text when it does not. Neither half ever
 * pastes JSON source; `components/ui/tool-value.tsx` is the one place a value
 * of unknown shape is turned into something to look at.
 */

/** How the arguments are drawn under the head row.
 *
 *  - `fields` — each argument a labelled row (`ToolValue` for anything that is
 *    not a short string); the identifying one goes in the title.
 *  - `diff` — the file change the arguments describe (`toolFileDiffs`).
 *  - `command` — the command as highlighted shell.
 *  - `own-block` — the tool has a block of its own and draws everything. */
export type ToolArgsView = 'fields' | 'diff' | 'command' | 'own-block'

/** How a successful result is drawn. A one-line result of a non-reading tool
 *  is a sentence in the footer whatever this says.
 *
 *  - `read-file` / `search` / `glob` / `directory` / `command` — the parsers
 *    in `lib/tool-output.ts`, matched to the backend's exact templates.
 *  - `markdown` — prose the tool returned (a skill, a sub-agent's report).
 *  - `text` — lines the tool wrote for a person or a model, kept as written.
 *  - `structured` — a JSON document, drawn as fields and lists.
 *  - `own-block` — the tool's own block draws its outcome. */
export type ToolResultView =
  'read-file' | 'search' | 'glob' | 'directory' | 'command' | 'markdown' | 'text' | 'structured' | 'own-block'

export interface ToolRenderer {
  args: ToolArgsView
  result: ToolResultView
}

const r = (args: ToolArgsView, result: ToolResultView): ToolRenderer => ({ args, result })

/**
 * The Claude Code tools a hosted session can call, by the name the adapter
 * reports in `_meta.claudeCode.toolName`. The single list: the gate holds each
 * of these to having an entry below, as it does the Rust names.
 */
export const HOSTED_TOOL_NAMES = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  'SlashCommand',
  'Skill',
] as const

export const TOOL_RENDERERS: Readonly<Record<string, ToolRenderer>> = {
  // ---- files ----
  read_file: r('fields', 'read-file'),
  list_directory: r('fields', 'directory'),
  glob: r('fields', 'glob'),
  search_files: r('fields', 'search'),
  write_file: r('diff', 'text'),
  edit_file: r('diff', 'text'),
  apply_patch: r('diff', 'text'),
  delete_file: r('fields', 'text'),
  move_file: r('fields', 'text'),
  // ---- shell ----
  run_command: r('command', 'command'),
  // ---- memory, redaction, diagnostics: sentences and line lists ----
  save_memory: r('fields', 'text'),
  recall_memory: r('fields', 'text'),
  list_memories: r('fields', 'text'),
  delete_memory: r('fields', 'text'),
  add_redaction_rule: r('fields', 'text'),
  list_redaction_rules: r('fields', 'text'),
  remove_redaction_rule: r('fields', 'text'),
  read_app_logs: r('fields', 'text'),
  conversation_usage: r('fields', 'text'),
  read_conversation: r('fields', 'text'),
  // ---- plans ----
  enter_plan: r('own-block', 'own-block'),
  exit_plan: r('own-block', 'own-block'),
  // `{content, generation, sha256, file_sync_state}` — the plan is Markdown.
  read_plan: r('fields', 'structured'),
  // The patch is an `apply_patch` envelope against `plan.md`.
  update_plan: r('diff', 'structured'),
  // ---- agents, questions, checklists, search ----
  run_agent: r('own-block', 'own-block'),
  ask_user: r('own-block', 'own-block'),
  update_todos: r('own-block', 'own-block'),
  web_search: r('own-block', 'own-block'),
  load_skill: r('fields', 'markdown'),
  // ---- stickers and voice: JSON answers ----
  list_stickers: r('fields', 'structured'),
  send_sticker: r('fields', 'structured'),
  send_voice: r('fields', 'structured'),
  // ---- QQ: fixed Chinese sentences and line lists ----
  qq_get_chat_history: r('fields', 'text'),
  qq_get_group_info: r('fields', 'text'),
  qq_get_group_member_list: r('fields', 'text'),
  qq_get_group_member_info: r('fields', 'text'),
  qq_get_user_info: r('fields', 'text'),
  qq_get_friend_list: r('fields', 'text'),
  qq_get_group_list: r('fields', 'text'),
  qq_delete_msg: r('fields', 'text'),
  qq_send_poke: r('fields', 'text'),
  qq_send_like: r('fields', 'text'),
  qq_set_essence_msg: r('fields', 'text'),
  qq_set_group_ban: r('fields', 'text'),
  qq_set_group_kick: r('fields', 'text'),
  qq_set_group_card: r('fields', 'text'),
  qq_set_group_name: r('fields', 'text'),
  qq_send_group_notice: r('fields', 'text'),
  // ---- hosted Claude Code ----
  Bash: r('command', 'command'),
  BashOutput: r('fields', 'text'),
  KillShell: r('fields', 'text'),
  SlashCommand: r('command', 'text'),
  Read: r('fields', 'read-file'),
  Write: r('diff', 'text'),
  Edit: r('diff', 'text'),
  MultiEdit: r('diff', 'text'),
  NotebookEdit: r('fields', 'text'),
  Glob: r('fields', 'glob'),
  Grep: r('fields', 'text'),
  LS: r('fields', 'text'),
  WebFetch: r('fields', 'markdown'),
  WebSearch: r('fields', 'markdown'),
  Task: r('fields', 'markdown'),
  TodoWrite: r('own-block', 'own-block'),
  EnterPlanMode: r('fields', 'text'),
  ExitPlanMode: r('own-block', 'own-block'),
  AskUserQuestion: r('own-block', 'own-block'),
  Skill: r('fields', 'markdown'),
}

/** MCP, custom tools, and anything else whose shape is only known at runtime. */
export const GENERIC_RENDERER: ToolRenderer = r('fields', 'structured')

export function rendererFor(toolName: string): ToolRenderer {
  return TOOL_RENDERERS[toolName] ?? GENERIC_RENDERER
}
