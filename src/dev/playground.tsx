// Dev-only component playground. Reachable at #playground from a plain browser
// (vite dev without the Tauri backend); never included in production builds.
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
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import type { ToolCallDisplay } from '@/types'

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
      </div>
    </div>
  )
}
