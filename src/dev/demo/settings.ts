import { decimal } from '@/lib/decimal'
import type {
  AppInfoResponse,
  AssistantInfoResponse,
  CustomToolInfoResponse,
  EmojiInfoResponse,
  EmojiPackInfoResponse,
  HookConfigInfoResponse,
  ImeConfigInfoResponse,
  ImeDictionaryInfoResponse,
  ImeStatusInfoResponse,
  ListenConfigInfoResponse,
  LogEntryInfoResponse,
  LogRecordLevel,
  McpServerInfoResponse,
  McpServerToolInfoResponse,
  McpToolInfoResponse,
  MemoryInfoResponse,
  MemorySubjectInfoResponse,
  ModelConfigInfoResponse,
  ModelProfileInfoResponse,
  OneBotConfigInfoResponse,
  PreferenceInfoValueByKey,
  ProviderCapabilitiesInfoResponse,
  ProviderCatalogEntryInfoResponse,
  ProviderInfoResponse,
  SkillInfoResponse,
  TemplateVariableInfoResponse,
  ToolCategoryInfoResponse,
  ToolPresetInfoResponse,
  UsageBucketInfoResponse,
  UsageDimension,
  VoiceCorpusSessionInfoResponse,
} from '@/types'
import { CONV, PROJECT_MERIDIAN, STICKERS } from './conversations'
import { ago, stickerSvg } from './factories'

/** Everything the settings pages read, as one value the handlers mutate. */

export const PROVIDER = {
  anthropic: 'demo-provider-anthropic',
  deepseek: 'demo-provider-deepseek',
  relay: 'demo-provider-relay',
} as const

export function buildProviders(now: number): ProviderInfoResponse[] {
  const base = {
    is_enabled: true,
    created_at: ago(60 * 24 * 90, now),
    updated_at: ago(60 * 24, now),
    credential_kind: 'api_key' as const,
    transport_profile: 'standard' as const,
    icon: null,
    codex_request_shape: false,
  }
  return [
    {
      ...base,
      id: PROVIDER.anthropic,
      name: 'Anthropic',
      provider_type: 'anthropic',
      base_url: 'https://api.anthropic.com',
      sort_order: 0,
      api_format: 'chat_completions',
      catalog_id: 'anthropic',
    },
    {
      ...base,
      id: PROVIDER.deepseek,
      name: 'DeepSeek',
      provider_type: 'deepseek',
      base_url: 'https://api.deepseek.com',
      sort_order: 1,
      api_format: 'chat_completions',
      catalog_id: 'deepseek',
    },
    {
      ...base,
      id: PROVIDER.relay,
      name: '自建中转',
      provider_type: 'openai',
      base_url: 'https://relay.example.com/v1',
      sort_order: 2,
      api_format: 'responses',
      catalog_id: null,
      is_enabled: false,
    },
  ]
}

export function buildCatalog(): ProviderCatalogEntryInfoResponse[] {
  const entry = (
    id: string,
    type: ProviderCatalogEntryInfoResponse['provider_type'],
    name: string,
    url: string,
    balance: boolean,
    models: string[],
  ): ProviderCatalogEntryInfoResponse => ({
    id,
    provider_type: type,
    name,
    icon: name,
    balance,
    websites: { official: url, api_key: `${url}/keys`, docs: `${url}/docs`, models: null },
    auth: [
      {
        id: 'api_key',
        credential_kind: 'api_key',
        transport_profile: 'standard',
        api_formats: ['chat_completions'],
        default_base_url: { chat_completions: url },
      },
    ],
    models: [{ family: name, ids: models }],
  })
  return [
    entry('anthropic', 'anthropic', 'Anthropic', 'https://api.anthropic.com', false, [
      'claude-sonnet-5',
      'claude-haiku-5',
    ]),
    entry('deepseek', 'deepseek', 'DeepSeek', 'https://api.deepseek.com', true, ['deepseek-chat', 'deepseek-reasoner']),
    entry('openai', 'openai', 'OpenAI', 'https://api.openai.com/v1', false, ['gpt-5.6', 'gpt-5.6-mini']),
    entry('xai', 'xai', 'xAI', 'https://api.x.ai/v1', false, ['grok-4.6']),
    entry('google', 'google', 'Google', 'https://generativelanguage.googleapis.com', false, ['gemini-3-pro']),
  ]
}

