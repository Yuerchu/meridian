import { AgentThinking } from '@/components/application/agent-thinking/agent-thinking'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import TodoBoard from '@/components/chat/todo-board'
import type { TodoDraft } from '@/components/chat/todo-list'
import { ChangesPanelView } from '@/components/chat/changes-panel'
import {
  CHANGED_FILES,
  PLAN_ARGS,
  RUN_AGENT_ARGS,
  TODO_DONE,
  TODO_NO_CURRENT,
  TODO_RUNNING,
  TODO_SINGLE,
  todoStep,
  tool,
} from './fixtures'
import { Section } from './shell'

export default function Agent() {
  return (
    <>
      <Section title="AgentThinking / 等待指示">
        <div className="flex flex-wrap gap-6">
          {(['wave', 'spin', 'stars', 'infinity'] as const).map((variant) => (
            <AgentThinking key={variant} variant={variant} label={variant} showTimer />
          ))}
        </div>
      </Section>
      <Section title="ToolCallBlock / run_agent">
        <div data-slot="gallery-tool-agents">
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
              sub_agent: {
                conversation_id: 'pg-sub-1',
                turn_id: 'pg-run-1',
                kind: 'agent',
                steps: 4,
                status: 'running',
              },
            })}
          />
          {/* 它要权限。问题画在这里，因为没人在看它自己那条会话。 */}
          <ToolCallBlock
            data={tool({
              tool_name: 'run_agent',
              status: 'running',
              call_id: 'pg-run-agent-asking',
              arguments: RUN_AGENT_ARGS,
              sub_agent: {
                conversation_id: 'pg-sub-1',
                turn_id: 'pg-run-2',
                kind: 'agent',
                steps: 2,
                status: 'running',
              },
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
              sub_agent: {
                conversation_id: 'pg-sub-2',
                turn_id: 'pg-run-3',
                kind: 'explore',
                steps: 3,
                status: 'done',
              },
              result: [
                'Sub-agent finished after 3 steps.',
                '',
                '## 结论',
                '',
                '`openai_compat.rs:187` 起，eventsource-stream 的 `Event` 在这里变成 `ChatChunk`。',
                '',
                '- 解析入口：`provider/openai_compat.rs:187-240`',
                '- 工具调用增量：`provider/openai_responses.rs:400-520`',
                '',
                'The user sent 1 message(s) to the sub-agent after it had stopped reading, so it never saw them. They are in its transcript. Read them before acting on the answer above.',
              ].join('\n'),
            })}
          />
          {/* 派出去了，然后进程没了。 */}
          <ToolCallBlock
            data={tool({
              tool_name: 'run_agent',
              status: 'orphaned',
              call_id: 'pg-run-agent-dead',
              arguments: RUN_AGENT_ARGS,
              sub_agent: {
                conversation_id: 'pg-sub-3',
                turn_id: 'pg-run-4',
                kind: 'agent',
                steps: 1,
                status: 'interrupted',
              },
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
      <Section title="ToolCallBlock / todo 清单">
        <div data-slot="gallery-tool-todos">
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
        <div data-slot="gallery-tool-plans">
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
      <Section title="TodoBoard / 三列看板">
        {/* Rendered directly as well as through the bar's own toggle: the
              cases worth looking at are an empty column and a card long enough
              to wrap, and both are two clicks deep otherwise. Boxed at 672px —
              the composer's width — because that is what decides whether three
              columns fit or the grid turns into a horizontal scroller. */}
        <div
          data-slot="gallery-todo-board"
          className="w-full max-w-2xl rounded-2xl bg-background-primary-default p-4 shadow-card"
        >
          <TodoBoard todos={(JSON.parse(TODO_RUNNING) as { todos: TodoDraft[] }).todos} />
        </div>
        <div
          data-slot="gallery-todo-board-narrow"
          className="w-[360px] rounded-2xl bg-background-primary-default p-4 shadow-card"
        >
          <TodoBoard todos={(JSON.parse(TODO_NO_CURRENT) as { todos: TodoDraft[] }).todos} />
        </div>
      </Section>
      <Section title="ChangesPanel / 改动文件树">
        {/* The three cases the tree has to get right: a collapsed run of
              single-child directories, a branch where collapsing must stop,
              and all three verbs side by side. Boxed at the panel's own
              minimum width, which is where a long path decides whether it
              truncates or pushes the marker off the edge. */}
        <div
          data-slot="gallery-changes-panel"
          className="h-96 w-[280px] rounded-2xl border border-border-button-default bg-background-primary-default"
        >
          <ChangesPanelView files={CHANGED_FILES} onClose={() => {}} />
        </div>
        <div
          data-slot="gallery-changes-panel-empty"
          className="h-48 w-[280px] rounded-2xl border border-border-button-default bg-background-primary-default"
        >
          <ChangesPanelView files={[]} onClose={() => {}} />
        </div>
      </Section>
    </>
  )
}
