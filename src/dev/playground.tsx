// Dev-only component playground. Reachable at #playground from a plain browser
// (vite dev without the Tauri backend); never included in production builds.
import { useState } from 'react'
import { Moon, Sun } from '@gravity-ui/icons'

import { Button, Input, Tooltip } from '@heroui/react'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtSteps,
  ChainOfThoughtTrigger,
} from '@heroui-pro/react/chain-of-thought'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolArgs,
  ChatToolContent,
  ChatToolError,
  ChatToolResult,
  ChatToolStatusIcon,
  ChatToolTrigger,
} from '@/components/ui/chat-tool'
import HeroUiLab from './heroui-lab'
import ResponsiveLab, { ResponsiveFrame } from './responsive-lab'
import SchemaLab from './schema-lab'
import ScrollLab from './scroll-lab'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import { TurnItem } from '@/components/chat/turn-item'
import { TodoBarView } from '@/components/chat/todo-bar'
import TodoBoard from '@/components/chat/todo-board'
import type { TodoDraft } from '@/components/chat/todo-list'
import { PromptQueue } from '@/components/chat/prompt-queue'
import { Composer } from '@/components/chat/composer'
import { ComposerMenu } from '@/components/chat/composer-menu'
import { VoiceButton, type VoiceButtonState } from '@/components/ui/voice-button'
import { ChangesPanelView } from '@/components/chat/changes-panel'
import { CommandPalette } from '@/components/layout/command-palette'
import type { TouchedFile } from '@/lib/touched-files'
import { useHotkey } from '@/hooks/use-hotkey'
import { buildTurns } from '@/lib/turns'
import { useAppTheme } from '@/lib/theme'
import type {
  ChatMode,
  ContentBlock,
  ConversationInfoResponse,
  MessageViewModel,
  ProjectInfoResponse,
  ProviderCapabilitiesInfoResponse,
  ThinkingLevel,
  QueuedPromptInfoResponse,
  ToolCallDisplay,
} from '@/types'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      {children}
    </section>
  )
}

function tool(over: Partial<ToolCallDisplay> & Pick<ToolCallDisplay, 'tool_name' | 'status'>): ToolCallDisplay {
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

function caps(over: Partial<ProviderCapabilitiesInfoResponse> = {}): ProviderCapabilitiesInfoResponse {
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

/** Fixed so the relative timestamps below stay on "刚刚" between reloads. */
const PG_NOW = Date.now()

function msg(over: Partial<MessageViewModel> & Pick<MessageViewModel, 'id' | 'role' | 'content'>): MessageViewModel {
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
    context_items: [],
    ...over,
  }
}

const ANSWER = '加上这条后，v3.1 可以视为定稿并开始拆 MR 实施。'

/** An answer opening on a heading, which is where the leading margin shows. */
const ANSWER_MD = [
  '## 终审结论',
  '',
  'v3.1 的架构和实施边界已经基本正确，**可以进入实施阶段**。没有再发现需要整体改写计划的阻塞性设计错误。',
  '',
  '但编码前建议在计划中补充以下 4 个精确说明，避免实施者走偏。',
].join('\n')

/**
 * A whole turn as the chat view renders it: the question bubble, the answer as
 * a run of bubbles with their keyboards, the footer and the status line. Built
 * through `buildTurns` so the preview cuts the answer into bubbles the same
 * way the real transcript does.
 */
function TurnItemCase({
  label,
  blocks,
  rows,
  streaming = false,
  crashed = false,
  oneBot = false,
  hosted = false,
  question = '把审批矩阵那一节补完，然后我们定稿。',
  previousTurnEndedAt = PG_NOW - 60_000,
}: {
  label: string
  /** One assistant row. */
  blocks?: ContentBlock[]
  /** Several assistant rows, each a round of the loop; overrides `blocks`. */
  rows?: { blocks: ContentBlock[]; modelId?: string }[]
  streaming?: boolean
  crashed?: boolean
  oneBot?: boolean
  hosted?: boolean
  question?: string | null
  /** Null draws the date separator above the turn. */
  previousTurnEndedAt?: number | null
}) {
  const assistantRows = rows ?? (blocks ? [{ blocks }] : [])
  const turns = buildTurns(
    [
      ...(question === null
        ? []
        : [msg({ id: `${label}-u`, role: 'user', content: question, sort_order: 0, turn_id: 't' })]),
      ...assistantRows.map((row, i) =>
        msg({
          id: `${label}-a${i}`,
          role: 'assistant',
          content: row.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n'),
          sort_order: i + 1,
          created_at: PG_NOW + 450_000 + i * 30_000,
          model_id: row.modelId ?? 'gpt-4.1-mini',
          input_tokens: i === assistantRows.length - 1 ? 611_603 : null,
          output_tokens: i === assistantRows.length - 1 ? 6_699 : null,
          turn_id: 't',
          _blocks: row.blocks,
        }),
      ),
    ],
    { streaming, crashedTurnIds: crashed ? new Set(['t']) : undefined },
  )
  return (
    <div className="w-full max-w-2xl space-y-1 rounded-xl border border-dashed border-border/60 p-4">
      <div className="text-xs text-muted">{label}</div>
      {turns.map((turn) => (
        <TurnItem
          key={turn.id}
          turn={turn}
          conversationId="pg"
          isLastTurn={streaming}
          streaming={streaming}
          isOneBot={oneBot}
          isHosted={hosted}
          previousTurnEndedAt={previousTurnEndedAt}
          onRegenerate={noop}
          onRate={noop}
          onDelete={noop}
        />
      ))}
    </div>
  )
}

function noop() {}

/**
 * The composer menu with nothing behind it: `providers` is empty, so the model
 * row opens an empty column instead of fetching. That is the state worth
 * previewing anyway — the two-column layout has to hold before anything loads.
 */
function ComposerMenuCase({
  label,
  mode: initialMode,
  acceptEdits: initialAcceptEdits,
}: {
  label: string
  mode: ChatMode
  acceptEdits: boolean
}) {
  const [mode, setMode] = useState<ChatMode>(initialMode)
  const [acceptEdits, setAcceptEdits] = useState(initialAcceptEdits)
  const [thinking, setThinking] = useState<ThinkingLevel>('default')
  const [fast, setFast] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center rounded-lg border border-border px-2 py-1">
        <ComposerMenu
          assistants={[]}
          providers={[]}
          currentAssistantId={null}
          currentModelId="gpt-5.6-sol"
          currentProviderId={null}
          onSelectAssistant={() => {}}
          onSelectModel={() => {}}
          thinkingLevel={thinking}
          onSelectThinkingLevel={setThinking}
          fastMode={fast}
          onToggleFast={setFast}
          mode={mode}
          onSelectMode={setMode}
          acceptEdits={acceptEdits}
          onToggleAcceptEdits={setAcceptEdits}
          capabilities={caps()}
          onPickFile={() => {}}
        />
      </div>
      <span className="text-xs text-muted">
        {mode} · {acceptEdits ? 'accept-edits' : 'ask'}
      </span>
    </div>
  )
}

