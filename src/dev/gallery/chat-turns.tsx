import { TurnItem } from '@/components/chat/turn-item'
import { buildTurns } from '@/lib/turns'
import type { ContentBlock, TurnUsageInfoResponse } from '@/types'
import {
  ANSWER,
  ANSWER_MD,
  COMMAND_RESULT,
  PG_NOW,
  READ_RESULT,
  SEARCH_RESULT,
  msg,
  noop,
  pgUsage,
  tool,
} from './fixtures'
import { Section } from './shell'

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
  usage,
}: {
  label: string
  /** The persisted, backend-priced usage the turn-details popover shows. */
  usage?: TurnUsageInfoResponse
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
    {
      streaming,
      crashedTurnIds: crashed ? new Set(['t']) : undefined,
      usageByTurnId: usage ? new Map([['t', usage]]) : undefined,
    },
  )
  return (
    <div
      data-slot="turn-case"
      className="w-full max-w-2xl space-y-1 rounded-xl border border-dashed border-border-button-default/60 p-4"
    >
      <div data-slot="turn-case-label" className="text-caption-1-regular text-text-secondary">
        {label}
      </div>
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

export default function ChatTurns() {
  return (
    <>
      <Section title="TurnItem / 一整个回合的排版">
        <div data-slot="gallery-turn-layouts" className="space-y-3">
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
        <div data-slot="gallery-turn-states" className="space-y-3">
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
          <TurnItemCase
            label="回合详情 · 已定价（点操作行的 ⓘ）"
            usage={pgUsage()}
            blocks={[{ type: 'text', text: ANSWER }]}
          />
          <TurnItemCase
            label="回合详情 · 部分未定价（下界）"
            usage={pgUsage({
              pricing_status: 'lower_bound',
              tool_cost: null,
              unpriced_tool_messages: 1,
              unpriced_messages: 1,
            })}
            blocks={[{ type: 'text', text: ANSWER }]}
          />
          <TurnItemCase
            label="回合详情 · 托管会话只报告不定价"
            hosted
            usage={pgUsage({
              input_cost: null,
              output_cost: null,
              cache_cost: null,
              tool_cost: null,
              total_cost: null,
              metered_messages: 0,
              external_messages: 3,
              pricing_status: 'external',
            })}
            blocks={[{ type: 'text', text: ANSWER }]}
          />
        </div>
      </Section>
    </>
  )
}
