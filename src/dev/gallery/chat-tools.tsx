import './chat-tools.css'
import { useState, type ReactNode } from 'react'
import { BookOpen, Brain } from '@keyline-icons/react/two-tone'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Bubble, BubbleContent, BubbleFoldBadge } from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolContent,
  ChatToolError,
  ChatToolPanelBody,
  ChatToolPanelFooter,
  ChatToolPanelHeader,
  ChatToolPresentationProvider,
  ChatToolStatusIcon,
  ChatToolTrigger,
  type ChatToolPresentation,
} from '@/components/yuerchu-ui/components/chat-tool/chat-tool'
import {
  ToolChecklist,
  ToolChecklistRow,
  ToolChecklistStatusIcon,
  ToolCommandView,
  ToolDiffStats,
  ToolDiffView,
  ToolFileList,
  ToolSearchResult,
  ToolWebSources,
} from '@/components/yuerchu-ui/components/tool-views/tool-views'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import { ToolFields } from '@/components/ui/tool-value'
import { parsePartialObject } from '@/lib/partial-json'
import {
  ASK_USER_ARGS,
  CODEX_PATCH,
  COMMAND_RESULT,
  PLAN_ARGS,
  PLAN_MD,
  READ_RESULT,
  RUN_AGENT_ARGS,
  SEARCH_RESULT,
  TODO_DONE,
  TODO_RUNNING,
  UNIFIED_PATCH,
  WEB_SEARCH_RESULT,
  WRITE_FILE_CONTENT,
  tool,
} from './fixtures'
import { Section } from './shell'

const MCP_TABLE_RESULT = JSON.stringify([
  { id: 'MER-412', title: '修复通知堆叠连线与滚动条', status: 'Done', priority: 'P1' },
  { id: 'MER-418', title: '迁移对话气泡与工具调用卡片到 Yuerchu UI', status: 'In Progress', priority: 'P1' },
  { id: 'MER-425', title: '统一不同工具卡片的头部与空态排版', status: 'Todo', priority: 'P2' },
])

const MCP_CONTENT_RESULT = JSON.stringify([
  { type: 'text', text: '已找到 2 条与发布流程相关的历史工单。' },
  {
    type: 'resource',
    resource: {
      uri: 'linear://team/MER/issue/MER-418',
      text: 'Status: In Progress\nAssignee: Yuerchu\nLabels: ui, refactor',
    },
  },
])

const SKILL_MD_RESULT = [
  '# UI Design Audit',
  '',
  '检查以下三项核心一致性：',
  '',
  '1. **信息层级**：标题行只保留动词 + 关键标识，次要参数折叠进面板。',
  '2. **状态语义**：排队、运行中、等待确认、成功与失败在图标和边框上区分明确。',
  '3. **密度与对齐**：同一气泡内所有工具块保持一致的左右内边距与圆角收紧。',
].join('\n')

const WEBFETCH_MD_RESULT = [
  '## React Aria Disclosure',
  '',
  'A disclosure is a collapsible section of content. It is composed of a heading button and a panel that is shown or hidden.',
  '',
  '- Keyboard: `Enter` or `Space` toggles the panel.',
  '- ARIA: Automatically links `aria-controls` and `aria-expanded`.',
].join('\n')

function ToolShowcaseGroup({
  label,
  presentation,
  slot,
  children,
}: {
  label: string
  presentation: ChatToolPresentation
  slot?: string
  children: ReactNode
}) {
  if (presentation === 'bubble') {
    return (
      <div data-slot={slot} className="m-gallery-tools__bubble-stage">
        <p className="m-gallery-tools__group-title">{label}</p>
        <Bubble variant="assistant" align="start" className="m-gallery-tools__bubble">
          <BubbleContent>以下是「{label}」类别在对话气泡中的工具块表现：</BubbleContent>
          {children}
        </Bubble>
      </div>
    )
  }
  return (
    <div data-slot={slot} className="m-gallery-tools__stack">
      <p className="m-gallery-tools__group-title">{label}</p>
      {children}
    </div>
  )
}

