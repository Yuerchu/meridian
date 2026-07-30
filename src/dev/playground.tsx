// Dev-only component playground. Reachable at #playground from a plain browser
// (vite dev without the Tauri backend); never included in production builds.
import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtSteps,
  ChainOfThoughtTrigger,
} from '@/components/ui/chain-of-thought'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolArgs,
  ChatToolContent,
  ChatToolError,
  ChatToolGroup,
  ChatToolGroupContent,
  ChatToolGroupTrigger,
  ChatToolResult,
  ChatToolStatusIcon,
  ChatToolTrigger,
} from '@/components/ui/chat-tool'
import {
  Turn,
  TurnActions,
  TurnBranchPager,
  TurnContent,
  TurnFooter,
  TurnPinned,
  TurnResult,
  TurnStatusIcon,
  TurnTrigger,
  type TurnStatus,
} from '@/components/ui/turn'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import { TurnSteps } from '@/components/chat/turn-steps'
import { TodoBarView } from '@/components/chat/todo-bar'
import { FastToggle, ModeSelector, ThinkingSelector } from '@/components/chat/toolbar'
import { VoiceButton, type VoiceButtonState } from '@/components/ui/voice-button'
import { formatDuration, type TurnStep } from '@/lib/turns'
import type { ChatMode, ProviderCapabilities, ThinkingEffort, ThinkingLevel, ToolCallDisplay } from '@/types'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function tool(over: Partial<ToolCallDisplay> & Pick<ToolCallDisplay, 'tool_name' | 'status'>): ToolCallDisplay {
  return {
    call_id: `pg-${over.tool_name}-${over.status}`,
    arguments: '{}',
    ...over,
  }
}

function caps(over: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    supports_tools: true,
    supports_streaming_tools: true,
    supports_thinking: true,
    supports_images: true,
    max_context_tokens: 272_000,
    max_output_tokens: 128_000,
    supported_efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    default_effort: 'medium',
    supports_fast: false,
    ...over,
  }
}

function step(over: Partial<TurnStep> & Pick<TurnStep, 'kind'>): TurnStep {
  const base = { messageId: 'pg', blockIndex: 0 }
  if (over.kind === 'tool') {
    return { data: tool({ tool_name: 'read_file', status: 'completed' }), ...base, ...over } as TurnStep
  }
  return { text: '', ...base, ...over } as TurnStep
}

const DEMO_STEPS: TurnStep[] = [
  step({ kind: 'thinking', text: '先确认改动范围，再决定从哪个文件读起。' }),
  step({ kind: 'text', text: '我先看一下现有实现。' }),
  step({ kind: 'tool', data: tool({ tool_name: 'read_file', status: 'completed', arguments: '{"path":"src/lib/turns.ts"}', result: 'export function buildTurns(...)' }) }),
  step({ kind: 'text', text: '分组逻辑没问题，接着跑一遍测试。' }),
  step({ kind: 'tool', data: tool({ tool_name: 'run_command', status: 'completed', arguments: '{"command":"pnpm test"}', result: '89 passed' }) }),
]

const MANY_STEPS: TurnStep[] = Array.from({ length: 40 }, (_, i) =>
  step({ kind: 'tool', data: tool({ tool_name: 'read_file', status: 'completed', call_id: `pg-many-${i}`, arguments: `{"path":"src/file-${i}.ts"}` }) }),
)

/**
 * A turn collapse with local open state, so the header, the panel transition
 * and the footer can be exercised together.
 */
