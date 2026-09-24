import type {
  AutoReviewVerdictInfoResponse,
  ConversationInfoResponse,
  MessageContextInfoResponse,
  MessageInfoResponse,
  PendingApprovalInfoResponse,
  PlanReviewSummaryInfoResponse,
  ProjectInfoResponse,
  SubAgentRunInfoResponse,
  TodoInfoResponse,
  TurnInfoResponse,
  UserCommandResultResponse,
} from '@/types'
import { ago, call, conversation, message, turn, usage } from './factories'

/**
 * The sidebar and everything behind it.
 *
 * Each conversation is stored as a whole tree (`all`) plus a head, the way the
 * database keeps it, so switching a branch, deleting a subtree and appending a
 * replayed turn all go through the same path walk the backend does rather than
 * through a pre-flattened list that could only ever show one version.
 */
export interface DemoThread {
  all: MessageInfoResponse[]
  head: string | null
  /** Off the parent chain by design — see migration notes on compaction. */
  compactSummary: MessageInfoResponse | null
  turns: TurnInfoResponse[]
  pending: PendingApprovalInfoResponse[]
  planReviews: PlanReviewSummaryInfoResponse[]
  planBarrier: boolean
  subRuns: SubAgentRunInfoResponse[]
  shellResults: Record<string, UserCommandResultResponse>
  contextContents: Record<string, string>
  todo: TodoInfoResponse | null
}

export const PROJECT_MERIDIAN = 'demo-project-meridian'
export const PROJECT_FIRMWARE = 'demo-project-firmware'
export const DEMO_ROOT = 'C:\\Users\\demo\\Code\\meridian'

export const CONV = {
  rich: 'demo-conv-scroller',
  approval: 'demo-conv-approval',
  ask: 'demo-conv-ask',
  plan: 'demo-conv-plan',
  delegate: 'demo-conv-delegate',
  subExplore: 'demo-conv-sub-explore',
  subAgent: 'demo-conv-sub-agent',
  stickers: 'demo-conv-stickers',
  compact: 'demo-conv-compact',
  pinned: 'demo-conv-pinned',
  firmware: 'demo-conv-firmware',
  archived: 'demo-conv-archived',
  empty: 'demo-conv-empty',
} as const

export const APPROVAL = {
  command: 'demo-approval-run-command',
  ask: 'demo-approval-ask-user',
} as const

export const PLAN_REVIEW_ID = 'demo-plan-review'
export const PLAN_DOCUMENT_ID = 'demo-plan-document'
export const PLAN_REVISION_ID = 'demo-plan-revision-1'

function emptyThread(): DemoThread {
  return {
    all: [],
    head: null,
    compactSummary: null,
    turns: [],
    pending: [],
    planReviews: [],
    planBarrier: false,
    subRuns: [],
    shellResults: {},
    contextContents: {},
    todo: null,
  }
}

/** Appends rows as a chain, each the child of the one before, unless told to
 *  fork from an earlier row. */
class Writer {
  readonly thread = emptyThread()
  private cursor: string | null = null
  private order = 0

  constructor(
    readonly conversationId: string,
    private readonly now: number,
  ) {}

  add(
    over: Partial<MessageInfoResponse> & Pick<MessageInfoResponse, 'role' | 'content'>,
    minutesAgo: number,
  ): MessageInfoResponse {
    const id = over.id ?? `${this.conversationId}-m${this.order}`
    const row = message({
      ...over,
      id,
      conversation_id: this.conversationId,
      created_at: ago(minutesAgo, this.now),
      parent_id: over.parent_id !== undefined ? over.parent_id : this.cursor,
      sort_order: this.order,
    })
    this.order += 1
    this.thread.all.push(row)
    this.cursor = id
    this.thread.head = id
    return row
  }

  /** Continue from `id` instead of the last row written. */
  from(id: string | null) {
    this.cursor = id
  }

  turn(id: string, minutesAgo: number, over: Partial<TurnInfoResponse> = {}) {
    this.thread.turns.push(turn({ id, started_at: ago(minutesAgo, this.now), ...over }))
  }
}