function profile(
  id: string,
  name: string,
  now: number,
  prices: [string, string, string | null, string | null] | null,
  window = 200_000,
): ModelProfileInfoResponse {
  return {
    id,
    name,
    context_window: window,
    compact_threshold: Math.round(window * 0.8),
    max_output_tokens: 64_000,
    input_price: prices ? decimal(prices[0]) : null,
    output_price: prices ? decimal(prices[1]) : null,
    cache_read_price: prices?.[2] ? decimal(prices[2]) : null,
    cache_write_price: prices?.[3] ? decimal(prices[3]) : null,
    pricing_tiers: [],
    capability_overrides: null,
    model_count: 1,
    created_at: ago(60 * 24 * 30, now),
    updated_at: ago(60 * 24 * 3, now),
  }
}

export function buildModelConfigs(now: number): ModelConfigInfoResponse[] {
  const config = (
    id: string,
    providerId: string,
    modelId: string,
    p: ModelProfileInfoResponse,
    override?: [string, string],
  ): ModelConfigInfoResponse => ({
    id,
    provider_id: providerId,
    model_id: modelId,
    profile: p,
    overrides_pricing: override !== undefined,
    input_price: override ? decimal(override[0]) : null,
    output_price: override ? decimal(override[1]) : null,
    cache_read_price: null,
    cache_write_price: null,
    pricing_tiers: [],
    server_tools: null,
    server_tool_price: null,
    effective_pricing: {
      input_price: override ? decimal(override[0]) : p.input_price,
      output_price: override ? decimal(override[1]) : p.output_price,
      cache_read_price: override ? null : p.cache_read_price,
      cache_write_price: override ? null : p.cache_write_price,
      pricing_tiers: p.pricing_tiers,
      server_tool_price: null,
    },
    created_at: p.created_at,
    updated_at: p.updated_at,
  })
  const sonnet = profile('demo-profile-sonnet', 'Claude Sonnet 5', now, ['3', '15', '0.3', '3.75'])
  const haiku = profile('demo-profile-haiku', 'Claude Haiku 5', now, ['1', '5', '0.1', '1.25'])
  const dsChat = profile('demo-profile-ds-chat', 'DeepSeek V4', now, ['0.27', '1.1', '0.07', null], 128_000)
  const dsReasoner = profile('demo-profile-ds-reasoner', 'DeepSeek R2', now, null, 128_000)
  const relayModel = profile('demo-profile-relay', 'GPT-5.6', now, ['1.25', '10', '0.125', null], 400_000)
  return [
    config('demo-model-sonnet', PROVIDER.anthropic, 'claude-sonnet-5', sonnet),
    config('demo-model-haiku', PROVIDER.anthropic, 'claude-haiku-5', haiku),
    config('demo-model-ds-chat', PROVIDER.deepseek, 'deepseek-chat', dsChat),
    config('demo-model-ds-reasoner', PROVIDER.deepseek, 'deepseek-reasoner', dsReasoner),
    config('demo-model-relay', PROVIDER.relay, 'gpt-5.6', relayModel, ['1.5', '12']),
  ]
}

export const CAPABILITIES: ProviderCapabilitiesInfoResponse = {
  supports_tools: true,
  supports_streaming_tools: true,
  supports_thinking: true,
  supports_thinking_off: true,
  supports_images: true,
  max_context_tokens: 200_000,
  max_output_tokens: 64_000,
  supports_pdf: true,
  supports_temperature: true,
  supports_top_p: true,
  max_temperature: 1,
  thinking_style: 'adaptive',
  supported_efforts: ['low', 'medium', 'high', 'max'],
  default_effort: 'medium',
  supports_fast: false,
  supports_verbosity: false,
  default_verbosity: null,
  server_tools: ['web_search'],
}

