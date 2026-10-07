// Sample data shared by the gallery pages. Shapes are the real response types,
// so a contract change that breaks a fixture is a type error here too.
import { decimal } from '@/lib/decimal'
import type { StickerGridItem } from '@/components/chat/sticker-grid'
import type { TouchedFile } from '@/lib/touched-files'
import type {
  ConversationInfoResponse,
  MessageViewModel,
  ProjectInfoResponse,
  ProviderCapabilitiesInfoResponse,
  QueuedPromptInfoResponse,
  ToolCallDisplay,
  TurnUsageInfoResponse,
} from '@/types'

export function noop() {}

export function tool(over: Partial<ToolCallDisplay> & Pick<ToolCallDisplay, 'tool_name' | 'status'>): ToolCallDisplay {
  return {
    call_id: `pg-${over.tool_name}-${over.status}`,
    arguments: '{}',
    // A pending card has to carry something to answer with or it renders as
    // orphaned. Supplied only for pending: the settled states have nothing left
    // to send, and a stray id there would just be noise.
    ...(over.status === 'pending' ? { approval_id: `pg-approval-${over.tool_name}` } : {}),
    ...over,
  }
}

export function caps(over: Partial<ProviderCapabilitiesInfoResponse> = {}): ProviderCapabilitiesInfoResponse {
  return {
    supports_tools: true,
    supports_streaming_tools: true,
    supports_thinking: true,
    supports_thinking_off: true,
    supports_images: true,
    max_context_tokens: 272_000,
    max_output_tokens: 128_000,
    supports_pdf: true,
    supports_temperature: true,
    supports_top_p: true,
    max_temperature: 2,
    thinking_style: 'effort_only',
    supported_efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    default_effort: 'medium',
    supports_fast: false,
    supports_verbosity: false,
    default_verbosity: null,
    server_tools: [],
    ...over,
  }
}

/** Fixed so the relative timestamps stay on "刚刚" between reloads. */
export const PG_NOW = Date.now()

export function msg(
  over: Partial<MessageViewModel> & Pick<MessageViewModel, 'id' | 'role' | 'content'>,
): MessageViewModel {
  return {
    conversation_id: 'pg',
    provider_id: 'openai',
    model_id: 'gpt-5.6-sol',
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    provider_name: null,
    tool_calls: null,
    tool_call_id: null,
    sort_order: 0,
    created_at: PG_NOW,
    reasoning_content: null,
    rating: null,
    is_compact_summary: false,
    sender_id: null,
    parent_id: null,
    compact_anchor_id: null,
    source: null,
    turn_id: null,
    tool_outcome: null,
    auto_review: null,
    tool_diffs: null,
    context_items: [],
    ...over,
  }
}

export function pgUsage(over: Partial<TurnUsageInfoResponse> = {}): TurnUsageInfoResponse {
  return {
    messages: 3,
    missing_token_usage_messages: 0,
    incomplete_token_usage_messages: 0,
    input_tokens: 611_603,
    output_tokens: 6_699,
    cache_read_tokens: 540_000,
    cache_write_tokens: 0,
    server_tool_calls: 0,
    input_cost: decimal('0.1432'),
    output_cost: decimal('0.0268'),
    cache_cost: decimal('0.054'),
    tool_cost: decimal('0'),
    total_cost: decimal('0.224'),
    unpriced_token_messages: 0,
    unpriced_input_messages: 0,
    unpriced_output_messages: 0,
    unpriced_cache_messages: 0,
    unpriced_tool_messages: 0,
    estimated_token_messages: 0,
    estimated_tool_messages: 0,
    estimated_messages: 0,
    unpriced_messages: 0,
    metered_messages: 3,
    subscription_messages: 0,
    external_messages: 0,
    pricing_status: 'exact',
    ...over,
  }
}

/**
 * An animated sticker without a backend: an SVG whose SMIL animation plays in
 * an `<img>` and stops at its first frame when drawn into a canvas, which is
 * the same still/playing split a GIF gets.
 */