const FILE_SCROLLER = 'src/lib/message-scroller.tsx'

const allowReview: AutoReviewVerdictInfoResponse = {
  outcome: 'allow',
  risk: 'low',
  authorization: 'high',
  rationale: '只读的测试命令，用户在上一条消息里明确要求跑测试。',
  stage: 'quick',
  model: 'claude-haiku-5',
  evidence: [],
}

const denyReview: AutoReviewVerdictInfoResponse = {
  outcome: 'deny',
  risk: 'high',
  authorization: 'low',
  rationale: '要删除整个 node_modules 并重装，用户没有要求，且会中断正在运行的 dev server。',
  stage: 'investigate',
  model: 'claude-haiku-5',
  evidence: [{ tool: 'read_file', arguments: '{"path":"package.json"}' }],
}

/** The conversation worth screenshotting: every ordinary shape in one place. */
function richThread(now: number): DemoThread {
  const w = new Writer(CONV.rich, now)
  const t1 = 'demo-turn-rich-1'
  const t2 = 'demo-turn-rich-2'
  const t2b = 'demo-turn-rich-2b'
  const t3 = 'demo-turn-rich-3'

  const ctxId = 'demo-ctx-scroller'
  const ctx: MessageContextInfoResponse = {
    id: ctxId,
    position: 0,
    kind: 'project_file',
    display_path: FILE_SCROLLER,
    line_start: 40,
    line_end: 96,
    byte_count: 2310,
    line_count: 57,
    token_count: 612,
    truncated: false,
  }
  w.thread.contextContents[ctxId] =
    '// lines 40-96 of message-scroller.tsx\nexport function useFollow() {\n  // ...\n}\n'

  w.turn(t1, 180)
  w.add(
    {
      role: 'user',
      content: `@${FILE_SCROLLER} 流式输出时，问题比视口高的话整段回答都写在屏幕外面了。帮我看看为什么，先别改代码。`,
      turn_id: t1,
      context_items: [ctx],
    },
    180,
  )
  w.add(
    {
      role: 'assistant',
      content: '我先读一下滚动器的实现，再找它是怎么锚定新一轮的。',
      reasoning_content:
        '用户说问题比视口高时回答写在屏幕外。可能是新一轮把问题锚到视口顶部并一直保持。需要看 anchor 逻辑和 follow 模式的切换条件。',
      tool_calls: [
        call('call-read-1', 'read_file', { path: FILE_SCROLLER }),
        call('call-search-1', 'search_files', { pattern: 'scrollToAnchor', path: 'src' }),
      ],
      turn_id: t1,
    },
    179.8,
  )
  w.add(
    {
      role: 'tool',
      content:
        "import * as React from 'react'\n\nexport type ScrollMode = 'follow' | 'idle'\n\nexport function MessageScroller() {\n  const [mode, setMode] = React.useState<ScrollMode>('follow')\n  // ...\n}\n",
      tool_call_id: 'call-read-1',
      turn_id: t1,
    },
    179.7,
  )
  w.add(
    {
      role: 'tool',
      content:
        'src/lib/message-scroller.tsx:128:  scrollToAnchor(turnId)\nsrc/lib/message-scroller.tsx:211:function scrollToAnchor(id: string) {\nsrc/components/chat/chat-transcript.tsx:77:    scroller.scrollToAnchor(answerAnchorId)',
      tool_call_id: 'call-search-1',
      turn_id: t1,
    },
    179.6,
  )
  w.add(
    {
      role: 'assistant',
      content: [
        '原因在锚定逻辑：新一轮开始时会把**问题**钉到视口顶部，并在整个流式过程中保持。',
        '',
        '问题比视口高时，这个锚点永远不会释放，于是回答一直写在视口下方。',
        '',
        '| 模式 | 谁在移动 | 何时退出 |',
        '| --- | --- | --- |',
        '| `follow` | 跟随流式末端 | 读者向上滚动 |',
        '| `idle` | 只有读者自己 | 读者回到末端 |',
        '',
        '建议把"锚定"改成跟随的副产物，而不是与跟随竞争的第二种模式：',
        '',
        '```ts',
        'function onChunk() {',
        "  if (mode === 'follow') viewport.scrollTo({ top: viewport.scrollHeight })",
        '}',
        '```',
      ].join('\n'),
      turn_id: t1,
      rating: 1,
    },
    179,
  )

  // Asked once, answered twice: the regenerated answer is the one on the path.
  w.turn(t2, 120, { usage: usage(2210, 96, 1800, '0.0031') })
  const q2 = w.add({ role: 'user', content: '那就按你说的改，改完跑一下相关测试。', turn_id: t2 }, 120)
  w.add(
    {
      role: 'assistant',
      content: '好的，我先改 `onChunk`。',
      tool_calls: [
        call('call-edit-old', 'edit_file', {
          file_path: FILE_SCROLLER,
          old_string: 'anchorTo(turnId)',
          new_string: 'follow()',
          description: '去掉独立的锚定模式',
        }),
      ],
      turn_id: t2,
    },
    119.5,
  )
  w.add(
    {
      role: 'tool',
      content: 'Error: old_string not found in src/lib/message-scroller.tsx',
      tool_call_id: 'call-edit-old',
      tool_outcome: 'error',
      turn_id: t2,
    },
    119.4,
  )
  w.add({ role: 'assistant', content: '上一次的替换没有匹配到，我换个方式。', turn_id: t2 }, 119.3)

  w.from(q2.id)
  w.turn(t2b, 60)
  w.add(
    {
      role: 'assistant',
      content: '好的。先修改跟随逻辑，再跑滚动器的测试。',
      reasoning_content: '需要先确认 old_string 的准确文本，否则替换会失败。上一个版本就是因为这个出错的。',
      tool_calls: [
        call('call-edit-1', 'edit_file', {
          file_path: FILE_SCROLLER,
          old_string: '    if (anchored) viewport.scrollTo({ top: anchorTop })\n    else follow()',
          new_string: "    if (mode === 'follow') follow()",
          description: '锚定改为跟随的副产物',
        }),
        call('call-cmd-1', 'run_command', {
          command: 'pnpm vitest run src/lib/message-scroller.test.ts',
          description: '跑滚动器单元测试',
        }),
        call('call-cmd-2', 'run_command', {
          command: 'rm -rf node_modules && pnpm install',
          description: '重装依赖',
        }),
      ],
      auto_review: { 'call-cmd-1': allowReview, 'call-cmd-2': denyReview },
      turn_id: t2b,
    },
    59.8,
  )
  w.add(
    { role: 'tool', content: 'Edited src/lib/message-scroller.tsx', tool_call_id: 'call-edit-1', turn_id: t2b },
    59.7,
  )
  w.add(
    {
      role: 'tool',
      content:
        ' RUN  v4.1.0\n\n ✓ src/lib/message-scroller.test.ts (18 tests) 212ms\n\n Test Files  1 passed (1)\n      Tests  18 passed (18)\n   Duration  1.34s',
      tool_call_id: 'call-cmd-1',
      turn_id: t2b,
    },
    59.5,
  )
  w.add(
    {
      role: 'tool',
      content: 'Denied by automatic review: 要删除整个 node_modules 并重装，用户没有要求。',
      tool_call_id: 'call-cmd-2',
      tool_outcome: 'denied',
      turn_id: t2b,
    },
    59.4,
  )
  w.add(
    {
      role: 'assistant',
      content:
        '改好了，18 个测试全部通过。\n\n重装依赖的请求被自动审查拒绝了——那一步本来就不必要，已跳过。现在流式时会一直跟随末端，停止后如果你还在跟随，会滚回回答的开头。',
      turn_id: t2b,
    },
    59,
  )

  w.turn(t3, 20)
  w.add({ role: 'user', content: '顺便列一个后续的待办。', turn_id: t3 }, 20)
  const todoArgs = {
    title: '滚动器后续',
    todos: [
      { content: '给"尾部有状态行"补一个回归场景', active_form: '补回归场景', status: 'completed' },
      { content: '检查 LazyTurn 的高度估算', active_form: '检查高度估算', status: 'in_progress' },
      { content: '在 WebView2 上复测', active_form: '复测 WebView2', status: 'pending' },
    ],
  }
  w.add(
    {
      role: 'assistant',
      content: '',
      tool_calls: [call('call-todo-1', 'update_todos', todoArgs)],
      turn_id: t3,
    },
    19.9,
  )
  w.add({ role: 'tool', content: 'Todo list updated (3 items).', tool_call_id: 'call-todo-1', turn_id: t3 }, 19.8)
  w.add({ role: 'assistant', content: '列好了，第一项已经完成，正在看第二项。', turn_id: t3 }, 19.5)

  w.thread.todo = {
    list: {
      id: 'demo-todo-list',
      conversation_id: CONV.rich,
      title: todoArgs.title,
      status: 'in_progress',
      created_at: ago(19.9, now),
      updated_at: ago(19.9, now),
    },
    items: todoArgs.todos.map((todo, index) => ({
      id: `demo-todo-${index}`,
      list_id: 'demo-todo-list',
      content: todo.content,
      active_form: todo.active_form,
      status: todo.status as 'completed' | 'in_progress' | 'pending',
      sort_order: index,
      created_at: ago(19.9, now),
    })),
  }
  return w.thread
}