export function buildAssistants(now: number): AssistantInfoResponse[] {
  const base = {
    description: null,
    avatar: null,
    temperature: null,
    top_p: null,
    max_tokens: null,
    created_at: ago(60 * 24 * 90, now),
    updated_at: ago(60 * 24 * 7, now),
    context_limit: 200_000,
    compact_keep_recent: 6,
    enabled_tools: null,
    thinking_enabled: true,
    thinking_budget: null,
    tool_preset_id: null,
    auto_compact_enabled: true,
  }
  return [
    {
      ...base,
      id: 'demo-assistant-default',
      name: '默认助手',
      system_prompt: '你是一个严谨的编程助手。回答简洁，给出可运行的代码。',
      provider_id: PROVIDER.anthropic,
      model_id: 'claude-sonnet-5',
      is_default: true,
      sort_order: 0,
    },
    {
      ...base,
      id: 'demo-assistant-writer',
      name: '写作润色',
      description: '中文写作与润色',
      system_prompt: '你是一位中文编辑，帮用户润色文字，保持原意。',
      provider_id: PROVIDER.deepseek,
      model_id: 'deepseek-chat',
      temperature: 0.7,
      is_default: false,
      sort_order: 1,
      thinking_enabled: false,
    },
  ]
}

export function buildMcpServers(now: number): McpServerInfoResponse[] {
  return [
    {
      id: 'demo-mcp-filesystem',
      name: 'filesystem',
      transport_type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\demo\\Documents'],
      env: null,
      url: null,
      headers: null,
      is_enabled: true,
      sort_order: 0,
      created_at: ago(60 * 24 * 20, now),
      updated_at: ago(60 * 24 * 2, now),
    },
    {
      id: 'demo-mcp-github',
      name: 'github',
      transport_type: 'streamablehttp',
      command: null,
      args: null,
      env: null,
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ••••••••' },
      is_enabled: true,
      sort_order: 1,
      created_at: ago(60 * 24 * 10, now),
      updated_at: ago(60 * 24, now),
    },
    {
      id: 'demo-mcp-sqlite',
      name: 'sqlite',
      transport_type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', 'demo.db'],
      env: { LOG_LEVEL: 'warn' },
      url: null,
      headers: null,
      is_enabled: false,
      sort_order: 2,
      created_at: ago(60 * 24 * 5, now),
      updated_at: ago(60 * 24 * 5, now),
    },
  ]
}

export function buildMcpTools(): McpServerToolInfoResponse[] {
  const tool = (serverId: string, server: string, name: string, description: string): McpServerToolInfoResponse => ({
    server_id: serverId,
    server_name: server,
    qualified_name: `mcp__${server}__${name}`,
    name,
    description,
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  })
  return [
    tool('demo-mcp-filesystem', 'filesystem', 'read_text_file', 'Read a text file from the allowed directories.'),
    tool('demo-mcp-filesystem', 'filesystem', 'list_directory', 'List entries of a directory.'),
    tool('demo-mcp-filesystem', 'filesystem', 'search_files', 'Search files by glob pattern.'),
    tool('demo-mcp-github', 'github', 'get_issue', 'Get a single issue by number.'),
    tool('demo-mcp-github', 'github', 'create_pull_request', 'Open a pull request.'),
  ]
}

export function buildToolNames(): McpToolInfoResponse[] {
  const builtin = (name: string, description: string, needsApproval: boolean): McpToolInfoResponse => ({
    name,
    description,
    source: 'builtin',
    server_name: null,
    admin_only: null,
    needs_approval: needsApproval,
    scope: null,
  })
  return [
    builtin('read_file', 'Read a file inside the project.', false),
    builtin('search_files', 'Search file contents with a regular expression.', false),
    builtin('edit_file', 'Replace an exact string in a file.', true),
    builtin('write_file', 'Write a whole file.', true),
    builtin('run_command', 'Run a shell command.', true),
    builtin('web_search', 'Search the web.', true),
    builtin('update_todos', 'Maintain the task checklist.', false),
    builtin('run_agent', 'Delegate work to a sub-agent.', false),
    ...buildMcpTools().map((tool): McpToolInfoResponse => ({
      name: tool.qualified_name,
      description: tool.description,
      source: 'mcp',
      server_name: tool.server_name,
      admin_only: null,
      needs_approval: true,
      scope: null,
    })),
  ]
}

export function buildToolCategories(now: number): ToolCategoryInfoResponse[] {
  return [
    {
      id: 'demo-cat-dev',
      name: '开发',
      description: '构建与测试',
      icon: null,
      sort_order: 0,
      created_at: ago(9000, now),
    },
  ]
}