function pgSticker(i: number): StickerGridItem {
  const hue = (i * 47) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="hsl(${hue} 70% 60%)"/><circle cx="48" cy="48" r="18" fill="white"><animate attributeName="r" values="10;30;10" dur="1.2s" repeatCount="indefinite"/></circle><text x="48" y="90" font-size="12" text-anchor="middle" fill="white">${i + 1}</text></svg>`
  return {
    id: `pg-sticker-${i}`,
    name: `贴纸 ${i + 1}`,
    textValue: `贴纸 ${i + 1}`,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  }
}

export const PG_STICKERS = Array.from({ length: 30 }, (_, i) => pgSticker(i))

export function queued(
  id: string,
  delivery: QueuedPromptInfoResponse['delivery'],
  content: string,
): QueuedPromptInfoResponse {
  return {
    id,
    conversation_id: 'pg',
    content,
    delivery,
    position: 0,
    created_at: 0,
    dispatched_at: null,
    dispatched_turn_id: null,
    settled_at: null,
    settled_message_id: null,
    held_at: null,
    reported_at: null,
  }
}

export const ANSWER = '加上这条后，v3.1 可以视为定稿并开始拆 MR 实施。'

/** An answer opening on a heading, which is where the leading margin shows. */
export const ANSWER_MD = [
  '## 终审结论',
  '',
  'v3.1 的架构和实施边界已经基本正确，**可以进入实施阶段**。没有再发现需要整体改写计划的阻塞性设计错误。',
  '',
  '但编码前建议在计划中补充以下 4 个精确说明，避免实施者走偏。',
].join('\n')

export const READ_RESULT = [
  "import { defineConfig } from 'vite'",
  '',
  'export default defineConfig({',
  '  server: { port: 5173 },',
  '})',
].join('\n')

export const SEARCH_RESULT = [
  'src/api.ts:12:export const api = {',
  'src/api.ts:48:  approveToolCall(callId: string) {',
  'src/components/chat/chat-view.tsx:445:  <MarkerContent className="shimmer">',
].join('\n')

export const COMMAND_RESULT = [
  '$ cargo check',
  '    Checking meridian v0.1.2',
  '    Finished `dev` profile [unoptimized] target(s) in 3.42s',
].join('\n')

export const WEB_SEARCH_RESULT = JSON.stringify({
  sources: [
    { title: 'boardui', url: 'https://boardui.com', content: '', site_name: 'boardui' },
    {
      title: 'Base UI Collapsible',
      url: 'https://base-ui.com/react/components/collapsible',
      content: '',
      site_name: 'Base UI',
    },
  ],
})

export const CODEX_PATCH = [
  '*** Begin Patch',
  '*** Update File: src/api/assets.py',
  '@@',
  ' async def create_asset(',
  '     session: SessionDep,',
  '-) -> AssetResponse:',
  '+) -> AssetCreateResponse:',
  '     user_file = await validate_user_file(session, request.file_id)',
  '+    user_file_id = user_file.id',
  '*** End Patch',
].join('\n')

export const UNIFIED_PATCH = [
  '--- a/src/lib.rs',
  '+++ b/src/lib.rs',
  '@@ -1,3 +1,3 @@',
  ' fn keep() {}',
  '-fn old() {}',
  '+fn renamed() {}',
].join('\n')

export const WRITE_FILE_CONTENT = [
  'export function formatBytes(n: number): string {',
  "  const units = ['B', 'KB', 'MB', 'GB']",
  '  let i = 0',
  '  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }',
  '  return `${n.toFixed(1)} ${units[i]}`',
  '}',
].join('\n')

export const ASK_USER_ARGS = JSON.stringify({
  questions: [
    {
      id: 'q1',
      question: '选择部署环境',
      options: [
        { label: 'staging', description: '预发布环境' },
        { label: 'production', description: '生产环境' },
      ],
      multi_select: false,
    },
  ],
})

export const RUN_AGENT_ARGS = JSON.stringify({
  agent: 'agent',
  description: '修好那个偶发失败的测试',
  prompt: 'src-tauri 里 concurrent_sessions 那条测试大约每二十次失败一次。找出原因并修掉，然后把整个测试套跑一遍。',
})

export const todoStep = (content: string, activeForm: string, status: string) => ({
  content,
  active_form: activeForm,
  status,
})

export const TODO_RUNNING = JSON.stringify({
  title: '重构鉴权模块',
  todos: [
    todoStep('抽离 token 校验', '正在抽离 token 校验', 'completed'),
    todoStep('替换调用方', '正在替换调用方', 'in_progress'),
    todoStep('补单元测试', '正在补单元测试', 'pending'),
    todoStep('跑一遍 CI', '正在跑 CI', 'pending'),
  ],
})

export const TODO_DONE = JSON.stringify({
  title: '修复 CI 失败',
  todos: [todoStep('定位失败用例', '正在定位失败用例', 'completed'), todoStep('修掉断言', '正在修断言', 'completed')],
})

export const TODO_SINGLE = JSON.stringify({
  title: '升级依赖',
  todos: [todoStep('跑 pnpm update', '正在跑 pnpm update', 'in_progress')],
})

// The model is allowed to leave nothing in progress; the bar has to say so.
export const TODO_NO_CURRENT = JSON.stringify({
  title: '梳理待办',
  todos: [todoStep('收集需求', '正在收集需求', 'completed'), todoStep('排优先级', '正在排优先级', 'pending')],
})

export const PLAN_MD = [
  '## 摘要',
  '',
  '把鉴权逻辑从 `handler.rs` 抽到独立模块，补上被绕过的过期校验。',
  '',
  '## 改动',
  '',
  '- `src/auth/token.rs`（新建）— 校验与刷新，复用现有的 `Claims`',
  '- `src/handler.rs` — 删掉内联校验，改调 `token::verify`',
  '',
  '```rust',
  'pub fn verify(raw: &str) -> Result<Claims, AuthError> {',
  '    let claims = decode(raw)?;',
  '    if claims.exp < now() { return Err(AuthError::Expired) }',
  '    Ok(claims)',
  '}',
  '```',
  '',
  '## 验证',
  '',
  '`cargo test auth::` — 新增过期 token 被拒的用例。',
].join('\n')