/** A turn stopped on a command that needs a person. */
function approvalThread(now: number): DemoThread {
  const w = new Writer(CONV.approval, now)
  const t = 'demo-turn-approval'
  w.turn(t, 6, {
    status: 'running',
    phase: 'awaiting_approval',
    phase_tool: 'run_command',
    ended_at: null,
    usage: null,
  })
  w.add({ role: 'user', content: '把 release 分支的构建跑一遍，看看产物有多大。', turn_id: t }, 6)
  const a = w.add(
    {
      role: 'assistant',
      content: '需要在项目根目录执行一次生产构建。',
      tool_calls: [
        call('call-approval-cmd', 'run_command', {
          command: 'pnpm build && du -sh dist',
          description: '生产构建并统计产物大小',
        }),
      ],
      turn_id: t,
    },
    5.8,
  )
  w.thread.pending.push({
    approval_id: APPROVAL.command,
    conversation_id: CONV.approval,
    assistant_message_id: a.id,
    provider_call_id: 'call-approval-cmd',
    origin_call_id: null,
    tool_name: 'run_command',
    arguments: a.tool_calls![0].function.arguments,
    retry_reason: null,
    bubbled: false,
    parent_call_id: null,
    sub_conversation_id: null,
  })
  return w.thread
}

/** A turn waiting on an `ask_user` form. */
function askThread(now: number): DemoThread {
  const w = new Writer(CONV.ask, now)
  const t = 'demo-turn-ask'
  w.turn(t, 3, { status: 'running', phase: 'awaiting_approval', phase_tool: 'ask_user', ended_at: null, usage: null })
  w.add({ role: 'user', content: '帮我给设置页加一个"导出数据"入口。', turn_id: t }, 3)
  const args = {
    questions: [
      {
        id: 'format',
        question: '导出成什么格式？',
        options: [
          { label: 'JSON', description: '完整、可再导入' },
          { label: 'Markdown', description: '适合阅读和分享' },
        ],
      },
      {
        id: 'scope',
        question: '导出哪些内容？',
        multi_select: true,
        options: [{ label: '会话' }, { label: '记忆' }, { label: '服务商配置（不含密钥）' }],
      },
    ],
  }
  const a = w.add(
    {
      role: 'assistant',
      content: '动手之前有两个问题需要你决定。',
      tool_calls: [call('call-ask-1', 'ask_user', args)],
      turn_id: t,
    },
    2.8,
  )
  w.thread.pending.push({
    approval_id: APPROVAL.ask,
    conversation_id: CONV.ask,
    assistant_message_id: a.id,
    provider_call_id: 'call-ask-1',
    origin_call_id: null,
    tool_name: 'ask_user',
    arguments: JSON.stringify(args),
    retry_reason: null,
    bubbled: false,
    parent_call_id: null,
    sub_conversation_id: null,
  })
  return w.thread
}