export function buildCustomTools(now: number): CustomToolInfoResponse[] {
  return [
    {
      id: 'demo-tool-typecheck',
      name: 'typecheck',
      description: '运行 TypeScript 类型检查',
      category_id: 'demo-cat-dev',
      parameters_schema: { type: 'object', properties: {} },
      command: 'pnpm exec tsc -b',
      args_template: null,
      working_directory: null,
      timeout_ms: 120_000,
      permission: 'ask',
      is_enabled: true,
      sort_order: 0,
      created_at: ago(9000, now),
      updated_at: ago(3000, now),
    },
  ]
}

export function buildToolPresets(now: number): ToolPresetInfoResponse[] {
  return [
    {
      id: 'demo-preset-readonly',
      name: '只读',
      description: '只能读文件和搜索',
      icon: null,
      tool_names: ['read_file', 'search_files'],
      is_builtin: true,
      sort_order: 0,
      created_at: ago(90000, now),
      updated_at: ago(90000, now),
    },
    {
      id: 'demo-preset-coding',
      name: '编码',
      description: null,
      icon: null,
      tool_names: ['read_file', 'search_files', 'edit_file', 'write_file', 'run_command'],
      is_builtin: false,
      sort_order: 1,
      created_at: ago(9000, now),
      updated_at: ago(9000, now),
    },
  ]
}

export function buildSkills(now: number): SkillInfoResponse[] {
  const skill = (dir: string, name: string, description: string, source: SkillInfoResponse['source']) => ({
    dir_name: dir,
    llm_name: dir,
    llm_description: description,
    display_name: name,
    display_description: description,
    source,
    is_enabled: true,
    is_builtin: source === 'official',
    mtime_hash: null,
    created_at: ago(9000, now),
    updated_at: ago(3000, now),
  })
  return [
    skill('meridian-diagnostics', '诊断', '读取应用日志来排查问题', 'official'),
    skill('commit-message', '提交信息', '按三段格式写 commit message', 'user'),
  ]
}

export const SKILL_BODY = '# 提交信息\n\n影响面、验证方法、已接受的风险，三段缺一不可。\n'

export function buildMemories(now: number): MemoryInfoResponse[] {
  const memory = (
    id: string,
    scope: MemoryInfoResponse['scope_type'],
    scopeId: string,
    key: string,
    content: string,
    type: MemoryInfoResponse['memory_type'],
    origin: MemoryInfoResponse['origin'],
    minutes: number,
    over: Partial<MemoryInfoResponse> = {},
  ): MemoryInfoResponse => ({
    id,
    scope_type: scope,
    scope_id: scopeId,
    key,
    content,
    memory_type: type,
    subject_scope_id: null,
    origin,
    visibility: 'normal',
    source_session_id: null,
    deleted_at: null,
    deleted_by: null,
    created_at: ago(minutes, now),
    updated_at: ago(minutes / 2, now),
    ...over,
  })
  return [
    memory(
      'demo-mem-1',
      'project',
      PROJECT_MERIDIAN,
      'package-manager',
      '项目只用 pnpm，不要用 npm 或 yarn。',
      'instruction',
      'desktop',
      9000,
    ),
    memory(
      'demo-mem-2',
      'project',
      PROJECT_MERIDIAN,
      'money',
      '所有金额使用 Decimal 字符串，禁止 number。',
      'instruction',
      'desktop',
      7000,
    ),
    memory(
      'demo-mem-3',
      'project',
      PROJECT_MERIDIAN,
      'ui-kit',
      '前端组件以 BoardUI 为准，交互契约用 React Aria。',
      'fact',
      'desktop',
      3000,
    ),
    memory('demo-mem-4', 'client_global', 'client', 'font', '偏好苹方和 Maple Mono。', 'preference', 'desktop', 20000),
    memory('demo-mem-5', 'client_global', 'client', 'language', '回复使用中文。', 'preference', 'desktop', 20000),
    memory(
      'demo-mem-6',
      'onebot_global',
      'onebot',
      'group-rules',
      '群里不讨论政治话题。',
      'instruction',
      'admin',
      12000,
    ),
    memory(
      'demo-mem-7',
      'onebot_user',
      'onebot:10001',
      'nickname',
      '喜欢被叫作"小丘"。',
      'relationship',
      'private',
      800,
      {
        subject_scope_id: 'onebot:10001',
      },
    ),
    memory('demo-mem-8', 'onebot_user', 'onebot:10002', 'hobby', '在做 ESP32 的键盘固件。', 'fact', 'group', 400, {
      subject_scope_id: 'onebot:10002',
      visibility: 'owner_only',
    }),
  ]
}