const READ_RESULT = [
  "import { defineConfig } from 'vite'",
  '',
  'export default defineConfig({',
  '  server: { port: 5173 },',
  '})',
].join('\n')

const SEARCH_RESULT = [
  'src/api.ts:12:export const api = {',
  'src/api.ts:48:  approveToolCall(callId: string) {',
  'src/components/chat/chat-view.tsx:445:  <MarkerContent className="shimmer">',
].join('\n')

const COMMAND_RESULT = [
  '$ cargo check',
  '    Checking meridian v0.1.2',
  '    Finished `dev` profile [unoptimized] target(s) in 3.42s',
].join('\n')

const WEB_SEARCH_RESULT = JSON.stringify({
  sources: [
    { title: 'HeroUI Pro', url: 'https://heroui.pro', content: '', site_name: 'HeroUI' },
    {
      title: 'Base UI Collapsible',
      url: 'https://base-ui.com/react/components/collapsible',
      content: '',
      site_name: 'Base UI',
    },
  ],
})

const CODEX_PATCH = [
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

const UNIFIED_PATCH = [
  '--- a/src/lib.rs',
  '+++ b/src/lib.rs',
  '@@ -1,3 +1,3 @@',
  ' fn keep() {}',
  '-fn old() {}',
  '+fn renamed() {}',
].join('\n')

const WRITE_FILE_CONTENT = [
  'export function formatBytes(n: number): string {',
  "  const units = ['B', 'KB', 'MB', 'GB']",
  '  let i = 0',
  '  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }',
  '  return `${n.toFixed(1)} ${units[i]}`',
  '}',
].join('\n')

const ASK_USER_ARGS = JSON.stringify({
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

const RUN_AGENT_ARGS = JSON.stringify({
  agent: 'agent',
  description: '修好那个偶发失败的测试',
  prompt: 'src-tauri 里 concurrent_sessions 那条测试大约每二十次失败一次。找出原因并修掉，然后把整个测试套跑一遍。',
})

const todoStep = (content: string, activeForm: string, status: string) => ({
  content,
  active_form: activeForm,
  status,
})

function queued(id: string, delivery: QueuedPromptInfoResponse['delivery'], content: string): QueuedPromptInfoResponse {
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

const TODO_RUNNING = JSON.stringify({
  title: '重构鉴权模块',
  todos: [
    todoStep('抽离 token 校验', '正在抽离 token 校验', 'completed'),
    todoStep('替换调用方', '正在替换调用方', 'in_progress'),
    todoStep('补单元测试', '正在补单元测试', 'pending'),
    todoStep('跑一遍 CI', '正在跑 CI', 'pending'),
  ],
})

const TODO_DONE = JSON.stringify({
  title: '修复 CI 失败',
  todos: [todoStep('定位失败用例', '正在定位失败用例', 'completed'), todoStep('修掉断言', '正在修断言', 'completed')],
})

const TODO_SINGLE = JSON.stringify({
  title: '升级依赖',
  todos: [todoStep('跑 pnpm update', '正在跑 pnpm update', 'in_progress')],
})

// The model is allowed to leave nothing in progress; the bar has to say so.
const TODO_NO_CURRENT = JSON.stringify({
  title: '梳理待办',
  todos: [todoStep('收集需求', '正在收集需求', 'completed'), todoStep('排优先级', '正在排优先级', 'pending')],
})

const PLAN_MD = [
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

const PLAN_ARGS = JSON.stringify({ plan: PLAN_MD })

export default function Playground() {
  // Sub-views get their own hash rather than a section in the gallery: the
  // scroll harness needs the full viewport height, which a page that scrolls as
  // a whole cannot give it.
  if (window.location.hash === '#playground/scroll') return <ScrollLab />
  if (window.location.hash === '#playground/heroui') return <HeroUiLab />
  if (window.location.hash === '#playground/schema') return <SchemaLab />
  // One route, two sides: the harness and the frame it drives are the same
  // document loaded twice, told apart by a query parameter rather than a second
  // hash — the checks above are `===`, and a frame carrying its own hash suffix
  // would have to loosen all of them.
  if (window.location.hash === '#playground/responsive') {
    const isFrame = new URLSearchParams(window.location.search).has('responsiveCase')
    return isFrame ? <ResponsiveFrame /> : <ResponsiveLab />
  }
  return <Gallery />
}

function Gallery() {
  // Through `setTheme` rather than toggling the class directly: the hook keeps
  // its own record of what it wrote, and a class it did not write is a class it
  // will not remove.
  const { resolvedTheme, setTheme } = useAppTheme()
  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-2xl space-y-10 px-6 py-10">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">组件预览</h1>
          <Tooltip delay={0}>
            <Button
              isIconOnly
              aria-label="切换主题"
              variant="outline"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="hidden size-4 dark:block" />
              <Moon className="size-4 dark:hidden" />
            </Button>
            <Tooltip.Content placement="top">切换主题</Tooltip.Content>
          </Tooltip>
        </header>

        <Section title="ChainOfThought / 基础 + Steps">
          <ChainOfThought defaultExpanded>
            <ChainOfThoughtTrigger>Thought for 4 seconds</ChainOfThoughtTrigger>
            <ChainOfThoughtContent>
              <ChainOfThoughtSteps>
                <ChainOfThoughtStep label="Search">
                  Looked up HeroUI Pro chat template patterns for message layout and composer spacing.
                </ChainOfThoughtStep>
                <ChainOfThoughtStep label="Plan">
                  Mapped the template structure to SDK-agnostic compound components.
                </ChainOfThoughtStep>
              </ChainOfThoughtSteps>
            </ChainOfThoughtContent>
          </ChainOfThought>
        </Section>

        <Section title="ChainOfThought / 流式 (shimmer)">
          <ChainOfThought defaultExpanded isStreaming>
            <ChainOfThoughtTrigger>思考过程</ChainOfThoughtTrigger>
            <ChainOfThoughtContent className="text-xs text-muted leading-relaxed whitespace-pre-wrap">
              {'用户想要一个简单的登录页。这是一个直接的 UI 任务——我应该先生成一些设计灵感确保观感，然后再搭页面。'}
            </ChainOfThoughtContent>
          </ChainOfThought>
        </Section>

        <Section title="ChatTool / 预设五态">
          <div className="space-y-3">
            <ChatTool state="output-available" defaultExpanded>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted">Used tool:</span>
                <span className="font-medium text-foreground">getWeather</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs value={{ city: 'Paris' }} />
                <ChatToolResult value={{ summary: '18°C, partly cloudy' }} />
              </ChatToolContent>
            </ChatTool>

            <ChatTool state="input-streaming" defaultExpanded>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted">Running tool:</span>
                <span className="font-medium text-foreground">searchDocs</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs text='{"query":"HeroUI Pro' />
              </ChatToolContent>
            </ChatTool>

            <ChatTool state="output-error" defaultExpanded>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted">Failed tool:</span>
                <span className="font-medium text-foreground">fetchPage</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs value={{ url: 'https://example.com' }} />
                <ChatToolError>Request timed out after 30s</ChatToolError>
              </ChatToolContent>
            </ChatTool>

            <ChatTool state="requires-action" defaultExpanded>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted">Approval needed:</span>
                <span className="font-medium text-foreground">sendEmail</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs value={{ to: 'team@acme.com', subject: 'Launch update' }} />
                <ChatToolApproval>
                  <Button variant="outline">Reject</Button>
                  <Button>Approve</Button>
                </ChatToolApproval>
              </ChatToolContent>
            </ChatTool>
          </div>
        </Section>

        <Section title="ToolCallBlock / 业务状态">
          <div>
            <ToolCallBlock
              data={tool({
                tool_name: 'read_file',
                status: 'completed',
                arguments: JSON.stringify({ path: 'C:/Users/dev/project/vite.config.ts' }),
                result: READ_RESULT,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'search_files',
                status: 'completed',
                arguments: JSON.stringify({ pattern: 'approveToolCall' }),
                result: SEARCH_RESULT,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'run_command',
                status: 'completed',
                arguments: JSON.stringify({ command: 'cargo check' }),
                result: COMMAND_RESULT,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'save_memory',
                status: 'completed',
                arguments: JSON.stringify({ key: 'user_preference' }),
                result: JSON.stringify({ saved: true, key: 'user_preference', scope: 'global' }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'write_file',
                status: 'running',
                arguments: JSON.stringify({ path: 'src/lib/format.ts', content: WRITE_FILE_CONTENT }),
              })}
            />
            {/* The pair worth looking at together: the transcript calls both of
                these running, and only the first one is. Everything a reply asks
                for is written down before any of it runs, so the difference has
                to come from position. */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_command',
                status: 'running',
                arguments: JSON.stringify({ command: 'cargo test --lib' }),
              })}
            />
            <ToolCallBlock
              queued
              data={tool({
                tool_name: 'run_command',
                status: 'running',
                arguments: JSON.stringify({ command: 'pnpm vitest run' }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'edit_file',
                status: 'pending',
                arguments: JSON.stringify({
                  file_path: 'src/main.tsx',
                  old_string: 'createRoot(root).render(\n  <App />,\n)',
                  new_string: 'createRoot(root).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)',
                }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'apply_patch',
                status: 'pending',
                arguments: JSON.stringify({ base_path: '.', patch: CODEX_PATCH }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'apply_patch',
                status: 'completed',
                arguments: JSON.stringify({ patch: UNIFIED_PATCH }),
                result: 'Applied patch: 1 updated — src/lib.rs',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'run_command',
                status: 'pending',
                call_id: 'pg-escalation',
                retry_reason: 'sandbox denied',
                arguments: JSON.stringify({ command: 'netsh advfirewall show allprofiles' }),
              })}
            />
            {/* Asked for, never answered: the turn died while it was on screen. */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_command',
                status: 'orphaned',
                arguments: JSON.stringify({ command: 'git push --force' }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'delete_file',
                status: 'error',
                arguments: JSON.stringify({ path: 'C:/locked/file.db' }),
                result: 'Permission denied: the file is locked by another process (os error 32)',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'read_file',
                status: 'denied',
                arguments: JSON.stringify({ path: 'C:/Users/dev/.ssh/id_ed25519' }),
              })}
            />
          </div>
        </Section>

        <Section title="ToolCallBlock / run_agent">
          <div>
            {/* 跑着，还没派出去——事件到达之前卡片上没有会话可以点进去。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_agent',
                status: 'running',
                arguments: RUN_AGENT_ARGS,
              })}
            />
            {/* 跑着，已经有会话和步数。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_agent',
                status: 'running',
                call_id: 'pg-run-agent-live',
                arguments: RUN_AGENT_ARGS,
                sub_agent: { conversation_id: 'pg-sub-1', turn_id: 'pg-run-1', kind: 'agent', steps: 4 },
              })}
            />
            {/* 它要权限。问题画在这里，因为没人在看它自己那条会话。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_agent',
                status: 'running',
                call_id: 'pg-run-agent-asking',
                arguments: RUN_AGENT_ARGS,
                sub_agent: { conversation_id: 'pg-sub-1', turn_id: 'pg-run-2', kind: 'agent', steps: 2 },
                nested_approval: {
                  approval_id: 'pg-nested',
                  call_id: 'pg-child-call',
                  tool_name: 'run_command',
                  arguments: JSON.stringify({ command: 'cargo test --all' }),
                  sub_conversation_id: 'pg-sub-1',
                },
              })}
            />
            {/* 只读的那一种。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_agent',
                status: 'completed',
                call_id: 'pg-run-agent-explore',
                arguments: JSON.stringify({
                  agent: 'explore',
                  description: '找出 SSE 解析在哪一层',
                  prompt: '在 src-tauri/src/provider 下找到 SSE 事件变成 ChatChunk 的位置，报告文件与行号。',
                }),
                sub_agent: { conversation_id: 'pg-sub-2', turn_id: 'pg-run-3', kind: 'explore', steps: 3 },
                result: 'openai_compat.rs:187 起，eventsource-stream 的 Event 在这里变成 ChatChunk。',
              })}
            />
            {/* 派出去了，然后进程没了。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_agent',
                status: 'orphaned',
                call_id: 'pg-run-agent-dead',
                arguments: RUN_AGENT_ARGS,
                sub_agent: { conversation_id: 'pg-sub-3', turn_id: 'pg-run-4', kind: 'agent', steps: 1 },
              })}
            />
            {/* 子会话里看同一次调用：确实在等人，但不是等看这条 transcript 的人。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'run_command',
                status: 'awaiting_parent',
                arguments: JSON.stringify({ command: 'cargo test --all' }),
              })}
            />
          </div>
        </Section>

        <Section title="ToolCallBlock / ask_user 与 web_search">
          <div>
            <ToolCallBlock
              data={tool({
                tool_name: 'ask_user',
                status: 'pending',
                arguments: ASK_USER_ARGS,
              })}
            />
            {/* 问题留在屏幕上，表单没了——发不出去了，取而代之的是它的下场。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'ask_user',
                status: 'orphaned',
                arguments: ASK_USER_ARGS,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'ask_user',
                status: 'error',
                arguments: ASK_USER_ARGS,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'web_search',
                status: 'pending',
                arguments: JSON.stringify({ query: 'HeroUI Pro chain of thought' }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'web_search',
                status: 'completed',
                arguments: JSON.stringify({ query: 'HeroUI Pro chain of thought' }),
                result: WEB_SEARCH_RESULT,
              })}
            />
          </div>
        </Section>

        <Section title="ToolCallBlock / todo 清单">
          <div>
            <ToolCallBlock
              data={tool({
                tool_name: 'update_todos',
                status: 'completed',
                arguments: TODO_RUNNING,
                result: 'Checklist "重构鉴权模块" updated (1/4 done). Now: 替换调用方',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'update_todos',
                status: 'completed',
                arguments: TODO_DONE,
                result: 'Checklist "修复 CI 失败" finished (2/2). The next update starts a new one.',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'update_todos',
                status: 'completed',
                arguments: TODO_SINGLE,
              })}
            />
            {/* Mid-stream the arguments are still partial JSON, so it falls back to a plain card. */}
            <ToolCallBlock
              data={tool({
                tool_name: 'update_todos',
                status: 'running',
                arguments: '{"title":"重构鉴权模块","todos":[{"content":"抽离 token',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'update_todos',
                status: 'error',
                arguments: JSON.stringify({
                  title: '重构鉴权模块',
                  todos: [
                    todoStep('抽离 token 校验', '正在抽离 token 校验', 'in_progress'),
                    todoStep('替换调用方', '正在替换调用方', 'in_progress'),
                  ],
                }),
                result:
                  'Only one step may be in_progress at a time, but 2 are: 抽离 token 校验, 替换调用方. Mark the others pending or completed.',
              })}
            />
          </div>
        </Section>

        <Section title="ToolCallBlock / 计划模式">
          <div>
            <ToolCallBlock
              data={tool({
                tool_name: 'enter_plan',
                status: 'pending',
                arguments: JSON.stringify({
                  reason: '鉴权改动牵涉三个模块，先确认走 middleware 还是 handler 内联更省事。',
                }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'enter_plan',
                status: 'denied',
                arguments: JSON.stringify({ reason: '这个改动可能有多种做法。' }),
                result: 'The user would rather not plan first…',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'exit_plan',
                status: 'pending',
                arguments: PLAN_ARGS,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'exit_plan',
                status: 'completed',
                arguments: PLAN_ARGS,
                result: 'The user approved the plan. You are out of plan mode…',
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'exit_plan',
                status: 'denied',
                arguments: PLAN_ARGS,
                result: 'The user sent the plan back: 先别动 handler.rs，只加测试。',
              })}
            />
            {/* 重载后才见得到的那几种：tool_outcome 落库以后，拒绝和失败不再
                退化成绿勾；未答复但 turn 仍在跑的调用也不再被写成"已失效"。
                在这之前它们都只会渲染出一个空壳。 */}
            <ToolCallBlock
              data={tool({
                tool_name: 'exit_plan',
                status: 'error',
                arguments: PLAN_ARGS,
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'enter_plan',
                status: 'running',
                arguments: JSON.stringify({ reason: '还在等这次调用跑完。' }),
              })}
            />
            <ToolCallBlock
              data={tool({
                tool_name: 'enter_plan',
                status: 'orphaned',
                arguments: JSON.stringify({ reason: '问这个的那一轮已经没了。' }),
              })}
            />
          </div>
        </Section>

        <Section title="ComposerMenu / 输入框选项菜单">
          <div className="flex flex-wrap items-center gap-4">
            <ComposerMenuCase label="默认" mode="work" acceptEdits={false} />
            <ComposerMenuCase label="改动免批（触发器带警示点）" mode="work" acceptEdits />
            <ComposerMenuCase label="谋定模式（不提供免批项）" mode="plan" acceptEdits={false} />
          </div>
        </Section>

        <Section title="TurnItem / 一整个回合的排版">
          <div className="space-y-3">
            <TurnItemCase
              label="有中间过程 · 头像与署名在回合顶部"
              blocks={[
                { type: 'thinking', text: '先确认改动范围，再决定从哪个文件读起。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'read_file',
                    status: 'completed',
                    call_id: 'pg-turnitem-read',
                    arguments: '{"path":"docs/approval.md"}',
                    result: '## 审批矩阵',
                  }),
                },
                { type: 'text', text: ANSWER_MD },
              ]}
            />
            <TurnItemCase label="纯问答 · 头像与署名在结论行" blocks={[{ type: 'text', text: ANSWER }]} />
            <TurnItemCase
              label="低风险调用折成 badge · 命令 / 文件 / 搜索，时间在同一行右端；写入仍是键"
              rows={[
                {
                  blocks: [
                    { type: 'text', text: '先把相关的几处都看一遍，再决定怎么改。' },
                    ...['src/lib/turns.ts', 'src/lib/message-groups.ts', 'src/lib/turns.ts'].map(
                      (path, i): ContentBlock => ({
                        type: 'tool_call',
                        data: tool({
                          tool_name: 'read_file',
                          status: 'completed',
                          call_id: `pg-fold-read-${i}`,
                          arguments: JSON.stringify({ path }),
                          result: READ_RESULT,
                        }),
                      }),
                    ),
                    {
                      type: 'tool_call',
                      data: tool({
                        tool_name: 'search_files',
                        status: 'completed',
                        call_id: 'pg-fold-search',
                        arguments: '{"pattern":"markQueued"}',
                        result: SEARCH_RESULT,
                      }),
                    },
                  ],
                },
                {
                  blocks: ['pnpm typecheck', 'pnpm test src/lib/turns.test.ts'].map((command, i): ContentBlock => ({
                    type: 'tool_call',
                    data: tool({
                      tool_name: 'run_command',
                      status: 'completed',
                      call_id: `pg-fold-cmd-${i}`,
                      arguments: JSON.stringify({ command }),
                      result: COMMAND_RESULT,
                    }),
                  })),
                },
                {
                  blocks: [
                    { type: 'text', text: '看完了。两处都改成按块找结论，写入如下：' },
                    {
                      type: 'tool_call',
                      data: tool({
                        tool_name: 'write_file',
                        status: 'completed',
                        call_id: 'pg-fold-write',
                        arguments: '{"path":"src/lib/turns.ts","content":"// …"}',
                        result: 'ok',
                      }),
                    },
                  ],
                },
                {
                  blocks: [
                    ...['a.rs', 'b.rs'].map((path, i): ContentBlock => ({
                      type: 'tool_call',
                      data: tool({
                        tool_name: 'read_file',
                        status: 'completed',
                        call_id: `pg-fold-after-${i}`,
                        arguments: JSON.stringify({ path }),
                        result: READ_RESULT,
                      }),
                    })),
                  ],
                },
                { blocks: [{ type: 'text', text: '改好了，测试通过。' }] },
              ]}
            />
            <TurnItemCase
              label="工具已返回、模型还没开口 · 下一条气泡带 spinner，正文里不再闪光标"
              streaming
              blocks={[
                { type: 'text', text: '我先看看项目里有什么。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'run_command',
                    status: 'completed',
                    call_id: 'pg-waiting-ls',
                    arguments: '{"command":"ls"}',
                    result: 'main.py',
                  }),
                },
              ]}
            />
            <TurnItemCase
              label="待审批 · 引出它的那句话留在它上方"
              blocks={[
                { type: 'text', text: '我先看看项目里有什么。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'run_command',
                    status: 'completed',
                    call_id: 'pg-approval-ls',
                    arguments: '{"command":"ls"}',
                    result: 'main.py',
                  }),
                },
                { type: 'text', text: '看下 main.py。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'run_command',
                    status: 'pending',
                    call_id: 'pg-approval-cat',
                    arguments: '{"command":"Get-Content main.py"}',
                  }),
                },
              ]}
            />
          </div>
        </Section>

        <Section title="TurnItem / 状态与形态">
          <div className="space-y-3">
            <TurnItemCase
              label="多轮 · 同一模型的连续回答合成一组，头像贴底"
              rows={[
                {
                  blocks: [
                    { type: 'text', text: '我先看一下现有实现。' },
                    {
                      type: 'tool_call',
                      data: tool({
                        tool_name: 'read_file',
                        status: 'completed',
                        call_id: 'pg-g1',
                        arguments: '{"path":"src/lib/turns.ts"}',
                        result: 'export function buildTurns(...)',
                      }),
                    },
                  ],
                },
                {
                  blocks: [
                    { type: 'text', text: '分组逻辑没问题，接着跑一遍测试。' },
                    {
                      type: 'tool_call',
                      data: tool({
                        tool_name: 'run_command',
                        status: 'completed',
                        call_id: 'pg-g2',
                        arguments: '{"command":"pnpm test"}',
                        result: '89 passed',
                      }),
                    },
                  ],
                },
                { blocks: [{ type: 'text', text: ANSWER }] },
              ]}
            />
            <TurnItemCase
              label="换了模型 · 断成两组，各自一个头像"
              rows={[
                { modelId: 'gpt-4.1-mini', blocks: [{ type: 'text', text: '这个问题我答不好，换个模型。' }] },
                { modelId: 'claude-sonnet-5', blocks: [{ type: 'text', text: ANSWER }] },
              ]}
            />
            <TurnItemCase
              label="只有工具没有话 · 裸键盘"
              blocks={[
                { type: 'thinking', text: '先确认改动范围，再决定从哪个文件读起。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'read_file',
                    status: 'completed',
                    call_id: 'pg-bare',
                    arguments: '{"path":"docs/approval.md"}',
                    result: '## 审批矩阵',
                  }),
                },
              ]}
            />
            <TurnItemCase
              label="ask_user · 表单在面板里"
              blocks={[
                { type: 'text', text: '有两个方向，你选一个。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'ask_user',
                    status: 'pending',
                    call_id: 'pg-ask',
                    approval_id: 'pg-ask-appr',
                    arguments: JSON.stringify({
                      questions: [
                        { id: 'q1', question: '先做哪一个？', options: [{ label: '气泡' }, { label: '键盘' }] },
                      ],
                    }),
                  }),
                },
              ]}
            />
            <TurnItemCase
              label="思考中 · 键盘上唯一的活动迹象"
              streaming
              blocks={[{ type: 'thinking', text: '用户想要 Telegram 那种样子……' }]}
            />
            <TurnItemCase
              label="crashed · 尾部有文字也不算完成"
              crashed
              blocks={[
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'edit_file',
                    status: 'completed',
                    call_id: 'pg-crash',
                    arguments: '{"path":"src/a.ts","old_string":"a","new_string":"b"}',
                  }),
                },
                { type: 'text', text: '改完了，文件已更新。' },
              ]}
            />
            <TurnItemCase
              label="interrupted · 停在工具调用上"
              blocks={[
                { type: 'text', text: '我先跑一下。' },
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'run_command',
                    status: 'completed',
                    call_id: 'pg-int',
                    arguments: '{"command":"pnpm test"}',
                    result: '1 failed',
                  }),
                },
              ]}
            />
            <TurnItemCase
              label="OneBot · 一条回复切成多个气泡"
              oneBot
              blocks={[{ type: 'text', text: '收到。\n---\n我看看。\n---\n这个可以改，稍等。' }]}
            />
            <TurnItemCase
              label="贴纸 · 不进气泡"
              blocks={[
                {
                  type: 'tool_call',
                  data: tool({
                    tool_name: 'send_sticker',
                    status: 'completed',
                    call_id: 'pg-stk',
                    arguments: '{"name":"wave"}',
                  }),
                },
                { type: 'sticker', sticker_id: 'pg-wave', name: 'wave' },
              ]}
            />
            <TurnItemCase
              label="换日 · 上方画日期分隔"
              previousTurnEndedAt={null}
              blocks={[{ type: 'text', text: ANSWER }]}
            />
            <TurnItemCase label="托管会话 · 组头不写模型 id" hosted blocks={[{ type: 'text', text: ANSWER }]} />
          </div>
        </Section>

        <Section title="TodoBar / 常驻进度条">
          <div className="space-y-2 -mx-4">
            <TodoBarView todos={JSON.parse(TODO_RUNNING)} />
            <TodoBarView todos={JSON.parse(TODO_SINGLE)} />
            <TodoBarView todos={JSON.parse(TODO_NO_CURRENT)} />
          </div>
        </Section>

        <Section title="PromptQueue / 插队与做完再说">
          {/* The queue is a child of PromptInput, which is the composer's
              card. Two modes in one list: a follow-up is a sibling of the
              current run, an interjection hangs off it with ↳. */}
          <Composer
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            streaming
            steerable
            placeholder="排队接下来要做的事…"
            ariaLabel="queue probe"
            queue={
              <PromptQueue
                currentTodos={JSON.parse(TODO_RUNNING)}
                streaming
                held={false}
                items={[
                  queued('later', 'follow_up', '做完再说：补一条测试'),
                  queued('now', 'interject', '插队：先停在这一步'),
                ]}
                onRemove={() => {}}
                onReorder={() => {}}
                onSetDelivery={() => {}}
                onRelease={() => {}}
              />
            }
          />
        </Section>

        <Section title="TodoBoard / 三列看板">
          {/* Rendered directly as well as through the bar's own toggle: the
              cases worth looking at are an empty column and a card long enough
              to wrap, and both are two clicks deep otherwise. Boxed at 672px —
              the composer's width — because that is what decides whether three
              columns fit or the grid turns into a horizontal scroller. */}
          <div className="w-full max-w-2xl rounded-2xl bg-surface p-4 shadow-surface">
            <TodoBoard todos={(JSON.parse(TODO_RUNNING) as { todos: TodoDraft[] }).todos} />
          </div>
          <div className="w-[360px] rounded-2xl bg-surface p-4 shadow-surface">
            <TodoBoard todos={(JSON.parse(TODO_NO_CURRENT) as { todos: TodoDraft[] }).todos} />
          </div>
        </Section>

        <Section title="VoiceButton / 语音输入按钮">
          <div className="flex flex-wrap items-center gap-6">
            {(['idle', 'recording-hold', 'recording-toggle', 'transcribing'] as VoiceButtonState[]).map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <VoiceButton aria-label="语音输入" state={s} elapsed={s.startsWith('recording') ? 12.4 : 0} />
                <span className="text-xs text-muted">{s}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="ChangesPanel / 改动文件树">
          {/* The three cases the tree has to get right: a collapsed run of
              single-child directories, a branch where collapsing must stop,
              and all three verbs side by side. Boxed at the panel's own
              minimum width, which is where a long path decides whether it
              truncates or pushes the marker off the edge. */}
          <div className="h-96 w-[280px] rounded-2xl border border-border bg-surface">
            <ChangesPanelView files={CHANGED_FILES} onClose={() => {}} />
          </div>
          <div className="h-48 w-[280px] rounded-2xl border border-border bg-surface">
            <ChangesPanelView files={[]} onClose={() => {}} />
          </div>
        </Section>

        <Section title="快捷键 / 命令面板">
          {/* Two things this is here to answer, neither of which a unit test
              can: whether the WebView hands us Ctrl+K at all (Edge binds it to
              the address bar, and WebView2 has been known to keep bindings the
              app never asked for), and whether the palette still opens while a
              text field has focus. Run this one under `pnpm tauri dev`, not in
              a browser — the browser is not the environment in question. */}
          <HotkeyProbe />
        </Section>

        {/* The conversation list and the mobile app bar used to be probed here.
            Both are gone: the list is `Sidebar.Mobile` now, which is the same
            tree the panel renders, so narrowing the window is the probe. */}
      </div>
    </div>
  )
}