export const PLAN_MARKDOWN = [
  '# 导出数据',
  '',
  '## 目标',
  '',
  '在设置 → 关于 下加一个"导出数据"入口，导出会话与记忆。',
  '',
  '## 步骤',
  '',
  '1. 后端新增 `export_bundle` 命令，流式写入 zip。',
  '2. 前端在关于页加入口和进度。',
  '3. 密钥一律不导出，在界面上写明。',
  '',
  '## 风险',
  '',
  '- 大会话导出时间长，需要可取消。',
].join('\n')

/** Plan mode, stopped on a submitted plan. */
function planThread(now: number): DemoThread {
  const w = new Writer(CONV.plan, now)
  const t = 'demo-turn-plan'
  w.turn(t, 40, { status: 'waiting_review' })
  w.add({ role: 'user', content: '先出一个导出功能的计划，我看过再动手。', turn_id: t }, 40)
  w.add(
    {
      role: 'assistant',
      content: '计划写好了，请审阅。',
      tool_calls: [
        call('call-update-plan', 'update_plan', {
          patch: '*** Begin Patch\n*** Add File: plan.md\n+# 导出数据\n*** End Patch',
        }),
        call('call-exit-plan', 'exit_plan', {}),
      ],
      turn_id: t,
    },
    39,
  )
  const a = w.thread.all[w.thread.all.length - 1]
  w.add({ role: 'tool', content: 'Plan updated (generation 1).', tool_call_id: 'call-update-plan', turn_id: t }, 38.9)
  w.thread.planReviews.push({
    review_id: PLAN_REVIEW_ID,
    conversation_id: CONV.plan,
    document_id: PLAN_DOCUMENT_ID,
    revision_id: PLAN_REVISION_ID,
    assistant_message_id: a.id,
    provider_call_id: 'call-exit-plan',
    turn_id: t,
    status: 'pending',
    delivery_state: null,
    lock_version: 1,
  })
  w.thread.planBarrier = true
  return w.thread
}