function TurnCase({
  label,
  status,
  steps = DEMO_STEPS,
  durationMs = 586_000,
  result = '改完了：分组层落在 `src/lib/turns.ts`，测试 89 项全过。',
  pinned,
  branch,
  defaultOpen = false,
}: {
  label: string
  status: TurnStatus
  steps?: TurnStep[]
  durationMs?: number | null
  result?: string | null
  pinned?: TurnStep[]
  branch?: { index: number; total: number }
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [index, setIndex] = useState(branch?.index ?? 1)
  const headline = status === 'streaming'
    ? '处理中…'
    : status === 'interrupted'
      ? '已中断'
      : status === 'awaiting-input'
        ? '等待你的响应'
        : durationMs != null
          ? `已处理 ${formatDuration(durationMs)}`
          : `${steps.length} 个步骤`

  return (
    <div className="group/turn w-full max-w-2xl space-y-1 rounded-xl border border-dashed border-border/60 p-4">
      <div className="text-xs text-muted-foreground/60">{label}</div>
      <Turn status={status} open={open} onOpenChange={setOpen}>
        <TurnTrigger>
          <span className="inline-flex items-center gap-1.5">
            <TurnStatusIcon />
            {headline}
          </span>
        </TurnTrigger>
        <TurnContent>
          <TurnSteps steps={steps} />
        </TurnContent>
        {pinned && pinned.length > 0 && (
          <TurnPinned>
            <TurnSteps steps={pinned} />
          </TurnPinned>
        )}
        {result && (
          <TurnResult>
            <p className="text-sm">{result}</p>
          </TurnResult>
        )}
        <TurnFooter>
          {branch && (
            <TurnBranchPager
              index={index}
              total={branch.total}
              onPrevious={() => setIndex((v) => Math.max(1, v - 1))}
              onNext={() => setIndex((v) => Math.min(branch.total, v + 1))}
              previousLabel="上一个版本"
              nextLabel="下一个版本"
            />
          )}
          <span className="text-muted-foreground/50">1,204 + 318 tokens</span>
          <TurnActions>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">复制</Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">重新生成</Button>
          </TurnActions>
        </TurnFooter>
      </Turn>
    </div>
  )
}

/**
 * Drives a ThinkingSelector with local state so the whitelist coercion is
 * observable: pick a tier, then compare against a narrower capability shape.
 */
function ModeCase({ label, initial }: { label: string; initial: ChatMode }) {
  const [mode, setMode] = useState<ChatMode>(initial)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center rounded-lg border border-border px-2 py-1">
        <ModeSelector current={mode} onSelect={setMode} />
      </div>
      <span className="text-xs text-muted-foreground/60">{mode}</span>
    </div>
  )
}

function ThinkingCase({ label, capabilities }: { label: string; capabilities: ProviderCapabilities | null }) {
  const [level, setLevel] = useState<ThinkingLevel>('default')
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center rounded-lg border border-border px-2 py-1">
        <ThinkingSelector current={level} onSelect={setLevel} capabilities={capabilities} />
      </div>
      <span className="text-xs text-muted-foreground/60">{level}</span>
    </div>
  )
}

function FastCase({ label, initial }: { label: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center rounded-lg border border-border px-2 py-1">
        <FastToggle active={on} onToggle={setOn} />
      </div>
    </div>
  )
}

const GPT_5_2_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh']

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
    { title: 'Base UI Collapsible', url: 'https://base-ui.com/react/components/collapsible', content: '', site_name: 'Base UI' },
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

const todoStep = (content: string, activeForm: string, status: string) => ({
  content,
  active_form: activeForm,
  status,
})

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
  todos: [
    todoStep('定位失败用例', '正在定位失败用例', 'completed'),
    todoStep('修掉断言', '正在修断言', 'completed'),
  ],
})

const TODO_SINGLE = JSON.stringify({
  title: '升级依赖',
  todos: [todoStep('跑 pnpm update', '正在跑 pnpm update', 'in_progress')],
})