export default function ChatTools() {
  const [presentation, setPresentation] = useState<ChatToolPresentation>('bubble')
  const [foldedSkillOpen, setFoldedSkillOpen] = useState(false)

  return (
    <>
      <Section title="ChatTool / 预设五态（原语）">
        <div data-slot="gallery-chat-tools" className="m-gallery-tools__stack">
          <ChatTool state="output-available" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="m-gallery-tools__verb">
                Used tool:
              </span>
              <span data-slot="chat-tool-name" className="m-gallery-tools__name">
                getWeather
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields entries={[['city', 'Paris']]} className="m-gallery-tools__fields-pad" />
              <ToolFields entries={[['summary', '18°C, partly cloudy']]} className="m-gallery-tools__fields-pad" />
            </ChatToolContent>
          </ChatTool>

          <ChatTool state="input-streaming" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="m-gallery-tools__verb">
                Running tool:
              </span>
              <span data-slot="chat-tool-name" className="m-gallery-tools__name">
                searchDocs
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields
                entries={Object.entries(parsePartialObject('{"query":"yuerchu-ui') ?? {})}
                className="m-gallery-tools__fields-pad"
              />
            </ChatToolContent>
          </ChatTool>

          <ChatTool state="queued">
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="m-gallery-tools__verb">
                Queued:
              </span>
              <span data-slot="chat-tool-name" className="m-gallery-tools__name">
                runTests
              </span>
            </ChatToolTrigger>
          </ChatTool>

          <ChatTool state="output-error" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="m-gallery-tools__verb">
                Failed tool:
              </span>
              <span data-slot="chat-tool-name" className="m-gallery-tools__name">
                fetchPage
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields entries={[['url', 'https://example.com']]} className="m-gallery-tools__fields-pad" />
              <ChatToolError>Request timed out after 30s</ChatToolError>
            </ChatToolContent>
          </ChatTool>

          <ChatTool state="requires-action" defaultExpanded>
            <ChatToolTrigger>
              <ChatToolStatusIcon />
              <span data-slot="chat-tool-verb" className="m-gallery-tools__verb">
                Approval needed:
              </span>
              <span data-slot="chat-tool-name" className="m-gallery-tools__name">
                sendEmail
              </span>
            </ChatToolTrigger>
            <ChatToolContent>
              <ToolFields
                entries={[
                  ['to', 'team@acme.com'],
                  ['subject', 'Launch update'],
                ]}
                className="m-gallery-tools__fields-pad"
              />
              <ChatToolApproval>
                <Button variant="secondary" size="sm">
                  Reject
                </Button>
                <Button size="sm">Approve</Button>
              </ChatToolApproval>
            </ChatToolContent>
          </ChatTool>
        </div>
      </Section>

      <Section title="ChatTool / 面板三段">
        <ChatTool state="output-available" defaultExpanded>
          <ChatToolTrigger>
            <ChatToolStatusIcon />
            <span data-slot="chat-tool-name" className="m-gallery-tools__name">
              write_file
            </span>
          </ChatToolTrigger>
          <ChatToolContent>
            <ChatToolPanelHeader heading="src/lib/plan-card.ts" description="新文件 · 142 行" end="已写入" />
            <ChatToolPanelBody>
              <ToolFields entries={[['mode', 'create']]} className="m-gallery-tools__fields-pad" />
            </ChatToolPanelBody>
            <ChatToolPanelFooter>
              <span className="m-gallery-tools__footer-note">写入在项目目录内，已免批。</span>
            </ChatToolPanelFooter>
          </ChatToolContent>
        </ChatTool>
      </Section>

      <Section title="全量工具类型卡片总览">
        <div className="m-gallery-tools__controls">
          <span className="m-gallery-tools__controls-label">
            切换展示形态以对比所有工具类型在对话气泡内与独立卡片下的排版与密度
          </span>
          <SegmentedControl
            aria-label="工具展示形态"
            size="sm"
            selectedKey={presentation}
            onSelectionChange={(key) => {
              if (key === 'bubble' || key === 'card') setPresentation(key)
            }}
          >
            <Segment id="bubble">气泡内（Bubble）</Segment>
            <Segment id="card">卡片（Card）</Segment>
          </SegmentedControl>
        </div>

        <ChatToolPresentationProvider value={presentation}>
          <div data-slot="gallery-tool-states" className="m-gallery-tools__stack">
            {/* 1. 文件读取与检索 */}
            <ToolShowcaseGroup
              label="1. 文件读取、搜索与目录（read_file / search_files / glob / list_directory）"
              presentation={presentation}
            >
              <ToolCallBlock
                data={tool({
                  tool_name: 'read_file',
                  status: 'completed',
                  call_id: 'pg-cat-read',
                  arguments: JSON.stringify({ path: 'C:/Users/dev/project/vite.config.ts' }),
                  result: READ_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'search_files',
                  status: 'completed',
                  call_id: 'pg-cat-search',
                  arguments: JSON.stringify({ pattern: 'approveToolCall', path: 'src/' }),
                  result: SEARCH_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'search_files',
                  status: 'completed',
                  call_id: 'pg-cat-search-empty',
                  arguments: JSON.stringify({ pattern: 'nonExistentSymbol' }),
                  result: 'No matches found.',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'glob',
                  status: 'completed',
                  call_id: 'pg-cat-glob',
                  arguments: JSON.stringify({ pattern: 'src/lib/plan-*.ts' }),
                  result:
                    'src/lib/plan-markdown.ts\nsrc/lib/plan-paste.ts\nsrc/lib/plan-review-draft.ts\n\n(showing first 1000 matches)',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'list_directory',
                  status: 'completed',
                  call_id: 'pg-cat-dir',
                  arguments: JSON.stringify({ path: 'src/lib' }),
                  result:
                    'dir          -  __tests__\nfile    4.1 KB  paths.ts\nfile   12.8 KB  tool-output.ts\nlink      24 B  latest',
                })}
              />
            </ToolShowcaseGroup>

            {/* 2. 文件编辑与补丁 */}
            <ToolShowcaseGroup
              label="2. 文件写入、编辑、补丁、删除与移动（write_file / edit_file / apply_patch / move_file / delete_file）"
              presentation={presentation}
            >
              <ToolCallBlock
                data={tool({
                  tool_name: 'write_file',
                  status: 'running',
                  call_id: 'pg-cat-write-running',
                  arguments: JSON.stringify({ path: 'src/lib/format.ts', content: WRITE_FILE_CONTENT }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'edit_file',
                  status: 'pending',
                  call_id: 'pg-cat-edit-pending',
                  arguments: JSON.stringify({
                    file_path: 'src/main.tsx',
                    old_string: 'createRoot(root).render(\n  <App />,\n)',
                    new_string: 'createRoot(root).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)',
                    description: '启用 StrictMode 以便提前暴露副作用问题',
                  }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'Edit',
                  status: 'completed',
                  call_id: 'pg-cat-hosted-edit',
                  arguments: JSON.stringify({
                    file_path: 'src/main.tsx',
                    old_string: 'createRoot(root).render(\n  <App />,\n)',
                    new_string: 'createRoot(root).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)',
                  }),
                  result: 'Updated src/main.tsx',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'apply_patch',
                  status: 'pending',
                  call_id: 'pg-cat-patch-codex',
                  arguments: JSON.stringify({ base_path: '.', patch: CODEX_PATCH }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'apply_patch',
                  status: 'completed',
                  call_id: 'pg-cat-patch-unified',
                  arguments: JSON.stringify({ patch: UNIFIED_PATCH }),
                  result: 'Applied patch: 1 updated — src/lib.rs',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'move_file',
                  status: 'completed',
                  call_id: 'pg-cat-move',
                  arguments: JSON.stringify({ from: 'src/utils/old-helper.ts', to: 'src/lib/helper.ts' }),
                  result: 'Moved src/utils/old-helper.ts → src/lib/helper.ts',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'delete_file',
                  status: 'error',
                  call_id: 'pg-cat-delete-err',
                  arguments: JSON.stringify({ path: 'C:/locked/file.db' }),
                  result: 'Permission denied: the file is locked by another process (os error 32)',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'read_file',
                  status: 'denied',
                  call_id: 'pg-cat-read-denied',
                  arguments: JSON.stringify({ path: 'C:/Users/dev/.ssh/id_ed25519' }),
                })}
              />
            </ToolShowcaseGroup>

            {/* 3. 终端命令 */}
            <ToolShowcaseGroup
              label="3. 终端命令（run_command / Bash：成功、stderr、运行、排队、提权审批、失效）"
              presentation={presentation}
            >
              <ToolCallBlock
                data={tool({
                  tool_name: 'run_command',
                  status: 'completed',
                  call_id: 'pg-cat-cmd-ok',
                  arguments: JSON.stringify({ command: 'cargo check', description: '检查 Rust 核心编译' }),
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
                  tool_name: 'run_command',
                  status: 'running',
                  call_id: 'pg-cat-cmd-running',
                  arguments: JSON.stringify({ command: 'cargo test --lib' }),
                })}
              />
              <ToolCallBlock
                queued
                data={tool({
                  tool_name: 'run_command',
                  status: 'running',
                  call_id: 'pg-cat-cmd-queued',
                  arguments: JSON.stringify({ command: 'pnpm vitest run' }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'run_command',
                  status: 'pending',
                  call_id: 'pg-escalation',
                  retry: { kind: 'sandbox_denied', reason: 'sandbox denied' },
                  arguments: JSON.stringify({
                    command: 'netsh advfirewall show allprofiles',
                    description: '读取本机防火墙策略以排查端口阻塞',
                  }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'run_command',
                  status: 'orphaned',
                  call_id: 'pg-cat-cmd-orphaned',
                  arguments: JSON.stringify({ command: 'git push --force' }),
                })}
              />
            </ToolShowcaseGroup>

            {/* 4. 网页搜索与网页抓取 */}
            <ToolShowcaseGroup
              label="4. 联网检索与抓取（web_search / google_search / url_context / WebFetch）"
              presentation={presentation}
            >
              <ToolCallBlock
                data={tool({
                  tool_name: 'web_search',
                  status: 'pending',
                  call_id: 'pg-cat-web-pending',
                  arguments: JSON.stringify({ query: 'React Aria Disclosure accessibility' }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'web_search',
                  status: 'completed',
                  call_id: 'pg-cat-web-done',
                  arguments: JSON.stringify({ query: 'React Aria Disclosure accessibility' }),
                  result: WEB_SEARCH_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'google_search',
                  status: 'completed',
                  call_id: 'pg-cat-gsearch',
                  arguments: JSON.stringify({ queries: ['Material 3 Expressive settings mobile'] }),
                  result: WEB_SEARCH_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'url_context',
                  status: 'completed',
                  call_id: 'pg-cat-urlctx',
                  arguments: JSON.stringify({ urls: ['https://react-spectrum.adobe.com/react-aria/Disclosure.html'] }),
                  result: WEB_SEARCH_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'WebSearch',
                  status: 'completed',
                  call_id: 'pg-cat-hosted-websearch',
                  arguments: JSON.stringify({ query: 'React Aria Disclosure accessibility' }),
                  result:
                    'Web search results for query: "React Aria Disclosure accessibility"\n\nLinks: [{"title":"Disclosure – React Aria","url":"https://react-spectrum.adobe.com/react-aria/Disclosure.html"}]\n\nReact Aria provides accessible disclosure hooks with automatic `aria-controls` and `aria-expanded` wiring.',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'WebFetch',
                  status: 'completed',
                  call_id: 'pg-cat-webfetch',
                  arguments: JSON.stringify({
                    url: 'https://react-spectrum.adobe.com/react-aria/Disclosure.html',
                    prompt: '提取键盘交互与 ARIA 属性要点',
                  }),
                  result: WEBFETCH_MD_RESULT,
                })}
              />
            </ToolShowcaseGroup>

            {/* 5. 提问表单 */}
            <div data-slot="gallery-tool-asks" className="m-gallery-tools__bubble-stage">
              <p className="m-gallery-tools__group-title">
                5. 交互提问（ask_user：待回答独立轻框表单；已回答/已失效/出错收起为块）
              </p>
              <div className="m-gallery-tools__stack">
                <ToolCallBlock
                  data={tool({
                    tool_name: 'ask_user',
                    status: 'pending',
                    call_id: 'pg-cat-ask-pending',
                    arguments: ASK_USER_ARGS,
                  })}
                />
                {presentation === 'bubble' ? (
                  <Bubble variant="assistant" align="start" className="m-gallery-tools__bubble">
                    <BubbleContent>已结束的提问会收拢为气泡内的轻量记录：</BubbleContent>
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'ask_user',
                        status: 'completed',
                        call_id: 'pg-cat-ask-answered',
                        arguments: ASK_USER_ARGS,
                        result: JSON.stringify({ q1: 'staging' }),
                      })}
                    />
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'ask_user',
                        status: 'orphaned',
                        call_id: 'pg-cat-ask-orphaned',
                        arguments: ASK_USER_ARGS,
                      })}
                    />
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'ask_user',
                        status: 'error',
                        call_id: 'pg-cat-ask-error',
                        arguments: ASK_USER_ARGS,
                      })}
                    />
                  </Bubble>
                ) : (
                  <>
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'ask_user',
                        status: 'completed',
                        call_id: 'pg-cat-ask-answered',
                        arguments: ASK_USER_ARGS,
                        result: JSON.stringify({ q1: 'staging' }),
                      })}
                    />
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'ask_user',
                        status: 'orphaned',
                        call_id: 'pg-cat-ask-orphaned',
                        arguments: ASK_USER_ARGS,
                      })}
                    />
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'ask_user',
                        status: 'error',
                        call_id: 'pg-cat-ask-error',
                        arguments: ASK_USER_ARGS,
                      })}
                    />
                  </>
                )}
              </div>
            </div>

            {/* 6. 待办清单、计划模式与子代理 */}
            <ToolShowcaseGroup
              label="6. 待办清单、计划模式与子代理（update_todos / TodoWrite / enter_plan / exit_plan / read_plan / run_agent）"
              presentation={presentation}
            >
              <ToolCallBlock
                data={tool({
                  tool_name: 'update_todos',
                  status: 'completed',
                  call_id: 'pg-cat-todo-run',
                  arguments: TODO_RUNNING,
                  result: 'Checklist "重构鉴权模块" updated (1/4 done). Now: 替换调用方',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'update_todos',
                  status: 'completed',
                  call_id: 'pg-cat-todo-done',
                  arguments: TODO_DONE,
                  result: 'Checklist "修复 CI 失败" finished (2/2).',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'TodoWrite',
                  status: 'completed',
                  call_id: 'pg-cat-hosted-todos',
                  arguments: JSON.stringify({
                    todos: [
                      { content: '盘点所有工具卡片类型', status: 'completed', activeForm: '盘点中' },
                      { content: '逐一截图核验气泡态与卡片态', status: 'in_progress', activeForm: '核验中' },
                      { content: '整理优化建议清单', status: 'pending', activeForm: '整理中' },
                    ],
                  }),
                  result: 'Todos have been modified successfully.',
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'enter_plan',
                  status: 'pending',
                  call_id: 'pg-cat-enter-plan',
                  arguments: JSON.stringify({
                    reason: '鉴权改动牵涉三个模块，先确认走 middleware 还是 handler 内联更省事。',
                  }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'exit_plan',
                  status: 'pending',
                  call_id: 'pg-cat-exit-plan',
                  arguments: PLAN_ARGS,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'read_plan',
                  status: 'completed',
                  call_id: 'pg-cat-read-plan',
                  arguments: JSON.stringify({}),
                  result: JSON.stringify({ content: PLAN_MD, generation: 3 }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'run_agent',
                  status: 'running',
                  call_id: 'pg-cat-subagent-live',
                  arguments: RUN_AGENT_ARGS,
                  sub_agent: {
                    conversation_id: 'pg-sub-live',
                    turn_id: 'pg-run-live',
                    kind: 'agent',
                    steps: 4,
                    status: 'running',
                  },
                })}
              />
            </ToolShowcaseGroup>

            {/* 7. 技能、记忆与结构化 MCP 工具 */}
            <div className="m-gallery-tools__bubble-stage">
              <p className="m-gallery-tools__group-title">
                7. 轻量辅助工具附着气泡（load_skill / save_memory 折叠为胶囊，点击按需展开）
              </p>
              <Bubble variant="assistant" align="start" className="m-gallery-tools__bubble">
                <BubbleContent>
                  <p>已按 UI 审查技能核对完这批组件，并记住了你的气泡底色偏好。</p>
                  <div className="m-gallery-tools__fold-badges">
                    <BubbleFoldBadge expanded={foldedSkillOpen} onPress={() => setFoldedSkillOpen((v) => !v)}>
                      <BookOpen aria-hidden className="m-gallery-tools__fold-icon" />
                      技能 · ui-design-audit
                    </BubbleFoldBadge>
                    <BubbleFoldBadge expanded={foldedSkillOpen} onPress={() => setFoldedSkillOpen((v) => !v)}>
                      <Brain aria-hidden className="m-gallery-tools__fold-icon" />
                      记忆 1 次
                    </BubbleFoldBadge>
                  </div>
                </BubbleContent>
                {foldedSkillOpen && (
                  <>
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'load_skill',
                        status: 'completed',
                        call_id: 'pg-cat-skill-folded',
                        arguments: JSON.stringify({ skill_name: 'ui-design-audit' }),
                        result: SKILL_MD_RESULT,
                      })}
                    />
                    <ToolCallBlock
                      data={tool({
                        tool_name: 'save_memory',
                        status: 'completed',
                        call_id: 'pg-cat-memory-folded',
                        arguments: JSON.stringify({ key: 'user_preference', value: '使用浅强调蓝作为用户气泡底色' }),
                        result: JSON.stringify({ saved: true, key: 'user_preference', scope: 'global' }),
                      })}
                    />
                  </>
                )}
              </Bubble>
            </div>

            <ToolShowcaseGroup
              label="8. 技能、记忆与 MCP 结构化工具展开态（load_skill / save_memory / mcp__*）"
              presentation={presentation}
            >
              <ToolCallBlock
                data={tool({
                  tool_name: 'load_skill',
                  status: 'completed',
                  call_id: 'pg-cat-skill',
                  arguments: JSON.stringify({ skill_name: 'ui-design-audit' }),
                  result: SKILL_MD_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'save_memory',
                  status: 'completed',
                  call_id: 'pg-cat-memory',
                  arguments: JSON.stringify({ key: 'user_preference', value: '使用浅强调蓝作为用户气泡底色' }),
                  result: JSON.stringify({ saved: true, key: 'user_preference', scope: 'global' }),
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'mcp__linear__list_issues',
                  status: 'completed',
                  call_id: 'pg-cat-mcp-table',
                  arguments: JSON.stringify({ team: 'MER', state: 'active', limit: 10 }),
                  result: MCP_TABLE_RESULT,
                })}
              />
              <ToolCallBlock
                data={tool({
                  tool_name: 'mcp__linear__get_issue',
                  status: 'completed',
                  call_id: 'pg-cat-mcp-content',
                  arguments: JSON.stringify({ id: 'MER-418' }),
                  result: MCP_CONTENT_RESULT,
                })}
              />
            </ToolShowcaseGroup>
          </div>
        </ChatToolPresentationProvider>
      </Section>

      <Section title="ToolViews / 专用工具视图原语（库）">
        <div className="m-gallery-tools__stack">
          <ToolDiffStats added={3} removed={1} />
          <ToolDiffView
            path="src/lib/cache.ts"
            lines={[
              { kind: 'context', oldNo: 1, newNo: 1, text: 'export const ttl = 60' },
              { kind: 'remove', oldNo: 2, text: 'export const max = 10' },
              { kind: 'add', newNo: 2, text: 'export const max = 100' },
            ]}
          />
          <ToolSearchResult
            groups={[{ file: 'src/lib/cache.ts', matches: [{ line: 2, text: 'export const max = 100' }] }]}
          />
          <ToolFileList entries={[{ path: 'src/lib/cache.ts', kind: 'file', size: '1.2 KB' }]} />
          <ToolCommandView stdout="ok" stderr="warn" />
          <ToolChecklist items={[{ content: '完成迁移', status: 'completed' }]} />
          <ToolChecklistRow item={{ content: '核验视觉基线', status: 'in_progress' }} />
          <ToolChecklistStatusIcon status="pending" />
          <ToolWebSources
            sources={[
              {
                title: 'React Aria Disclosure',
                url: 'https://react-spectrum.adobe.com/react-aria/Disclosure.html',
                domain: 'react-spectrum.adobe.com',
                snippet: 'Accessible collapsible disclosure primitive.',
              },
            ]}
          />
        </div>
      </Section>
    </>
  )
}