function delegateThreads(now: number): Record<string, DemoThread> {
  const w = new Writer(CONV.delegate, now)
  const t = 'demo-turn-delegate'
  w.turn(t, 90)
  w.add({ role: 'user', content: '调查一下为什么 Android 上键盘弹起时输入框被挡住，同时修一下。', turn_id: t }, 90)
  const a = w.add(
    {
      role: 'assistant',
      content: '我分两路并行：一路只读调查布局链，一路直接尝试修复。',
      tool_calls: [
        call('call-agent-explore', 'run_agent', {
          kind: 'explore',
          description: '调查键盘遮挡的布局链',
          prompt: '找出从 app-shell 到 composer 之间所有设置了 svh 高度的元素。',
        }),
        call('call-agent-fix', 'run_agent', {
          kind: 'agent',
          description: '给 Sidebar.Main 加 min-h-0',
          prompt: '在 Sidebar.Main 上加 min-h-0 并验证。',
        }),
      ],
      turn_id: t,
    },
    89.5,
  )
  w.add(
    {
      role: 'tool',
      content:
        'Sub-agent finished after 6 steps.\n\n`.sidebar__main` 设置了 `min-height: 100svh`，所以框架收缩时它仍保持一整屏高。其余元素都没有固定视口高度。',
      tool_call_id: 'call-agent-explore',
      turn_id: t,
    },
    80,
  )
  w.add(
    {
      role: 'tool',
      content:
        'Sub-agent finished after 4 steps.\n\n已在 `Sidebar.Main` 上加 `min-h-0`，Android 真机上输入框不再被挡住。',
      tool_call_id: 'call-agent-fix',
      turn_id: t,
    },
    78,
  )
  w.add(
    {
      role: 'assistant',
      content: '两路都完成了：原因是 `.sidebar__main` 的 `min-height: 100svh`，修复是给 `Sidebar.Main` 加 `min-h-0`。',
      turn_id: t,
    },
    77,
  )
  w.thread.subRuns = [
    {
      conversation_id: CONV.subExplore,
      spawned_by_message_id: a.id,
      spawned_by_call_id: 'call-agent-explore',
      spawned_turn_id: 'demo-turn-sub-explore',
      agent_kind: 'explore',
      title: '调查键盘遮挡的布局链',
      steps: 6,
      status: 'done',
    },
    {
      conversation_id: CONV.subAgent,
      spawned_by_message_id: a.id,
      spawned_by_call_id: 'call-agent-fix',
      spawned_turn_id: 'demo-turn-sub-agent',
      agent_kind: 'agent',
      title: '给 Sidebar.Main 加 min-h-0',
      steps: 4,
      status: 'done',
    },
  ]

  const sub = (id: string, turnId: string, prompt: string, answer: string) => {
    const s = new Writer(id, now)
    s.turn(turnId, 89)
    s.add({ role: 'user', content: prompt, turn_id: turnId }, 89)
    s.add(
      {
        role: 'assistant',
        content: '',
        tool_calls: [call(`${id}-grep`, 'search_files', { pattern: 'svh', path: 'src' })],
        turn_id: turnId,
      },
      88,
    )
    s.add(
      {
        role: 'tool',
        content: 'src/components/base/sidebar/sidebar.css:12:  min-height: 100svh;',
        tool_call_id: `${id}-grep`,
        turn_id: turnId,
      },
      87,
    )
    s.add({ role: 'assistant', content: answer, turn_id: turnId }, 80)
    return s.thread
  }

  return {
    [CONV.delegate]: w.thread,
    [CONV.subExplore]: sub(
      CONV.subExplore,
      'demo-turn-sub-explore',
      '找出从 app-shell 到 composer 之间所有设置了 svh 高度的元素。',
      '只有 `.sidebar__main` 设置了 `min-height: 100svh`。',
    ),
    [CONV.subAgent]: sub(
      CONV.subAgent,
      'demo-turn-sub-agent',
      '在 Sidebar.Main 上加 min-h-0 并验证。',
      '已加 `min-h-0`，验证通过。',
    ),
  }
}

