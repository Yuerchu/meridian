import { Button } from '@/components/base'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolContent,
  ChatToolError,
  ChatToolPanelBody,
  ChatToolPanelFooter,
  ChatToolPanelHeader,
  ChatToolStatusIcon,
  ChatToolTrigger,
} from '@/components/ui/chat-tool'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import { ToolFields } from '@/components/ui/tool-value'
import { parsePartialObject } from '@/lib/partial-json'
import {
  ASK_USER_ARGS,
  CODEX_PATCH,
  COMMAND_RESULT,
  READ_RESULT,
  SEARCH_RESULT,
  UNIFIED_PATCH,
  WEB_SEARCH_RESULT,
  WRITE_FILE_CONTENT,
  tool,
} from './fixtures'
import { Section } from './shell'

export default function ChatTools() {
  return (
    <>
      <Section title="ChatTool / 预设五态">
        <div data-slot="gallery-chat-tools" className="space-y-3">
          <ChatTool state="output-available" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="text-text-secondary">
                Used tool:
              </span>
              <span data-slot="chat-tool-name" className="text-caption-1-medium text-text-primary">
                getWeather
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields entries={[['city', 'Paris']]} className="px-3 py-2" />
              <ToolFields entries={[['summary', '18°C, partly cloudy']]} className="px-3 py-2" />
            </ChatToolContent>
          </ChatTool>

          <ChatTool state="input-streaming" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="text-text-secondary">
                Running tool:
              </span>
              <span data-slot="chat-tool-name" className="text-caption-1-medium text-text-primary">
                searchDocs
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields
                entries={Object.entries(parsePartialObject('{"query":"boardui') ?? {})}
                className="px-3 py-2"
              />
            </ChatToolContent>
          </ChatTool>

          {/* The fifth: asked for, not started — the clock instead of the spinner. */}
          <ChatTool state="queued">
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="text-text-secondary">
                Queued:
              </span>
              <span data-slot="chat-tool-name" className="text-caption-1-medium text-text-primary">
                runTests
              </span>
            </ChatToolTrigger>
          </ChatTool>

          <ChatTool state="output-error" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="text-text-secondary">
                Failed tool:
              </span>
              <span data-slot="chat-tool-name" className="text-caption-1-medium text-text-primary">
                fetchPage
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields entries={[['url', 'https://example.com']]} className="px-3 py-2" />
              <ChatToolError>Request timed out after 30s</ChatToolError>
            </ChatToolContent>
          </ChatTool>

          <ChatTool state="requires-action" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="text-text-secondary">
                Approval needed:
              </span>
              <span data-slot="chat-tool-name" className="text-caption-1-medium text-text-primary">
                sendEmail
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields
                entries={[
                  ['to', 'team@acme.com'],
                  ['subject', 'Launch update'],
                ]}
                className="px-3 py-2"
              />
              <ChatToolApproval>
                <Button variant="secondary">Reject</Button>
                <Button>Approve</Button>
              </ChatToolApproval>
            </ChatToolContent>
          </ChatTool>
        </div>
      </Section>
      <Section title="ChatTool / 面板三段">
        <ChatTool state="output-available" defaultExpanded>
          <ChatToolTrigger>
            <ChatToolStatusIcon />
            <span data-slot="chat-tool-name" className="text-caption-1-medium text-text-primary">
              write_file
            </span>
          </ChatToolTrigger>
          <ChatToolContent>
            <ChatToolPanelHeader title="src/lib/plan-card.ts" description="新文件 · 142 行" end="已写入" />
            <ChatToolPanelBody>
              <ToolFields entries={[['mode', 'create']]} className="px-3 py-2" />
            </ChatToolPanelBody>
            <ChatToolPanelFooter>
              <span className="text-caption-1-regular text-text-secondary">写入在项目目录内，已免批。</span>
            </ChatToolPanelFooter>
          </ChatToolContent>
        </ChatTool>
      </Section>
      <Section title="ToolCallBlock / 业务状态">
        <div data-slot="gallery-tool-states">
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
              tool_name: 'run_command',
              status: 'completed',
              call_id: 'pg-run-stderr',
              arguments: JSON.stringify({
                command:
                  'cd "C:/Users/dev/project" && "C:/Users/dev/project/.venv/Scripts/basedpyright.exe" sqlmodels/generators/ 2>&1 | grep -E "error" | head -10',
                description: 'basedpyright 检查 generator 层',
              }),
              result:
                'sqlmodels/generators/file/audio/ttapi/__init__.py:12:5 - error: "TtAPI" is not exported\n[stderr] warning: 3 files skipped\n[exit code: 1]',
            })}
          />
          <ToolCallBlock
            data={tool({
              tool_name: 'glob',
              status: 'completed',
              arguments: JSON.stringify({ pattern: 'src/lib/plan-*.ts' }),
              result:
                'src/lib/plan-markdown.ts\nsrc/lib/plan-paste.ts\nsrc/lib/plan-review-draft.ts\n\n(showing first 1000 matches)',
            })}
          />
          <ToolCallBlock
            data={tool({
              tool_name: 'list_directory',
              status: 'completed',
              arguments: JSON.stringify({ path: 'src/lib' }),
              result:
                'dir          -  __tests__\nfile    4.1 KB  paths.ts\nfile   12.8 KB  tool-output.ts\nlink      24 B  latest',
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
          {/* The same edit as a hosted Claude Code makes it: must draw the same diff. */}
          <ToolCallBlock
            data={tool({
              tool_name: 'Edit',
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
              retry: { kind: 'sandbox_denied', reason: 'sandbox denied' },
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
      <Section title="ToolCallBlock / ask_user 与 web_search">
        <div data-slot="gallery-tool-asks">
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
              arguments: JSON.stringify({ query: 'boardui chain of thought' }),
            })}
          />
          <ToolCallBlock
            data={tool({
              tool_name: 'web_search',
              status: 'completed',
              arguments: JSON.stringify({ query: 'boardui chain of thought' }),
              result: WEB_SEARCH_RESULT,
            })}
          />
        </div>
      </Section>
    </>
  )
}