export function buildMemoryTrash(now: number): MemoryInfoResponse[] {
  return [
    {
      id: 'demo-mem-trash-1',
      scope_type: 'project',
      scope_id: PROJECT_MERIDIAN,
      key: 'old-node',
      content: '要求 Node 20。',
      memory_type: 'fact',
      subject_scope_id: null,
      origin: 'legacy',
      visibility: 'normal',
      source_session_id: null,
      deleted_at: ago(600, now),
      deleted_by: 'self',
      created_at: ago(90000, now),
      updated_at: ago(600, now),
    },
  ]
}

export function buildMemorySubjects(now: number): MemorySubjectInfoResponse[] {
  return [
    {
      scope_id: 'onebot:10001',
      display_name: '小丘',
      last_seen_at: ago(30, now),
      created_at: ago(90000, now),
      is_protected: true,
      is_pinned: true,
      opted_out: false,
    },
    {
      scope_id: 'onebot:10002',
      display_name: '阿木',
      last_seen_at: ago(400, now),
      created_at: ago(40000, now),
      is_protected: false,
      is_pinned: false,
      opted_out: false,
    },
  ]
}

/** One bucket, with its costs already priced — the fixtures never add them up
 *  on the front end, for the same reason the real report does not. */
function bucket(
  key: string,
  label: string | null,
  messages: number,
  input: number,
  output: number,
  cacheRead: number,
  costs: [string, string, string, string],
): UsageBucketInfoResponse {
  return {
    key,
    label,
    messages,
    metered_messages: messages,
    subscription_messages: 0,
    external_messages: 0,
    missing_token_usage_messages: 0,
    incomplete_token_usage_messages: 0,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: Math.round(cacheRead / 20),
    input_cost: decimal(costs[0]),
    output_cost: decimal(costs[1]),
    cache_cost: decimal(costs[2]),
    tool_cost: decimal('0'),
    total_cost: decimal(costs[3]),
    unpriced_token_messages: 0,
    unpriced_tool_messages: 0,
    estimated_token_messages: 0,
    estimated_tool_messages: 0,
    estimated_messages: 0,
    unpriced_messages: 0,
  }
}