export const STICKERS = {
  thumbs: 'demo-sticker-thumbs',
  cat: 'demo-sticker-cat',
  party: 'demo-sticker-party',
} as const

/** Stickers both ways, an attachment, and a literal `!` command. */
function stickerThread(now: number): DemoThread {
  const w = new Writer(CONV.stickers, now)
  const t1 = 'demo-turn-stickers-1'
  const t2 = 'demo-turn-stickers-shell'
  const t3 = 'demo-turn-stickers-3'
  const image =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#dbeafe"/><circle cx="90" cy="100" r="46" fill="#60a5fa"/><rect x="160" y="60" width="120" height="80" rx="12" fill="#93c5fd"/></svg>',
    )
  w.turn(t1, 300)
  w.add(
    {
      role: 'user',
      content: JSON.stringify([
        { type: 'text', text: '这个配色怎么样？' },
        { type: 'image_url', image_url: { url: image } },
        { type: 'sticker', sticker_id: STICKERS.cat, name: '猫猫探头' },
      ]),
      turn_id: t1,
    },
    300,
  )
  w.add(
    {
      role: 'assistant',
      content: '蓝色系很统一，圆和矩形的明度差再拉开一点会更有层次。',
      tool_calls: [call('call-sticker-1', 'send_sticker', { sticker_id: STICKERS.thumbs, name: '点赞' })],
      turn_id: t1,
    },
    299,
  )
  w.add(
    {
      role: 'tool',
      content: JSON.stringify({ sticker_id: STICKERS.thumbs, name: '点赞' }),
      tool_call_id: 'call-sticker-1',
      turn_id: t1,
    },
    298.9,
  )

  const shellCtx = 'demo-ctx-shell'
  const shell = w.add(
    {
      role: 'user',
      content: '!git status --short',
      source: 'shell',
      turn_id: t2,
      context_items: [
        {
          id: shellCtx,
          position: 0,
          kind: 'shell_output',
          display_path: null,
          line_start: null,
          line_end: null,
          byte_count: 64,
          line_count: 3,
          token_count: 20,
          truncated: false,
        },
      ],
    },
    200,
  )
  const stdout = ' M src/lib/message-scroller.tsx\n M src/components/chat/chat-transcript.tsx\n?? src/dev/demo/\n'
  w.thread.contextContents[shellCtx] = stdout
  w.thread.shellResults[shell.id] = {
    conversation_id: CONV.stickers,
    turn_id: t2,
    message_id: shell.id,
    status: 'completed',
    stdout,
    stderr: '',
    exit_code: 0,
    timed_out: false,
    truncated: false,
    sandbox: 'windows_restricted_token',
    duration_ms: 84,
    cwd: DEMO_ROOT,
    host: 'DEMO-PC',
    error: null,
    can_retry_without_sandbox: false,
    retry_without_sandbox: false,
  }

  w.turn(t3, 150)
  w.add({ role: 'user', content: '根据上面的 git status，哪些文件还没提交？', turn_id: t3 }, 150)
  w.add(
    {
      role: 'assistant',
      content:
        '有两个已修改的文件和一个未跟踪的目录：\n\n- `src/lib/message-scroller.tsx`\n- `src/components/chat/chat-transcript.tsx`\n- `src/dev/demo/`（未跟踪）',
      tool_calls: [call('call-sticker-2', 'send_sticker', { sticker_id: STICKERS.party, name: '撒花' })],
      turn_id: t3,
    },
    149,
  )
  w.add(
    {
      role: 'tool',
      content: JSON.stringify({ sticker_id: STICKERS.party, name: '撒花' }),
      tool_call_id: 'call-sticker-2',
      turn_id: t3,
    },
    148.9,
  )
  return w.thread
}