function HotkeyProbe() {
  const [log, setLog] = useState<string[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [chosen, setChosen] = useState('（还没有选过）')

  const note = (what: string) => setLog((prev) => [what, ...prev].slice(0, 6))

  useHotkey(
    'mod+k',
    () => {
      note('mod+k')
      setPaletteOpen(true)
    },
    { ignoreInInput: false },
  )
  useHotkey('mod+shift+k', () => note('mod+shift+k'))
  useHotkey('escape', () => note('escape'))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setPaletteOpen(true)}>
          打开面板
        </Button>
        <Input
          type="text"
          aria-label="焦点测试用输入框"
          placeholder="在这里打字，再按 mod+k / mod+shift+k"
          className="min-w-64 flex-1"
        />
      </div>
      <p className="text-xs text-muted">
        预期：<code>mod+k</code> 在输入框里也触发，<code>mod+shift+k</code> 不触发（<code>ignoreInInput</code>{' '}
        默认开）， 且 <code>mod+shift+k</code> 不会连带触发 <code>mod+k</code>。
      </p>
      <div className="rounded-lg border border-border bg-surface p-3 text-xs">
        <div className="text-muted">最近命中：{log.length ? log.join(' · ') : '（无）'}</div>
        <div className="mt-1">面板选中：{chosen}</div>
      </div>

      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        conversations={PALETTE_ROWS}
        projects={PALETTE_PROJECTS}
        onSelectConversation={(id) => setChosen(`会话 ${id}`)}
        onSelectProject={(id) => setChosen(`项目 ${id ?? '全部'}`)}
        onOpenSettingsTab={(tab) => setChosen(`设置 ${tab}`)}
        onCreate={() => setChosen('新建对话')}
      />
    </div>
  )
}

const CHANGED_FILES: TouchedFile[] = [
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

const PALETTE_ROWS: ConversationInfoResponse[] = [
  paletteRow('a', '英语学习入门指南'),
  paletteRow('b', null),
  paletteRow('c', '重构 tauri 命令注册表并把所有工具调用迁移到新的审批模型上'),
  paletteRow('d', '已归档的会话', { is_archived: true }),
]

const PALETTE_PROJECTS: ProjectInfoResponse[] = [
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