function dayKey(time: number): string {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function usageBuckets(dimension: UsageDimension, now: number): UsageBucketInfoResponse[] {
  switch (dimension) {
    case 'total':
      return [bucket('total', null, 412, 3_120_400, 402_300, 2_480_000, ['2.1402', '6.0345', '0.8124', '8.9871'])]
    case 'day':
    case 'hour':
      return Array.from({ length: 14 }, (_, index) => {
        const scale = [3, 5, 2, 8, 6, 1, 0, 4, 9, 7, 5, 6, 10, 4][index]
        const cost = (n: number) => (n * scale).toFixed(4)
        return bucket(
          dimension === 'day'
            ? dayKey(now - (13 - index) * 86_400_000)
            : `${dayKey(now)} ${String(index + 8).padStart(2, '0')}`,
          null,
          scale * 5,
          scale * 42_000,
          scale * 5_100,
          scale * 33_000,
          [cost(0.0302), cost(0.0765), cost(0.0099), cost(0.1166)],
        )
      })
    case 'provider':
      return [
        bucket(PROVIDER.anthropic, 'Anthropic', 301, 2_400_000, 310_000, 2_100_000, ['1.8', '4.65', '0.72', '7.17']),
        bucket(PROVIDER.deepseek, 'DeepSeek', 98, 690_400, 88_300, 380_000, ['0.3402', '1.3845', '0.0924', '1.8171']),
        bucket('demo-provider-deleted', null, 13, 30_000, 4_000, 0, ['0', '0', '0', '0']),
      ]
    case 'model':
      return [
        bucket('claude-sonnet-5', 'claude-sonnet-5', 240, 2_100_000, 280_000, 1_900_000, [
          '1.65',
          '4.2',
          '0.66',
          '6.51',
        ]),
        bucket('claude-haiku-5', 'claude-haiku-5', 61, 300_000, 30_000, 200_000, ['0.15', '0.45', '0.06', '0.66']),
        bucket('deepseek-chat', 'deepseek-chat', 111, 720_400, 92_300, 380_000, [
          '0.3402',
          '1.3845',
          '0.0924',
          '1.8171',
        ]),
      ]
    case 'conversation':
      return [
        bucket(CONV.rich, '流式输出时回答写在屏幕外', 12, 80_000, 9_000, 60_000, ['0.06', '0.135', '0.018', '0.213']),
        bucket(CONV.delegate, 'Android 键盘遮挡输入框', 22, 140_000, 14_000, 90_000, ['0.1', '0.21', '0.027', '0.337']),
        bucket('demo-conv-gone', null, 4, 10_000, 1_000, 0, ['0.03', '0.015', '0', '0.045']),
      ]
    case 'bot':
    case 'source':
      return [bucket('desktop', 'desktop', 380, 3_000_000, 390_000, 2_400_000, ['2.1', '5.85', '0.8', '8.75'])]
    case 'kind':
      return [
        bucket('assistant', null, 390, 3_000_000, 395_000, 2_450_000, ['2.1', '5.95', '0.8', '8.85']),
        bucket('auto_review', null, 22, 120_400, 7_300, 30_000, ['0.0402', '0.0845', '0.0124', '0.1371']),
      ]
  }
}

export function buildLogs(now: number): LogEntryInfoResponse[] {
  const rows: [LogRecordLevel, string, string, Record<string, unknown>][] = [
    ['INFO', 'meridian_lib::startup', 'app started', { version: '0.3.0' }],
    ['INFO', 'meridian_core::mcp', 'mcp server connected', { server: 'filesystem', tools: 3 }],
    ['WARN', 'meridian_core::mcp', 'mcp server failed to start', { server: 'sqlite', error: 'uvx: command not found' }],
    ['INFO', 'meridian_core::agent::engine', 'turn finished', { chars: 1234, rounds: 3 }],
    ['ERROR', 'meridian_core::provider::openai_compat', 'request failed', { status: 529, error: 'overloaded' }],
    ['INFO', 'meridian_core::agent::engine', 'turn finished', { chars: 380, rounds: 1 }],
    ['DEBUG', 'meridian_core::db', 'migration check', { applied: 61 }],
  ]
  return rows
    .map(([level, target, msg, fields], index): LogEntryInfoResponse => {
      const tsMs = ago(300 - index * 40, now)
      return {
        ts: new Date(tsMs).toISOString(),
        tsMs,
        level,
        target,
        msg,
        fields,
        spans: target.includes('engine') ? ['chat'] : [],
        spanFields: target.includes('engine') ? { conversation_id: CONV.rich } : {},
        file: null,
        line: null,
        cursor: { fileIndex: 0, byteOffset: index * 200 },
      }
    })
    .reverse()
}

export function buildOneBotConfig(): OneBotConfigInfoResponse {
  return {
    enabled: true,
    host: '127.0.0.1',
    port: 6700,
    access_token: 'demo-onebot-token',
    assistant_id: 'demo-assistant-default',
    admin_users: [10001],
    ack_emoji_id: '124',
    voice_capture_sessions: ['10000@group:123456'],
    voice_send_enabled: true,
    voice_send_groups: ['123456'],
    voice_tts_model: 's2.1-pro',
    voice_tts_reference_id: 'demo-voice-ref',
  }
}

export function buildVoiceCorpus(now: number): VoiceCorpusSessionInfoResponse[] {
  return [
    {
      handle: 'g-7f3a91',
      kind: 'group',
      clips: 128,
      bytes: 18_400_000,
      untranscribed: 3,
      last_captured_at: ago(45, now),
    },
    {
      handle: 'p-02bc44',
      kind: 'private',
      clips: 12,
      bytes: 1_600_000,
      untranscribed: 0,
      last_captured_at: ago(3000, now),
    },
  ]
}

export function buildHooksConfig(): HookConfigInfoResponse {
  return {
    enabled: true,
    host: '127.0.0.1',
    port: 17_311,
    token: 'demo-hooks-token-0000',
    review_model: `${PROVIDER.anthropic}:claude-sonnet-5`,
    assistant_id: null,
    timeout_secs: 1200,
    max_rounds: 3,
  }
}

export function buildListenConfig(): ListenConfigInfoResponse {
  return { enabled: false, host: '0.0.0.0', port: 8787, token: 'demo-listen-token-000000' }
}

export const IME_STATUS: ImeStatusInfoResponse = {
  installed: true,
  registered_x64: true,
  registered_x86: false,
  enabled_for_user: true,
  host_running: true,
  host_version: '0.3.0',
  protocol_compatible: true,
  sessions: 1,
  data_dir: 'C:\\Users\\demo\\AppData\\Roaming\\Meridian\\ime',
  host_path: 'C:\\Program Files\\Meridian\\meridian-ime-host.exe',
  dll_path: 'C:\\Program Files\\Meridian\\meridian_ime_tsf.dll',
  registered_dll_path: 'C:\\Program Files\\Meridian\\meridian_ime_tsf.dll',
}

export const IME_CONFIG: ImeConfigInfoResponse = {
  scheme: 'pinyin',
  page_size: 7,
  punctuation: 'full_width',
  learning: true,
  private_apps: ['KeePassXC.exe'],
  debug_log: false,
}

export const IME_DICTIONARIES: ImeDictionaryInfoResponse[] = [
  {
    file: 'rime-ice.dict',
    name: '雾凇拼音',
    entries: 812_340,
    size_bytes: 24_100_000,
    enabled: true,
    license: 'GPL-3.0',
    source: 'bundle',
  },
  {
    file: 'tech.dict',
    name: '技术词汇',
    entries: 5_120,
    size_bytes: 180_000,
    enabled: false,
    license: 'CC-BY-4.0',
    source: 'import',
  },
]

export function buildEmojiPacks(now: number): EmojiPackInfoResponse[] {
  return [
    {
      id: 'demo-pack-daily',
      name: '日常',
      description: '常用表情',
      cover_image: null,
      is_builtin: false,
      sort_order: 0,
      created_at: ago(9000, now),
      updated_at: ago(300, now),
      kind: 'manual',
      source_account_id: null,
    },
  ]
}

export const STICKER_IMAGES: Record<string, string> = {
  [STICKERS.thumbs]: stickerSvg('👍', 45),
  [STICKERS.cat]: stickerSvg('🐱', 200),
  [STICKERS.party]: stickerSvg('🎉', 320),
}

export function buildEmojis(now: number): EmojiInfoResponse[] {
  const names: Record<string, string> = {
    [STICKERS.thumbs]: '点赞',
    [STICKERS.cat]: '猫猫探头',
    [STICKERS.party]: '撒花',
  }
  return Object.keys(STICKER_IMAGES).map((id, index) => ({
    id,
    pack_id: 'demo-pack-daily',
    name: names[id],
    tags: index === 1 ? '可爱,好奇' : null,
    file_name: `${id}.svg`,
    file_format: 'svg',
    sort_order: index,
    created_at: ago(9000, now),
    source: 'local',
    source_key: null,
    semantic_status: index === 2 ? 'suggested' : 'confirmed',
    suggested_name: index === 2 ? '庆祝' : null,
    suggested_tags: null,
    file_size: 1200,
    seen_count: 4 - index,
    last_seen_at: ago(60 * index, now),
  }))
}

export const TEMPLATE_VARIABLES: TemplateVariableInfoResponse[] = [
  { name: 'date', description_en: "Today's date", description_zh: '今天的日期' },
  { name: 'project', description_en: 'Current project name', description_zh: '当前项目名' },
]

export const APP_INFO: AppInfoResponse = {
  version: '0.3.0-demo',
  tauriVersion: '2.x',
  os: 'windows',
  arch: 'x86_64',
  dataDir: 'C:\\Users\\demo\\AppData\\Roaming\\Meridian',
}

export function buildPreferences(): { [K in keyof PreferenceInfoValueByKey]: PreferenceInfoValueByKey[K] } {
  return {
    shell: 'powershell',
    'sandbox.enabled': 'auto',
    search_provider: 'tavily',
    'voice.filter_level': 'standard',
    'voice.download_url': null,
    'android.manage_storage_enabled': null,
    'autoreview.enabled': true,
    'autoreview.model': { provider_id: PROVIDER.anthropic, model_id: 'claude-haiku-5' },
    'autoreview.escalate': true,
    'autoreview.allow_rules': '只读命令可以放行。',
    'autoreview.deny_rules': '禁止删除项目外的文件。',
    'autoreview.environment': null,
    'approvals.ttl_minutes': 30,
    'sub_agent.explore.model': { provider_id: PROVIDER.anthropic, model_id: 'claude-haiku-5' },
    'sub_agent.agent.model': null,
    'codex.client_version': null,
  }
}