/** A long conversation whose front has been summarised. */
function compactThread(now: number): DemoThread {
  const w = new Writer(CONV.compact, now)
  let anchor: string | null = null
  for (let i = 0; i < 6; i += 1) {
    const turnId = `demo-turn-compact-${i}`
    const minutes = 2000 - i * 200
    w.turn(turnId, minutes)
    const q = w.add(
      { role: 'user', content: `第 ${i + 1} 轮：继续整理 OneBot 的引用消息解析。`, turn_id: turnId },
      minutes,
    )
    if (i === 4) anchor = q.id
    w.add(
      {
        role: 'assistant',
        content: `第 ${i + 1} 轮完成：处理了${['卡片', '文件', '红包', '位置', '骰子', '合并转发'][i]}消息段。`,
        turn_id: turnId,
      },
      minutes - 2,
    )
  }
  w.thread.compactSummary = message({
    id: `${CONV.compact}-summary`,
    conversation_id: CONV.compact,
    role: 'user',
    content:
      '此前的对话摘要：用户在逐轮完善 OneBot 引用消息的解析，已覆盖卡片、文件、红包和位置消息段；约定未知消息段不得静默丢弃。',
    created_at: ago(1100, now),
    parent_id: null,
    is_compact_summary: true,
    compact_anchor_id: anchor,
    sort_order: 100,
  })
  return w.thread
}

function simpleThread(id: string, now: number, minutes: number, q: string, a: string): DemoThread {
  const w = new Writer(id, now)
  const t = `${id}-turn`
  w.turn(t, minutes)
  w.add({ role: 'user', content: q, turn_id: t }, minutes)
  w.add({ role: 'assistant', content: a, turn_id: t }, minutes - 1)
  return w.thread
}

export function buildProjects(now: number): ProjectInfoResponse[] {
  return [
    {
      id: PROJECT_MERIDIAN,
      name: 'Meridian',
      path: DEMO_ROOT,
      source_type: 'local',
      source_id: null,
      assistant_id: null,
      description: '多服务商 AI 桌面客户端',
      created_at: ago(60 * 24 * 30, now),
      updated_at: ago(20, now),
    },
    {
      id: PROJECT_FIRMWARE,
      name: 'Keypad 固件',
      path: 'C:\\Users\\demo\\Code\\keypad-fw',
      source_type: 'local',
      source_id: null,
      assistant_id: null,
      description: null,
      created_at: ago(60 * 24 * 60, now),
      updated_at: ago(60 * 24 * 2, now),
    },
  ]
}