export const PLAN_ARGS = JSON.stringify({ plan: PLAN_MD })

export const CHANGED_FILES: TouchedFile[] = [
  { path: 'src/components/chat/changes-panel.tsx', op: 'create', count: 1 },
  { path: 'src/lib/touched-files.ts', op: 'create', count: 3 },
  { path: 'src/lib/patch-parse.ts', op: 'modify', count: 1 },
  { path: 'src/lib/nav.ts', op: 'delete', count: 1 },
  { path: 'src/i18n/locales/en.json', op: 'modify', count: 7 },
  { path: 'README.md', op: 'modify', count: 1 },
]

function paletteRow(
  id: string,
  title: string | null,
  over: Partial<ConversationInfoResponse> = {},
): ConversationInfoResponse {
  return {
    id,
    title,
    project_id: null,
    is_pinned: false,
    is_archived: false,
    message_count: 3,
    created_at: 0,
    updated_at: 0,
    assistant_id: null,
    thinking_level: null,
    fast_mode: false,
    mode: null,
    head_message_id: null,
    ...over,
  } as ConversationInfoResponse
}

export const PALETTE_ROWS: ConversationInfoResponse[] = [
  paletteRow('a', '英语学习入门指南'),
  paletteRow('b', null),
  paletteRow('c', '重构 tauri 命令注册表并把所有工具调用迁移到新的审批模型上'),
  paletteRow('d', '已归档的会话', { is_archived: true }),
]

export const PALETTE_PROJECTS: ProjectInfoResponse[] = [
  {
    id: 'p1',
    name: 'meridian',
    path: 'C:/code/meridian',
    source_type: 'local',
    source_id: null,
    assistant_id: null,
    description: null,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'p2',
    name: '某个群聊',
    path: null,
    source_type: 'onebot_group',
    source_id: '123',
    assistant_id: null,
    description: null,
    created_at: 0,
    updated_at: 0,
  },
]