// The model is allowed to leave nothing in progress; the bar has to say so.
const TODO_NO_CURRENT = JSON.stringify({
  title: '梳理待办',
  todos: [
    todoStep('收集需求', '正在收集需求', 'completed'),
    todoStep('排优先级', '正在排优先级', 'pending'),
  ],
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
  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-2xl space-y-10 px-6 py-10">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">组件预览</h1>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => document.documentElement.classList.toggle('dark')}
                >
                  <Sun className="hidden size-4 dark:block" />
                  <Moon className="size-4 dark:hidden" />
                </Button>
              }
            />
            <TooltipContent side="top">切换主题</TooltipContent>
          </Tooltip>
        </header>

        <Section title="ChainOfThought / 基础 + Steps">
          <ChainOfThought defaultOpen>
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
          <ChainOfThought defaultOpen isStreaming>
            <ChainOfThoughtTrigger>思考过程</ChainOfThoughtTrigger>
            <ChainOfThoughtContent className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
              {'用户想要一个简单的登录页。这是一个直接的 UI 任务——我应该先生成一些设计灵感确保观感，然后再搭页面。'}
            </ChainOfThoughtContent>
          </ChainOfThought>
        </Section>

        <Section title="ChatTool / 预设五态">
          <div className="space-y-3">
            <ChatTool state="output-available" defaultOpen>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted-foreground">Used tool:</span>
                <span className="font-medium text-foreground">getWeather</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs value={{ city: 'Paris' }} />
                <ChatToolResult value={{ summary: '18°C, partly cloudy' }} />
              </ChatToolContent>
            </ChatTool>

            <ChatTool state="input-streaming" defaultOpen>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted-foreground">Running tool:</span>
                <span className="font-medium text-foreground">searchDocs</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs text='{"query":"HeroUI Pro' />
              </ChatToolContent>
            </ChatTool>

            <ChatTool state="output-error" defaultOpen>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted-foreground">Failed tool:</span>
                <span className="font-medium text-foreground">fetchPage</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs value={{ url: 'https://example.com' }} />
                <ChatToolError>Request timed out after 30s</ChatToolError>
              </ChatToolContent>
            </ChatTool>

            <ChatTool state="requires-action" defaultOpen>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                <span className="text-muted-foreground">Approval needed:</span>
                <span className="font-medium text-foreground">sendEmail</span>
              </ChatToolTrigger>
              <ChatToolContent>
                <ChatToolArgs value={{ to: 'team@acme.com', subject: 'Launch update' }} />
                <ChatToolApproval>
                  <Button variant="outline">Reject</Button>
                  <Button variant="default">Approve</Button>
                </ChatToolApproval>
              </ChatToolContent>
            </ChatTool>

            <ChatToolGroup defaultOpen>
              <ChatToolGroupTrigger>2 tool calls</ChatToolGroupTrigger>
              <ChatToolGroupContent>
                <ChatTool state="output-available">
                  <ChatToolTrigger>
                    <ChatToolStatusIcon />
                    <span className="text-muted-foreground">Used tool:</span>
                    <span className="font-medium text-foreground">searchDocs</span>
                  </ChatToolTrigger>
                  <ChatToolContent>
                    <ChatToolResult value={{ matches: 3 }} />
                  </ChatToolContent>
                </ChatTool>
                <ChatTool state="output-available">
                  <ChatToolTrigger>
                    <ChatToolStatusIcon />
                    <span className="text-muted-foreground">Used tool:</span>
                    <span className="font-medium text-foreground">fetchPage</span>
                  </ChatToolTrigger>
                  <ChatToolContent>
                    <ChatToolResult value={{ status: 200 }} />
                  </ChatToolContent>
                </ChatTool>
              </ChatToolGroupContent>
            </ChatToolGroup>
          </div>
        </Section>

        <Section title="ToolCallBlock / 业务状态">
          <div>
            <ToolCallBlock data={tool({
              tool_name: 'read_file',
              status: 'completed',
              arguments: JSON.stringify({ path: 'C:/Users/dev/project/vite.config.ts' }),
              result: READ_RESULT,
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'search_files',
              status: 'completed',
              arguments: JSON.stringify({ pattern: 'approveToolCall' }),
              result: SEARCH_RESULT,
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'run_command',
              status: 'completed',
              arguments: JSON.stringify({ command: 'cargo check' }),
              result: COMMAND_RESULT,
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'save_memory',
              status: 'completed',
              arguments: JSON.stringify({ key: 'user_preference' }),
              result: JSON.stringify({ saved: true, key: 'user_preference', scope: 'global' }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'write_file',
              status: 'running',
              arguments: JSON.stringify({ path: 'src/lib/format.ts', content: WRITE_FILE_CONTENT }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'edit_file',
              status: 'pending',
              arguments: JSON.stringify({
                file_path: 'src/main.tsx',
                old_string: 'createRoot(root).render(\n  <App />,\n)',
                new_string: 'createRoot(root).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)',
              }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'apply_patch',
              status: 'pending',
              arguments: JSON.stringify({ base_path: '.', patch: CODEX_PATCH }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'apply_patch',
              status: 'completed',
              arguments: JSON.stringify({ patch: UNIFIED_PATCH }),
              result: 'Applied patch: 1 updated — src/lib.rs',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'run_command',
              status: 'pending',
              call_id: 'pg-escalation',
              escalation_call_id: 'pg-escalation:retry',
              retry_reason: 'sandbox denied',
              arguments: JSON.stringify({ command: 'netsh advfirewall show allprofiles' }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'delete_file',
              status: 'error',
              arguments: JSON.stringify({ path: 'C:/locked/file.db' }),
              result: 'Permission denied: the file is locked by another process (os error 32)',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'read_file',
              status: 'denied',
              arguments: JSON.stringify({ path: 'C:/Users/dev/.ssh/id_ed25519' }),
            })} />
          </div>
        </Section>

        <Section title="ToolCallBlock / ask_user 与 web_search">
          <div>
            <ToolCallBlock data={tool({
              tool_name: 'ask_user',
              status: 'pending',
              arguments: ASK_USER_ARGS,
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'web_search',
              status: 'pending',
              arguments: JSON.stringify({ query: 'HeroUI Pro chain of thought' }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'web_search',
              status: 'completed',
              arguments: JSON.stringify({ query: 'HeroUI Pro chain of thought' }),
              result: WEB_SEARCH_RESULT,
            })} />
          </div>
        </Section>

        <Section title="ToolCallBlock / todo 清单">
          <div>
            <ToolCallBlock data={tool({
              tool_name: 'update_todos',
              status: 'completed',
              arguments: TODO_RUNNING,
              result: 'Checklist "重构鉴权模块" updated (1/4 done). Now: 替换调用方',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'update_todos',
              status: 'completed',
              arguments: TODO_DONE,
              result: 'Checklist "修复 CI 失败" finished (2/2). The next update starts a new one.',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'update_todos',
              status: 'completed',
              arguments: TODO_SINGLE,
            })} />
            {/* Mid-stream the arguments are still partial JSON, so it falls back to a plain card. */}
            <ToolCallBlock data={tool({
              tool_name: 'update_todos',
              status: 'running',
              arguments: '{"title":"重构鉴权模块","todos":[{"content":"抽离 token',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'update_todos',
              status: 'error',
              arguments: JSON.stringify({
                title: '重构鉴权模块',
                todos: [
                  todoStep('抽离 token 校验', '正在抽离 token 校验', 'in_progress'),
                  todoStep('替换调用方', '正在替换调用方', 'in_progress'),
                ],
              }),
              result: 'Only one step may be in_progress at a time, but 2 are: 抽离 token 校验, 替换调用方. Mark the others pending or completed.',
            })} />
          </div>
        </Section>

        <Section title="ToolCallBlock / 计划模式">
          <div>
            <ToolCallBlock data={tool({
              tool_name: 'enter_plan',
              status: 'pending',
              arguments: JSON.stringify({
                reason: '鉴权改动牵涉三个模块，先确认走 middleware 还是 handler 内联更省事。',
              }),
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'enter_plan',
              status: 'denied',
              arguments: JSON.stringify({ reason: '这个改动可能有多种做法。' }),
              result: 'The user would rather not plan first…',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'exit_plan',
              status: 'pending',
              arguments: PLAN_ARGS,
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'exit_plan',
              status: 'completed',
              arguments: PLAN_ARGS,
              result: 'The user approved the plan. You are out of plan mode…',
            })} />
            <ToolCallBlock data={tool({
              tool_name: 'exit_plan',
              status: 'denied',
              arguments: PLAN_ARGS,
              result: 'The user sent the plan back: 先别动 handler.rs，只加测试。',
            })} />
          </div>
        </Section>

        <Section title="ModeSelector / 模式切换">
          <div className="flex flex-wrap items-center gap-4">
            <ModeCase label="执行模式" initial="work" />
            <ModeCase label="谋定模式" initial="plan" />
          </div>
        </Section>

        <Section title="Turn / 折叠中间过程">
          <div className="space-y-3">
            <TurnCase label="complete · 有时长" status="complete" />
            <TurnCase label="complete · 展开态" status="complete" defaultOpen />
            <TurnCase label="streaming · 处理中" status="streaming" defaultOpen />
            <TurnCase
              label="awaiting-input · 待审批块留在折叠区外"
              status="awaiting-input"
              pinned={[step({ kind: 'tool', data: tool({ tool_name: 'run_command', status: 'pending', arguments: '{"command":"rm -rf dist"}' }) })]}
              result={null}
            />
            <TurnCase label="interrupted · 无结论" status="interrupted" result={null} />
            <TurnCase label="empty · 一条文本都没有" status="empty" steps={[]} result={null} durationMs={null} />
            <TurnCase label="无时长 · 退化显示步骤数" status="complete" durationMs={null} />
            <TurnCase label="40 个步骤" status="complete" steps={MANY_STEPS} />
            <TurnCase label="分支 2/3" status="complete" branch={{ index: 2, total: 3 }} />
          </div>
        </Section>

        <Section title="TodoBar / 常驻进度条">
          <div className="space-y-2 -mx-4">
            <TodoBarView todos={JSON.parse(TODO_RUNNING)} />
            <TodoBarView todos={JSON.parse(TODO_SINGLE)} />
            <TodoBarView todos={JSON.parse(TODO_NO_CURRENT)} />
          </div>
        </Section>

        <Section title="ThinkingSelector / 档位白名单">
          <div className="flex flex-wrap gap-4">
            <ThinkingCase label="gpt-5.6-sol（全量）" capabilities={caps()} />
            <ThinkingCase label="gpt-5.2（无 minimal/max）" capabilities={caps({ supported_efforts: GPT_5_2_EFFORTS })} />
            <ThinkingCase label="claude-haiku-4-5（无 effort）" capabilities={caps({ supported_efforts: [] })} />
            <ThinkingCase label="能力未加载（乐观全量）" capabilities={null} />
          </div>
        </Section>

        <Section title="FastToggle / 疾速开关">
          <div className="flex flex-wrap gap-4">
            <FastCase label="关闭" initial={false} />
            <FastCase label="开启" initial />
          </div>
        </Section>

        <Section title="VoiceButton / 语音输入按钮">
          <div className="flex flex-wrap items-center gap-6">
            {(['idle', 'recording-hold', 'recording-toggle', 'transcribing'] as VoiceButtonState[]).map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <VoiceButton state={s} elapsed={s.startsWith('recording') ? 12.4 : 0} />
                <span className="text-xs text-muted-foreground">{s}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