export function buildThreads(now: number): Record<string, DemoThread> {
  return {
    [CONV.rich]: richThread(now),
    [CONV.approval]: approvalThread(now),
    [CONV.ask]: askThread(now),
    [CONV.plan]: planThread(now),
    ...delegateThreads(now),
    [CONV.stickers]: stickerThread(now),
    [CONV.compact]: compactThread(now),
    [CONV.pinned]: simpleThread(
      CONV.pinned,
      now,
      60 * 24 * 3,
      'Rust 里 `Arc<Mutex<T>>` 和 `Arc<RwLock<T>>` 怎么选？',
      '读远多于写、且临界区不短时用 `RwLock`；否则 `Mutex` 更简单、开销也更低。注意 `RwLock` 在写饥饿上的平台差异。',
    ),
    [CONV.firmware]: simpleThread(
      CONV.firmware,
      now,
      60 * 24 * 2,
      'LVGL 的按钮在低温下响应变慢，可能是什么原因？',
      '优先排查触摸控制器在低温下的扫描周期和 I²C 时钟，其次是 LVGL 的 `indev` 读取周期是否被阻塞任务拖慢。',
    ),
    [CONV.archived]: simpleThread(
      CONV.archived,
      now,
      60 * 24 * 40,
      '帮我写一封请假邮件。',
      '好的，下面是一封简洁的请假邮件草稿……',
    ),
    [CONV.empty]: emptyThread(),
  }
}

export function buildConversations(now: number, threads: Record<string, DemoThread>): ConversationInfoResponse[] {
  const meta = (id: string, over: Partial<ConversationInfoResponse> & Pick<ConversationInfoResponse, 'title'>) => {
    const thread = threads[id]
    const last = thread.all.reduce((max, m) => Math.max(max, m.created_at), 0)
    return conversation({
      id,
      updated_at: last || ago(5, now),
      created_at: thread.all[0]?.created_at ?? ago(5, now),
      message_count: thread.all.length,
      head_message_id: thread.head,
      ...over,
    })
  }
  return [
    meta(CONV.ask, { title: '设置页导出入口', project_id: PROJECT_MERIDIAN }),
    meta(CONV.approval, { title: 'release 构建体积', project_id: PROJECT_MERIDIAN }),
    meta(CONV.rich, { title: '流式输出时回答写在屏幕外', project_id: PROJECT_MERIDIAN, thinking_level: 'high' }),
    meta(CONV.plan, { title: '导出功能计划', project_id: PROJECT_MERIDIAN, mode: 'plan' }),
    meta(CONV.delegate, { title: 'Android 键盘遮挡输入框', project_id: PROJECT_MERIDIAN }),
    meta(CONV.subExplore, {
      title: '调查键盘遮挡的布局链',
      project_id: PROJECT_MERIDIAN,
      parent_conversation_id: CONV.delegate,
      spawned_by_call_id: 'call-agent-explore',
      spawned_turn_id: 'demo-turn-sub-explore',
      agent_kind: 'explore',
    }),
    meta(CONV.subAgent, {
      title: '给 Sidebar.Main 加 min-h-0',
      project_id: PROJECT_MERIDIAN,
      parent_conversation_id: CONV.delegate,
      spawned_by_call_id: 'call-agent-fix',
      spawned_turn_id: 'demo-turn-sub-agent',
      agent_kind: 'agent',
    }),
    meta(CONV.stickers, { title: '配色和贴纸' }),
    meta(CONV.compact, { title: 'OneBot 引用消息解析' }),
    meta(CONV.pinned, { title: 'Mutex 还是 RwLock', is_pinned: true }),
    meta(CONV.firmware, { title: '低温下按钮响应慢', project_id: PROJECT_FIRMWARE }),
    meta(CONV.archived, { title: '请假邮件', is_archived: true }),
    meta(CONV.empty, { title: null }),
  ]
}
