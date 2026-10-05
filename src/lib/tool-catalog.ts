/**
 * Every tool this app knows by name, and every decision the front end makes
 * about one — declared once, here.
 *
 * **Adding a tool means adding it here.** The native half is held to
 * `src-tauri/crates/core/tool-catalog.json`, which `meridian-core` generates
 * from each tool's own `spec()`: `tool-catalog.test.ts` fails for a native
 * tool with no entry, an entry for a tool core no longer has, an argument key
 * the tool's schema does not define, a label missing from either locale, and
 * a tool drawn as read-only here that core does not classify as a read. The
 * hosted half (Claude Code's tools, by the name `claude-agent-acp` reports in
 * `_meta.claudeCode.toolName`) has no generated source; its argument keys are
 * copied from the Agent SDK's `sdk-tools.d.ts` and the probe recordings, and
 * the test holds every key used below to that list.
 *
 * **Near tools are twins, and a difference between twins is declared.** A
 * hosted `Read` and a native `read_file` do the same thing under different
 * argument names; `twin` puts them in one group, and the test requires every
 * member of a group to agree on how it folds, whether it reads, whether it
 * may be decided from a notification, whether it blocks the turn, and so on —
 * or to say in `differs` why not. That is where "the hosted one never got the
 * fix" stops being something nobody notices.
 *
 * Kept free of aliases and JSX so node can run it on its own.
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
 *  - `structured` — a JSON document, drawn as fields and lists; text when it
 *    does not parse. The choice for a tool whose output nobody has recorded.
 *  - `own-block` — the tool's own block draws its outcome. */
export type ToolResultView =
  'read-file' | 'search' | 'glob' | 'directory' | 'command' | 'markdown' | 'text' | 'structured' | 'own-block'

/** What the identifying argument is, which decides how it is drawn: a path
 *  keeps its file name, a command keeps its first line. */
export type IdentKind = 'path' | 'command' | 'text'

/** The badge a finished call folds into. */
export type FoldKind = 'commands' | 'files' | 'searches'

/** Which arguments describe a file change, and so which diff the card draws. */
export type DiffKind = 'write' | 'edit' | 'multi-edit' | 'patch'

/** The tools with a block of their own, beyond the generic card. */
export type BlockKind = 'ask' | 'web-search' | 'enter-plan' | 'exit-plan' | 'delegate' | 'todos' | 'hosted-todos'

/** What a finished call did to the files under the project, for the changes
 *  panel. `modify` and `delete` name the argument holding the path. */
export type TouchKind = { op: 'modify'; key: string } | { op: 'delete'; key: string } | { op: 'move' } | { op: 'patch' }

/** The properties twins are compared on. */
export type TwinProperty =
  'ident' | 'fold' | 'reading' | 'readOnly' | 'interactive' | 'ask' | 'diff' | 'touches' | 'block'

export interface ToolUi {
  side: 'native' | 'hosted'
  /** The group of near tools this one belongs to; alone when absent. */
  twin?: string
  args: ToolArgsView
  result: ToolResultView
  /** Where the identifying argument is read from: the first of `keys` that
   *  holds a non-empty string. `patch` is derived from an `apply_patch`
   *  envelope's file header. Absent: the tool has none worth a title. */
  ident?: { kind: IdentKind; keys: readonly string[] } | 'patch'
  /** A completed call folds into this badge. */
  fold?: FoldKind
  /** The result is what the tool read, kept in the body however short. */
  reading?: true
  /** The tool only reads, so Allow/Deny may be offered outside its card. The
   *  keys only narrow what is read and are drawn under the identifying one;
   *  any other argument the call carries withdraws the offer. */
  readOnly?: readonly string[]
  /** A running call is waiting on a person, not working. */
  interactive?: true
  /** It asks the user questions: a form, not an approval. */
  ask?: true
  diff?: DiffKind
  touches?: TouchKind
  block?: BlockKind
  /** A hosted tool: its input keys, as `sdk-tools.d.ts` or a probe recording
   *  states them. Native keys come from the catalog instead. */
  params?: readonly string[]
  /** A hosted tool the pinned adapter no longer offers, kept so that a session
   *  imported from an older one still draws its calls. */
  legacy?: true
  /** Why this twin differs from the others in its group, per property. */
  differs?: Partial<Record<TwinProperty, string>>
}

/** The prefix this app's own tool bridge gives the tools it lends a hosted
 *  agent (`acp/bridge.rs`); the test holds it to the catalog. */
export const BRIDGE_PREFIX = 'mcp__meridian__'

const path = (...keys: string[]) => ({ kind: 'path' as const, keys })
const command = { kind: 'command' as const, keys: ['command'] }
const text = (...keys: string[]) => ({ kind: 'text' as const, keys })

/** Same output either way: the tool names its own text, nothing else. */
const plain = (side: ToolUi['side'], extra: Partial<ToolUi> = {}): ToolUi => ({
  side,
  args: 'fields',
  result: 'text',
  ...extra,
})

/** A hosted tool whose output no recording has shown; drawn as the generic
 *  view draws anything, which is what it got before it was listed. */
const unrecorded = (params: readonly string[], extra: Partial<ToolUi> = {}): ToolUi => ({
  side: 'hosted',
  args: 'fields',
  result: 'structured',
  params,
  ...extra,
})

const LEGACY = 'the pinned adapter no longer offers it; kept only to draw imported sessions'

export const TOOLS: Readonly<Record<string, ToolUi>> = {
  // ---- reading ----
  read_file: {
    side: 'native',
    twin: 'read',
    args: 'fields',
    result: 'read-file',
    ident: path('path'),
    fold: 'files',
    reading: true,
    readOnly: [],
  },
  Read: {
    side: 'hosted',
    twin: 'read',
    args: 'fields',
    result: 'read-file',
    ident: path('file_path'),
    fold: 'files',
    reading: true,
    readOnly: ['offset', 'limit', 'pages'],
    params: ['file_path', 'offset', 'limit', 'pages'],
  },
  list_directory: {
    side: 'native',
    twin: 'list',
    args: 'fields',
    result: 'directory',
    ident: path('path'),
    fold: 'searches',
    reading: true,
    readOnly: [],
  },
  LS: {
    side: 'hosted',
    twin: 'list',
    args: 'fields',
    result: 'text',
    ident: path('path'),
    // From the SDK that still offered it; the current `sdk-tools.d.ts` has no `LS`.
    params: ['path', 'ignore'],
    legacy: true,
    differs: {
      fold: LEGACY + '; no recording shows its result, so nothing folds it unseen',
      reading: LEGACY,
      readOnly: LEGACY + '; `ignore` was never reviewed as a narrowing argument',
    },
  },
  glob: {
    side: 'native',
    twin: 'glob',
    args: 'fields',
    result: 'glob',
    ident: text('pattern'),
    fold: 'searches',
    reading: true,
    readOnly: ['path'],
  },
  Glob: {
    side: 'hosted',
    twin: 'glob',
    args: 'fields',
    result: 'glob',
    ident: text('pattern'),
    fold: 'searches',
    reading: true,
    readOnly: ['path'],
    params: ['pattern', 'path'],
  },
  search_files: {
    side: 'native',
    twin: 'search',
    args: 'fields',
    result: 'search',
    ident: text('pattern'),
    fold: 'searches',
    reading: true,
    // `path` is required here and is what decides where the search reads.
    readOnly: ['path', 'max_results'],
  },
  Grep: {
    side: 'hosted',
    twin: 'search',
    args: 'fields',
    result: 'text',
    ident: text('pattern'),
    fold: 'searches',
    reading: true,
    readOnly: ['path', 'glob', 'type', 'output_mode', '-i', '-n', '-A', '-B', '-C', 'multiline', 'head_limit'],
    params: [
      'pattern',
      'path',
      'glob',
      'output_mode',
      '-B',
      '-A',
      '-C',
      'context',
      '-n',
      '-i',
      '-o',
      'type',
      'head_limit',
      'offset',
      'multiline',
    ],
  },

  // ---- writing ----
  write_file: {
    side: 'native',
    twin: 'write',
    args: 'diff',
    result: 'text',
    ident: path('path'),
    diff: 'write',
    touches: { op: 'modify', key: 'path' },
  },
  Write: {
    side: 'hosted',
    twin: 'write',
    args: 'diff',
    result: 'text',
    ident: path('file_path'),
    diff: 'write',
    touches: { op: 'modify', key: 'file_path' },
    params: ['file_path', 'content'],
  },
  edit_file: {
    side: 'native',
    twin: 'edit',
    args: 'diff',
    result: 'text',
    ident: path('file_path'),
    diff: 'edit',
    touches: { op: 'modify', key: 'file_path' },
  },
  Edit: {
    side: 'hosted',
    twin: 'edit',
    args: 'diff',
    result: 'text',
    ident: path('file_path'),
    diff: 'edit',
    touches: { op: 'modify', key: 'file_path' },
    params: ['file_path', 'old_string', 'new_string', 'replace_all'],
  },
  MultiEdit: {
    side: 'hosted',
    twin: 'edit',
    args: 'diff',
    result: 'text',
    ident: path('file_path'),
    diff: 'multi-edit',
    touches: { op: 'modify', key: 'file_path' },
    params: ['file_path', 'edits'],
    legacy: true,
  },
  NotebookEdit: {
    side: 'hosted',
    args: 'fields',
    result: 'text',
    ident: path('notebook_path'),
    touches: { op: 'modify', key: 'notebook_path' },
    params: ['notebook_path', 'cell_id', 'new_source', 'cell_type', 'edit_mode'],
  },
  apply_patch: {
    side: 'native',
    args: 'diff',
    result: 'text',
    ident: 'patch',
    diff: 'patch',
    touches: { op: 'patch' },
  },
  delete_file: plain('native', { touches: { op: 'delete', key: 'path' } }),
  move_file: plain('native', { touches: { op: 'move' } }),

  // ---- shell ----
  run_command: {
    side: 'native',
    twin: 'shell',
    args: 'command',
    result: 'command',
    ident: command,
    fold: 'commands',
  },
  Bash: {
    side: 'hosted',
    twin: 'shell',
    args: 'command',
    result: 'command',
    ident: command,
    fold: 'commands',
    params: ['command', 'timeout', 'description', 'run_in_background', 'dangerouslyDisableSandbox'],
  },
  // Not in `sdk-tools.d.ts`; the keys are the probe's. The model picks it over
  // `Bash` on Windows when it likes.
  PowerShell: {
    side: 'hosted',
    twin: 'shell',
    args: 'command',
    result: 'command',
    ident: command,
    fold: 'commands',
    params: ['command', 'description'],
  },
  SlashCommand: {
    side: 'hosted',
    args: 'command',
    result: 'text',
    ident: command,
    params: ['command'],
    legacy: true,
  },
  BashOutput: plain('hosted', { params: ['bash_id', 'filter'], legacy: true }),
  KillShell: plain('hosted', { params: ['shell_id'], legacy: true }),
  TaskOutput: unrecorded(['task_id', 'block', 'timeout']),
  TaskStop: unrecorded(['task_id', 'shell_id']),
  Monitor: unrecorded(['description', 'timeout_ms', 'persistent', 'command', 'ws']),

  // ---- the web ----
  web_search: {
    side: 'native',
    twin: 'web-search',
    args: 'own-block',
    result: 'own-block',
    block: 'web-search',
    differs: { ident: 'the block draws the query itself' },
  },
  WebSearch: {
    side: 'hosted',
    twin: 'web-search',
    args: 'fields',
    result: 'markdown',
    ident: text('query'),
    params: ['query', 'allowed_domains', 'blocked_domains'],
    differs: {
      block: 'its result is the tool’s own text ("Links: [...]"), which `WebSearchBlock` does not parse yet',
    },
  },
  WebFetch: {
    side: 'hosted',
    args: 'fields',
    result: 'markdown',
    ident: text('url'),
    params: ['url', 'prompt'],
  },
  ToolSearch: unrecorded(['query', 'max_results'], { result: 'text', ident: text('query') }),

  // ---- plans ----
  enter_plan: {
    side: 'native',
    twin: 'enter-plan',
    args: 'own-block',
    result: 'own-block',
    block: 'enter-plan',
    interactive: true,
  },
  EnterPlanMode: {
    side: 'hosted',
    twin: 'enter-plan',
    args: 'fields',
    result: 'text',
    params: [],
    differs: {
      block: 'it takes no reason to draw',
      interactive: 'the adapter switches modes in a PostToolUse hook; nothing shows it waiting on a person',
    },
  },
  exit_plan: {
    side: 'native',
    twin: 'exit-plan',
    args: 'own-block',
    result: 'own-block',
    block: 'exit-plan',
    interactive: true,
  },
  ExitPlanMode: {
    side: 'hosted',
    twin: 'exit-plan',
    args: 'own-block',
    result: 'own-block',
    block: 'exit-plan',
    interactive: true,
    // `plan` is not in `sdk-tools.d.ts`: the CLI adds the plan file's text to the
    // input it hands the permission check, which is where the block reads it.
    params: ['allowedPrompts', 'plan'],
  },
  // `{content, generation, sha256, file_sync_state}` — the plan is Markdown.
  read_plan: { side: 'native', args: 'fields', result: 'structured' },
  // The patch is an `apply_patch` envelope against `plan.md`, which is the
  // app's and not the project's: it is drawn as a diff and touches nothing.
  update_plan: { side: 'native', args: 'diff', result: 'structured', diff: 'patch' },

  // ---- questions, checklists, delegation, skills ----
  ask_user: {
    side: 'native',
    twin: 'ask',
    args: 'own-block',
    result: 'own-block',
    block: 'ask',
    ask: true,
    interactive: true,
  },
  AskUserQuestion: {
    side: 'hosted',
    twin: 'ask',
    args: 'own-block',
    result: 'own-block',
    block: 'ask',
    ask: true,
    interactive: true,
    params: ['questions', 'answers', 'annotations', 'metadata'],
  },
  update_todos: { side: 'native', twin: 'todos', args: 'own-block', result: 'own-block', block: 'todos' },
  TodoWrite: {
    side: 'hosted',
    twin: 'todos',
    args: 'own-block',
    result: 'own-block',
    block: 'hosted-todos',
    params: ['todos'],
  },
  run_agent: { side: 'native', twin: 'delegate', args: 'own-block', result: 'own-block', block: 'delegate' },
  Task: {
    side: 'hosted',
    twin: 'delegate',
    args: 'fields',
    result: 'markdown',
    params: ['description', 'prompt', 'subagent_type'],
    legacy: true,
    differs: { block: 'a hosted sub-agent’s own calls do not reach this app, so there is no group to draw' },
  },
  Agent: {
    side: 'hosted',
    twin: 'delegate',
    args: 'fields',
    result: 'markdown',
    params: [
      'description',
      'prompt',
      'subagent_type',
      'model',
      'run_in_background',
      'name',
      'team_name',
      'mode',
      'isolation',
    ],
    differs: { block: 'a hosted sub-agent’s own calls do not reach this app, so there is no group to draw' },
  },
  load_skill: { side: 'native', twin: 'skill', args: 'fields', result: 'markdown', ident: text('skill_name') },
  // Not in `sdk-tools.d.ts`.
  Skill: { side: 'hosted', twin: 'skill', args: 'fields', result: 'markdown', ident: text('skill'), params: ['skill'] },
  TaskCreate: unrecorded(['subject', 'description', 'activeForm', 'metadata']),
  TaskGet: unrecorded(['taskId']),
  TaskList: unrecorded([]),
  TaskUpdate: unrecorded([
    'taskId',
    'subject',
    'description',
    'activeForm',
    'status',
    'addBlocks',
    'addBlockedBy',
    'owner',
    'metadata',
  ]),
  Workflow: unrecorded(['script', 'name', 'description', 'title', 'args', 'scriptPath', 'resumeFromRunId']),
  ReportFindings: unrecorded(['level', 'findings']),
  // Not in `sdk-tools.d.ts`; nothing here reads its arguments.
  LSP: unrecorded([]),

  // ---- memory, redaction, diagnostics: sentences and line lists ----
  save_memory: plain('native'),
  recall_memory: plain('native'),
  list_memories: plain('native'),
  delete_memory: plain('native'),
  add_redaction_rule: plain('native'),
  list_redaction_rules: plain('native'),
  remove_redaction_rule: plain('native'),
  read_app_logs: plain('native'),
  conversation_usage: plain('native'),
  read_conversation: plain('native'),

  // ---- stickers and voice: JSON answers ----
  list_stickers: { side: 'native', args: 'fields', result: 'structured' },
  send_sticker: { side: 'native', args: 'fields', result: 'structured' },
  send_voice: { side: 'native', args: 'fields', result: 'structured' },

  // ---- QQ: fixed Chinese sentences and line lists ----
  qq_get_chat_history: plain('native'),
  qq_get_group_info: plain('native'),
  qq_get_group_member_list: plain('native'),
  qq_get_group_member_info: plain('native'),
  qq_get_user_info: plain('native'),
  qq_get_friend_list: plain('native'),
  qq_get_group_list: plain('native'),
  qq_delete_msg: plain('native'),
  qq_send_poke: plain('native'),
  qq_send_like: plain('native'),
  qq_set_essence_msg: plain('native'),
  qq_set_group_ban: plain('native'),
  qq_set_group_kick: plain('native'),
  qq_set_group_card: plain('native'),
  qq_set_group_name: plain('native'),
  qq_send_group_notice: plain('native'),
}

/**
 * The name to look a call up under. A tool this app lends a hosted agent
 * reaches the transcript as `mcp__meridian__<name>`, and it is the same tool:
 * same arguments, same output, same card. Anything else under `mcp__` is a
 * server whose tools nobody here has read, and keeps its name.
 */
export function canonicalToolName(name: string): string {
  if (!name.startsWith(BRIDGE_PREFIX)) return name
  const inner = name.slice(BRIDGE_PREFIX.length)
  return TOOLS[inner]?.side === 'native' ? inner : name
}

/** The entry for a call's tool, or `undefined` for MCP, custom tools and
 *  anything else whose shape is only known at runtime. */
export function toolUi(name: string): ToolUi | undefined {
  const key = canonicalToolName(name)
  return Object.prototype.hasOwnProperty.call(TOOLS, key) ? TOOLS[key] : undefined
}

/** It asks the user questions, so it is answered rather than approved. */
export function isAskTool(name: string): boolean {
  return toolUi(name)?.ask === true
}

/** The hosted tool names, in declaration order. */
export const HOSTED_TOOL_NAMES: readonly string[] = Object.keys(TOOLS).filter((name) => TOOLS[name].side === 'hosted')
