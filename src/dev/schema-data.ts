/**
 * Meridian 数据库模型 —— 画布与文档的唯一数据源。
 *
 * 由 src-tauri/crates/core/migrations/00000000000001_initial …
 * 00000000000033_auto_review 与 src-tauri/crates/core/src/db/ 归纳而成。
 *
 * 一半是散文，只有人能写：为什么 parent_id 不建外键、为什么两个 cache 列上 NULL 和 0
 * 是不同的答案、为什么价格要抄到审计行上。另一半是纯结构，由
 * scripts/check-db-schema.mjs 拿迁移重放着核对——那半边一旦漂移，整份文档就开始
 * 很有说服力地骗人。改了 migrations/ 就要改这里，pre-commit 会拦。
 *
 * 说明文字里只认两个标记：<code>…</code> 与 <b>…</b>，由 schema-lab 的 richText 渲染。
 */

/** 列上的约束标记。UQ 含部分唯一索引，IDX 含复合索引里的参与列。 */
export type SchemaFlag = 'PK' | 'FK' | 'NN' | 'NULL' | 'UQ' | 'IDX'

/** 紧凑的列字面量：[字段名, 类型, 约束, 默认值, 说明]。省得每列写五个键名。 */
export type RawColumn = [name: string, type: string, flags: SchemaFlag[], def: string, desc: string]

export interface SchemaColumn {
  name: string
  type: string
  flags: SchemaFlag[]
  /** 给人看的形式：'—' 表示没有默认值，'NULL' 表示可空列的天然默认。 */
  def: string
  desc: string
}

export interface SchemaGroup {
  id: string
  title: string
  /** 画布上节点的色条，也是 minimap 的颜色。 */
  color: string
  desc: string
}

interface RawTable {
  name: string
  group: string
  title: string
  /** 建这张表的迁移序号。后续 ALTER 不记在这里，列说明里会写。 */
  mig: number
  tags?: string[]
  legacy?: boolean
  /** 值得先看一眼的列。只加重，不折叠——节点上所有列都画出来。 */
  show: string[]
  note?: string
  cols: RawColumn[]
  rels?: string[]
  rules?: string[]
}

export interface SchemaTable extends Omit<RawTable, 'cols'> {
  cols: RawColumn[]
  columns: SchemaColumn[]
  pk: string[]
  /** 画布坐标与高度，由下面的布局算出，不手写。 */
  x: number
  y: number
  h: number
}

export interface SchemaEdge {
  from: string
  col: string
  to: string
  toCol: string
  /**
   * fk = 数据库强制的外键；soft = 代码维护的逻辑引用，故意不建外键；
   * broken = 库里真的有这条外键，但它指向一张<b>不存在的表</b>，所以它什么也约束不了。
   *
   * `broken` 不是给注释用的形容词：画布按它把线画成断的，`check-db-schema.mjs`
   * 按它去和真实 schema 对账——一条边标成 broken 而库里其实好着，或者反过来，都会报错。
   * 光在旁边写一句说明是不够的，线本身画得像一条正常外键，看图的人就会当它是。
   */
  kind: 'fk' | 'soft' | 'broken'
  /** ON DELETE 行为（fk 与 broken 都只写这个），或 soft 边的一句话说明。 */
  act: string
  /**
   * broken 专用：它**实际**指向的那张已经不存在的表。
   *
   * `to` 是本意（校验器拿它跟还原后的 SQL 比对），这一列是现实——画布连的是这一头，
   * 连到 `to` 上就等于用一条线声称「它引用着那张好好存在的表」，而那正是不成立的事。
   */
  actualTarget?: string
  self?: boolean
}

/**
 * 墓碑：一张已经不在库里、却仍被某条外键指着的表。
 *
 * 它必须在图上占一个位置，否则那条断掉的边只能连回现存的表，而线的两端本身就是
 * 一句陈述——红色和标签都盖不过它。摆在最左边、所有列之外，因为它就在体系之外。
 */
export interface SchemaGhost {
  /** 节点 id，与表名分开：表名可能和某张真表重名，id 不能。 */
  id: string
  name: string
  /** 还指着它的那张表。 */
  referencedBy: string
  x: number
  y: number
  h: number
}

export const ghostId = (name: string) => `ghost:${name}`

export const GROUPS: SchemaGroup[] = [
  {
    id: 'conv',
    title: '会话与消息',
    color: '#6ea8fe',
    desc: '主干：一个会话挂一棵消息树，每次运行写一条 turn。删会话级联带走 messages / turns / mode_artifacts / todo_lists，唯独带不走 audit_messages。',
  },
  {
    id: 'provider',
    title: '供应商与模型',
    color: '#7ee0b3',
    desc: '谁来回答、窗口多大、多少钱。密钥不在库里——走 keyring（service「meridian」）与 secrets 后端。',
  },
  {
    id: 'memory',
    title: '记忆',
    color: '#c9a3f0',
    desc: '四层并列作用域：项目 / 客户端全局 / OneBot 全局 / 人物。scope 是多态的，所以这里故意没有外键。',
  },
  {
    id: 'task',
    title: '任务、计划与项目',
    color: '#f2b56b',
    desc: '会话工作过程中产生的东西：清单、待批准的计划，以及会话挂靠的项目 / 会话来源。',
  },
  { id: 'tools', title: '工具、技能与 MCP', color: '#7fb3c8', desc: '模型能调什么、要不要问人，以及技能的三层绑定。' },
  {
    id: 'sticker',
    title: '表情与贴纸',
    color: '#f0a3c0',
    desc: '本地表情包，加上 OneBot 自动收集的原生表情——后者要先确认语义才允许助手发。',
  },
  {
    id: 'audit',
    title: '审计与计费',
    color: '#e3c76a',
    desc: '唯一一张删会话删不掉的表。谁说了什么、花了多少钱，按当时的价格记账。',
  },
  { id: 'sys', title: '系统', color: '#9aa4b4', desc: '一张全局 key/value 表，承载了远比它看起来要多的权限语义。' },
]

const RAW_TABLES: RawTable[] = [
  // ── 会话与消息 ────────────────────────────────────────────────
  {
    name: 'conversations',
    group: 'conv',
    title: '会话',
    mig: 1,
    tags: ['自引用（子 agent）', 'ACP 托管'],
    show: [
      'id',
      'assistant_id',
      'project_id',
      'head_message_id',
      'parent_conversation_id',
      'spawned_by_message_id',
      'spawned_turn_id',
      'mode',
      'agent_kind',
    ],
    note: '普通会话、子 agent 会话、ACP 托管的 Claude Code 会话、两个 hook 审查会话都是这张表的行，靠 parent_conversation_id / agent_kind 区分。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', 'UUID'],
      ['title', 'TEXT', ['NULL'], 'NULL', 'NULL 表示还没生成标题'],
      ['assistant_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>assistants(id)</code> ON DELETE SET NULL'],
      ['is_pinned', 'INTEGER', ['NN'], '0', '0/1；与 updated_at 组成侧边栏排序索引'],
      ['is_archived', 'INTEGER', ['NN'], '0', '0/1'],
      ['message_count', 'INTEGER', ['NN'], '0', '<b>由触发器维护</b>，不要手写：messages 的插入/删除触发器加减它'],
      ['created_at', 'BIGINT', ['NN'], '—', 'epoch ms'],
      ['updated_at', 'BIGINT', ['NN', 'IDX'], '—', '插入消息的触发器会把它推到该消息的 created_at'],
      ['project_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>projects(id)</code> ON DELETE SET NULL（迁移 3）'],
      [
        'compact_cursor',
        'INTEGER',
        ['NULL'],
        'NULL',
        '<b>遗留</b>：迁移 21 之后压缩边界改由 <code>messages.compact_anchor_id</code> 表达，分支交错时 sort_order 阈值不再成立',
      ],
      ['thinking_level', 'TEXT', ['NULL'], 'NULL', 'NULL = 继承助手默认；如 <code>low/medium/high/xhigh</code>'],
      ['fast_mode', 'INTEGER', ['NN'], '0', '0/1'],
      [
        'mode',
        'TEXT',
        ['NULL'],
        'NULL',
        'NULL 或未知值都读作 <code>work</code>；另一个取值是 <code>plan</code>（<code>agent::modes::resolve</code>）',
      ],
      [
        'head_message_id',
        'TEXT',
        ['FK', 'NULL'],
        'NULL',
        '→ <code>messages(id)</code> ON DELETE SET NULL；活动路径的叶子。NULL 回退到 sort_order 最大的行',
      ],
      ['accept_edits', 'INTEGER', ['NN'], '0', '0/1；<b>故意不并进 mode</b>：mode 说处于哪个阶段，这个说少问哪些批准'],
      [
        'parent_conversation_id',
        'TEXT',
        ['NULL'],
        'NULL',
        '<b>无外键</b>。非 NULL 就是「这是子 agent 会话」的全部判据：不进侧边栏，只能从父会话的卡片进入',
      ],
      ['spawned_by_message_id', 'TEXT', ['NULL'], 'NULL', '派生它的那次工具调用所在的 assistant 行'],
      [
        'spawned_by_call_id',
        'TEXT',
        ['NULL'],
        'NULL',
        'provider 的 call id，<b>会重复</b>（有网关每次请求都从 "0" 开始编号），所以必须与上一列成对匹配',
      ],
      ['spawned_turn_id', 'TEXT', ['NULL'], 'NULL', '被委派的那一次运行，钉死；父卡片只报告这一条 turn'],
      [
        'agent_kind',
        'TEXT',
        ['NULL'],
        'NULL',
        '<code>explore</code> | <code>agent</code> | <code>claude_code</code>（ACP） | <code>plan_review</code> | <code>impl_review</code>（hook 审查）',
      ],
      [
        'agent_provider_id',
        'TEXT',
        ['NULL'],
        'NULL',
        '子 agent 实际跑的供应商，普通会话恒为 NULL（模型选择只在前端 state 里）',
      ],
      ['agent_model_id', 'TEXT', ['NULL'], 'NULL', '同上，与前一列成对'],
    ],
    rels: [
      '被 <code>messages</code>、<code>turns</code>、<code>mode_artifacts</code>、<code>todo_lists</code> 以 <b>ON DELETE CASCADE</b> 引用。',
      '与 <code>messages</code> 互相引用：<code>head_message_id</code> 指向叶子，<code>messages.conversation_id</code> 指回来。',
      '<code>agent_kind</code> 是 hook 审查端点校验客户端传来的 conversation_id 的<b>唯一凭据</b>——没有它，任何本地进程都能让审查者往用户自己的会话里追加内容。',
    ],
    rules: [
      '<code>parent_conversation_id</code> 非空 ⇒ <code>spawned_by_message_id</code> + <code>spawned_by_call_id</code> + <code>spawned_turn_id</code> 应同时有值。',
      '<code>agent_provider_id</code> 与 <code>agent_model_id</code> <b>要么都有要么都没有</b>：<code>Conversation::pin_model</code> 只在两个都非空白时才覆盖助手，并且<b>同时把 assistant.context_limit 置 0</b>——否则 <code>resolve_turn_params</code> 会优先用父会话的窗口值，看起来换了模型其实没换。',
      '<code>message_count</code> 与 messages 实际行数由触发器保持一致；绕过 ops 直接删消息会让它漂移。',
      '<code>head_message_id</code> 必须是本会话的行，且只应通过 <code>append_message</code> 在同一事务里连边 + 移头。',
    ],
  },
  {
    name: 'messages',
    group: 'conv',
    title: '消息（一棵树，按一条路径读）',
    mig: 1,
    tags: ['树', 'parent_id 无外键'],
    show: [
      'id',
      'conversation_id',
      'parent_id',
      'compact_anchor_id',
      'turn_id',
      'provider_id',
      'role',
      'tool_call_id',
      'tool_outcome',
    ],
    note: '重生成/编辑写<b>兄弟节点</b>而不是覆盖，原行仍可达。读会话用 <code>db::ops::message::active_context</code> 走路径，别按 sort_order 排——分支交错后它只是插入顺序。删除只能整棵子树删。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', 'UUID'],
      ['conversation_id', 'TEXT', ['FK', 'NN', 'IDX'], '—', '→ <code>conversations(id)</code> ON DELETE CASCADE'],
      [
        'role',
        'TEXT',
        ['NN'],
        '—',
        '<code>user</code> | <code>assistant</code> | <code>tool</code> | <code>context</code>。<b><code>context</code> 是冻结的记忆块</b>，不是人说的话——半打地方按 role 分流（压缩、审计拷贝、标题生成、前端）；上线到 wire 时由 <code>push_history_message</code> 翻译成 <code>user</code>，且字节必须与首次注入时完全一致，否则缓存在这一行断掉',
      ],
      ['content', 'TEXT', ['NN'], "''", '纯文本；带附件时是 OpenAI 风格 parts 的 JSON 数组'],
      ['provider_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>providers(id)</code> ON DELETE SET NULL'],
      ['model_id', 'TEXT', ['NULL'], 'NULL', '无外键的快照字符串，一直如此'],
      ['input_tokens', 'INTEGER', ['NULL'], 'NULL', '提示 token，<b>每个只计一次</b>'],
      ['output_tokens', 'INTEGER', ['NULL'], 'NULL', ''],
      ['tool_calls', 'TEXT', ['NULL'], 'NULL', 'JSON 数组，只在 assistant 行'],
      ['tool_call_id', 'TEXT', ['NULL'], 'NULL', '只在 tool 行，回指某个 call id'],
      [
        'sort_order',
        'INTEGER',
        ['NN', 'IDX'],
        '0',
        '<b>触发器分配</b>（插入时 0 会被改写为该会话最大值 +1）。是插入顺序，<b>不是</b> transcript 位置',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', 'epoch ms'],
      ['reasoning_content', 'TEXT', ['NULL'], 'NULL', '可见的思维链（迁移 12）'],
      ['rating', 'INTEGER', ['NULL'], 'NULL', '用户评价，NULL = 未评价'],
      ['schema_version', 'INTEGER', ['NN'], '1', '消息体格式版本'],
      [
        'is_compact_summary',
        'INTEGER',
        ['NN'],
        '0',
        '0/1；压缩摘要行，历史上 sort_order 为 -1，<b>不在树上</b>（parent_id 为空、turn_id 为空）',
      ],
      [
        'sender_id',
        'BIGINT',
        ['NULL'],
        'NULL',
        '平台身份（QQ）。桌面聊天、assistant/tool 行、身份流水线之前的行都是 NULL',
      ],
      [
        'parent_id',
        'TEXT',
        ['NULL', 'IDX'],
        'NULL',
        '<b>故意没有 REFERENCES</b>（迁移 21）：外键是立即校验的，整棵子树的删除是一条语句、SQLite 逐行检查，父行先走就会撞上还没删的子行；CASCADE 又会一层层递归到触发器深度上限',
      ],
      [
        'compact_anchor_id',
        'TEXT',
        ['FK', 'NULL'],
        'NULL',
        '→ <code>messages(id)</code> ON DELETE CASCADE；只在摘要行上：这条摘要挡在路径上的哪条消息前面。锚点不在活动路径上，这条摘要就直接不生效',
      ],
      [
        'source',
        'TEXT',
        ['NULL'],
        'NULL',
        'NULL = 打字；<code>voice</code> = 离线语音转写（可能有同音字错误，agent 层据此宽容处理）',
      ],
      [
        'turn_id',
        'TEXT',
        ['NULL'],
        'NULL',
        '<b>无外键</b>（同 parent_id 的理由）。压缩摘要为 NULL：摘要代替历史，比它替掉的那些 turn 活得久',
      ],
      [
        'tool_outcome',
        'TEXT',
        ['NULL'],
        'NULL',
        '只在 tool 行：<code>success</code> | <code>denied</code> | <code>error</code>。<b>NULL 读作 success</b>——没有它，一次拒绝从库里读出来和一个结果长得一模一样',
      ],
      [
        'cache_read_tokens',
        'INTEGER',
        ['NULL'],
        'NULL',
        '命中缓存的提示 token，<b>是 input_tokens 的子集，不是加项</b>',
      ],
      [
        'cache_write_tokens',
        'INTEGER',
        ['NULL'],
        'NULL',
        '写入缓存的提示 token，同为子集。与读分开存：读是折扣，写是溢价（Anthropic 5 分钟 1.25×、1 小时 2×），相加会把「建了大缓存却没复用」报告成省了钱',
      ],
      [
        'server_tool_calls',
        'INTEGER',
        ['NULL'],
        'NULL',
        '服务商自己执行的、<b>计费的</b>工具调用次数（迁移 37）。不是 token：按次收费，在 token 之外。已排除免费的那几种（搜索中的图片理解、MCP）。<code>audit::record</code> 只拿得到一行 message，所以这个数必须先落在这里才能进账',
      ],
      [
        'provider_name',
        'TEXT',
        ['NULL'],
        'NULL',
        '写入当时供应商叫什么。存名字而不是 join，因为 provider_id 的外键是 SET NULL，删掉供应商会悄悄改写全部历史归属',
      ],
      [
        'provider_state',
        'TEXT',
        ['NULL'],
        'NULL',
        '供应商返回的<b>不透明续接状态</b>，版本化 JSON。只属于持久化层，不进前端 DTO、不进导出（迁移 31）',
      ],
      [
        'auto_review',
        'TEXT',
        ['NULL'],
        'NULL',
        '自动批准审查的裁决，<b>按 call id 建键</b>的 JSON：<code>{"call_abc":{outcome,risk,authorization,rationale,stage,model,evidence,usage}}</code>。审查的<b>花费</b>不在这里，在 audit_messages（迁移 33）',
      ],
    ],
    rels: [
      '自引用两次：<code>parent_id</code>（逻辑边，无外键）与 <code>compact_anchor_id</code>（真外键，只有一层深，不会链式递归）。',
      '被 <code>conversations.head_message_id</code> 反向引用（SET NULL）。',
      '被 <code>message_stickers.message_id</code> 以 CASCADE 引用。',
      '<code>attachments</code>（迁移 1）曾以 CASCADE 引用它，<b>现已无任何代码读写</b>。',
    ],
    rules: [
      '<b>NULL ≠ 0</b>（两个 cache 列）：NULL 是「上游没提缓存」，0 是「上游说没命中」。把前者当后者，会把所有沉默供应商的回复报告成 100% 未命中——那是关于供应商的断言，不是关于数据的。',
      '<code>cache_read_tokens + cache_write_tokens ≤ input_tokens</code>：各家上游口径不同（DeepSeek 的 prompt_tokens 已含命中，Anthropic 的 input_tokens 两个都不含），归一化发生在解析响应处，到这张表时只有一种形状。',
      "<code>role='tool'</code> ⇒ <code>tool_call_id</code> 有值；<code>tool_calls</code> 只出现在 <code>role='assistant'</code>。",
      '<code>is_compact_summary=1</code> ⇒ <code>compact_anchor_id</code> 有值、<code>turn_id</code> 为 NULL、不在 parent 链上。',
      '只通过 <code>append_message</code> 写（连边 + 移动 head 在同一事务）；只删整棵子树——单删一行会让工具结果变孤儿、或留下一个没有提问的回答。',
    ],
  },
  {
    name: 'turns',
    group: 'conv',
    title: '回合（崩溃后还能诚实回答「它死在哪」）',
    mig: 25,
    tags: ['崩溃可读'],
    show: ['id', 'conversation_id', 'origin', 'status', 'phase', 'reported_at', 'parent_reported_at'],
    note: '回合以前只活在函数栈上。这张表在<b>动手之前</b>先写下要做什么，所以最后停留的 phase 就是它死的地方。<code>running</code> 只可能属于写它的那个进程——启动时读到 running 行，按定义就是被打断的。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['conversation_id', 'TEXT', ['FK', 'NN', 'IDX'], '—', '→ <code>conversations(id)</code> ON DELETE CASCADE'],
      ['origin', 'TEXT', ['NN'], '—', '<code>desktop</code> | <code>onebot</code>'],
      [
        'status',
        'TEXT',
        ['NN'],
        '—',
        '<code>running</code> | <code>done</code> | <code>cancelled</code>（用户按停止） | <code>failed</code> | <code>interrupted</code>（只由启动时的对账写入）',
      ],
      [
        'phase',
        'TEXT',
        ['NULL'],
        'NULL',
        '<code>streaming</code> | <code>awaiting_approval</code> | <code>running_tool</code> | <code>compacting</code>。正常结束的回合读它没有意义；<b><code>running_tool</code> 是要紧的那个</b>——库外的世界可能已经变了',
      ],
      ['phase_tool', 'TEXT', ['NULL'], 'NULL', 'phase 指的是哪个工具'],
      [
        'error',
        'TEXT',
        ['NULL'],
        'NULL',
        'failed 的原因；不是面向用户的文案。特殊常量 <code>loop_detected</code> 表示循环守卫掐断',
      ],
      ['started_at', 'BIGINT', ['NN', 'IDX'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
      ['ended_at', 'BIGINT', ['NULL'], 'NULL', 'NULL = 没走到自己的结尾'],
      [
        'reported_at',
        'BIGINT',
        ['NULL'],
        'NULL',
        '打断通知<b>真正送达模型</b>的时间（读完了一条回复才算，仅仅发出去不算——有的供应商会 200 之后在 SSE 里拒绝）。NULL = 还欠着这次告知（迁移 26）',
      ],
      [
        'parent_reported_at',
        'BIGINT',
        ['NULL'],
        'NULL',
        '「派生它的那个会话已被告知」。<b>两本账不能合一</b>：谁先读完回复谁就替所有人清账，用户去子会话说一句话，父会话就永远学不到某个文件可能只写了一半（迁移 27）',
      ],
      [
        'self_id',
        'BIGINT',
        ['NULL'],
        'NULL',
        '哪个 bot 账号应答的。桌面回合恒 NULL——这是<b>陈述</b>而不是缺口（迁移 30）',
      ],
    ],
    rels: [
      '<code>messages.turn_id</code> 指向它，但<b>没有外键</b>：删会话时 turns 和 messages 在同一次级联里、顺序不保证。',
      '<code>conversations.spawned_turn_id</code> 钉住其中一条。',
    ],
    rules: [
      '<code>parent_reported_at</code> 只在子 agent 的回合上有值。深度天然为 1（子 agent 拿不到 <code>run_agent</code> 工具），一旦允许嵌套，这一列就必须变成 <code>(turn_id, recipient, reported_at)</code> 表。',
      '什么都不从析构函数里写：被 kill 时析构不会跑，而<b>把行留在 running 本身就是记录</b>。',
      "<code>status='failed'</code> ⇒ <code>error</code> 通常有值；<code>ended_at</code> 为 NULL ⇒ 该回合没有正常收尾。",
    ],
  },
  {
    name: 'attachments',
    group: 'conv',
    title: '附件（遗留死表）',
    mig: 1,
    tags: ['legacy'],
    legacy: true,
    show: ['id', 'message_id', 'file_path', 'mime_type'],
    note: '迁移 1 建的表，<b>今天没有任何 Rust 代码读写它</b>，Diesel 的 schema.rs 里也没有它。附件现在作为 OpenAI 风格 parts 存在 <code>messages.content</code> 的 JSON 里。表还在库里只是因为没人写删除它的迁移。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['message_id', 'TEXT', ['FK', 'NN', 'IDX'], '—', '→ <code>messages(id)</code> ON DELETE CASCADE'],
      ['file_name', 'TEXT', ['NN'], '—', ''],
      ['file_path', 'TEXT', ['NN'], '—', ''],
      ['mime_type', 'TEXT', ['NN'], '—', ''],
      ['file_size', 'BIGINT', ['NN'], '—', '字节'],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['仅 <code>messages</code> 一条边，且不再有代码走它。'],
    rules: ['新代码不要往这里写；要加附件表得先决定它与 content parts 的关系。'],
  },

  // ── 供应商与模型 ──────────────────────────────────────────────
  {
    name: 'providers',
    group: 'provider',
    title: '供应商',
    mig: 1,
    show: ['id', 'name', 'base_url', 'api_format'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', '会被 messages / audit_messages 快照下来'],
      ['provider_type', 'TEXT', ['NN'], "'openai'", '供应商族'],
      ['base_url', 'TEXT', ['NN'], '—', 'OpenAI 兼容 base URL'],
      ['is_enabled', 'INTEGER', ['NN'], '1', '0/1'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
      ['api_format', 'TEXT', ['NN'], "'chat_completions'", '线上协议形状，决定走哪套解析（迁移 10）'],
    ],
    rels: [
      '<code>assistants.provider_id</code>、<code>messages.provider_id</code> → <b>SET NULL</b>。',
      '<code>model_configs.provider_id</code>、<code>cached_models.provider_id</code> → <b>CASCADE</b>。',
    ],
    rules: [
      '<b>API key 不在这张表、不在任何表里</b>。',
      '因为删除是 SET NULL，历史归属必须靠快照列保住：<code>messages.provider_name</code>、<code>audit_messages.provider_name</code>。两者与本表不一致是<b>预期</b>——改名之后旧行留旧名。',
    ],
  },
  {
    name: 'model_configs',
    group: 'provider',
    title: '模型窗口与价格',
    mig: 15,
    show: ['id', 'provider_id', 'model_id', 'context_window', 'input_price', 'output_price'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['provider_id', 'TEXT', ['FK', 'NN', 'UQ'], '—', '→ <code>providers(id)</code> ON DELETE CASCADE'],
      ['model_id', 'TEXT', ['NN', 'UQ'], '—', '与上一列组成 <code>UNIQUE(provider_id, model_id)</code>'],
      ['display_name', 'TEXT', ['NULL'], 'NULL', ''],
      ['context_window', 'INTEGER', ['NN'], '—', '上下文窗口 token 数'],
      ['compact_threshold', 'INTEGER', ['NN'], '—', '触发自动压缩的阈值'],
      ['max_output_tokens', 'INTEGER', ['NULL'], 'NULL', ''],
      ['input_price', 'REAL', ['NN'], '0', '每百万 token 价格'],
      ['output_price', 'REAL', ['NN'], '0', '每百万 token 价格'],
      ['cache_price', 'REAL', ['NULL'], 'NULL', '缓存<b>读</b>价'],
      [
        'cache_write_price',
        'REAL',
        ['NULL'],
        'NULL',
        '缓存<b>写</b>价（迁移 30）。NULL = 按普通 input 计价。<b>是价格不是倍率</b>——绝对价与系数混用迟早出单位错误',
      ],
      ['capability_overrides', 'TEXT', ['NULL'], 'NULL', 'JSON，手动覆盖能力探测（迁移 16）'],
      [
        'price_tiers',
        'TEXT',
        ['NULL'],
        'NULL',
        'JSON 数组，prompt 超过某尺寸后接管的整套费率（迁移 35）。NULL = 各尺寸同价。只经 <code>parse_tiers</code> 读取，它会排序并丢弃读不懂的条目',
      ],
      [
        'server_tools',
        'TEXT',
        ['NULL'],
        'NULL',
        'JSON 数组，服务商自己执行的工具（迁移 36），如 <code>["web_search"]</code>。只在 Responses API 上存在；每轮与 <code>ProviderCapabilities::server_tools</code> 取交集后才发出',
      ],
      [
        'server_tool_price',
        'REAL',
        ['NULL'],
        'NULL',
        '服务商自带工具的<b>每千次调用</b>价（迁移 37）。<b>不是 token 价</b>：xAI 的联网搜索 / X 搜索 / 代码执行都是每 1000 次 $5，在 token 之外另计。NULL = 没人填过，不等于免费',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['<code>providers</code>（CASCADE）。价格<b>不</b>被 audit_messages 以 join 方式使用——那边自带写入时快照。'],
    rules: [
      '<code>0/0</code> 的价格是<b>还没填</b>，不是免费（编辑器就是从 0 打开的）：<code>Prices::known()</code> 是唯一判定，不合格的流量计入 <code>unpriced_messages</code> 并显式呈现。',
      '计价只有一处实现 <code>agent::pricing::compute_cost</code>：<b>命中缓存的 token 按缓存价计，而不是在 input 价之上再加</b>。旧公式曾把 90% 命中率的 DeepSeek 回合报成实际花费的近 6 倍。',
      '<code>compact_threshold</code> 应 &lt; <code>context_window</code>；助手上非 0 的 <code>context_limit</code> 会覆盖此处的窗口。',
      '<b>阶梯定价按整个 prompt 判档，越线后整笔请求重新计价</b>，不是只对超出部分——xAI / Gemini / OpenAI 都这么做。按累进税率去理解会算少将近一个基础价。判档口径含命中缓存的部分。',
      '<b>档位在写 <code>audit_messages</code> 那一刻定下，不在读的时候</b>：报表侧只有 <code>SUM</code>，那里已经没有"单次请求的 prompt 有多大"这个数了。所以 audit 那四列快照的是<b>命中档位的费率</b>，跨档在报表里看起来就是一次改价——那是它本来就会处理的情况。',
      '<code>server_tools</code> 每轮都要与模型当前能力<b>取交集</b>而不是直接读：把模型从 Responses 换成 chat-completions 后这一列还留着 <code>["web_search"]</code>，而 xAI 对不认识的工具类型直接回 422——不收窄的话，一个过期设置会让<b>每一次请求</b>都失败。',
      '打开服务商自带的 <code>web_search</code> 会把内置的那个从本轮工具集里摘掉（<code>turn_config</code>）。同时给模型两个搜索工具不只是浪费：内置那个要弹批准卡、还需要 Tavily key，模型选中它就等于先问一遍再失败。',
    ],
  },
  {
    name: 'cached_models',
    group: 'provider',
    title: '/models 拉取缓存',
    mig: 14,
    show: ['id', 'provider_id', 'model_id', 'fetched_at'],
    cols: [
      ['id', 'INTEGER', ['PK'], 'AUTOINCREMENT', '全库仅有的两个自增主键之一'],
      ['provider_id', 'TEXT', ['FK', 'NN', 'IDX', 'UQ'], '—', '→ <code>providers(id)</code> ON DELETE CASCADE'],
      ['model_id', 'TEXT', ['NN', 'UQ'], '—', '<code>UNIQUE(provider_id, model_id)</code>'],
      ['model_name', 'TEXT', ['NN'], '—', ''],
      ['fetched_at', 'BIGINT', ['NN'], '—', '拉取时间，决定是否过期'],
    ],
    rels: [
      '<code>providers</code>（CASCADE）。与 <code>model_configs</code> <b>无</b>约束关系：一个是发现结果，一个是用户配置。',
    ],
    rules: ['纯缓存，可整表重建。'],
  },
  {
    name: 'assistants',
    group: 'provider',
    title: '助手',
    mig: 1,
    show: ['id', 'name', 'provider_id', 'model_id', 'tool_preset_id', 'context_limit'],
    note: '一套系统提示 + 模型 + 参数 + 工具面。会话可以覆盖其中一部分。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['description', 'TEXT', ['NULL'], 'NULL', ''],
      ['avatar', 'TEXT', ['NULL'], 'NULL', ''],
      ['system_prompt', 'TEXT', ['NN'], "''", ''],
      ['provider_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>providers(id)</code> SET NULL'],
      ['model_id', 'TEXT', ['NULL'], 'NULL', '快照字符串，无外键'],
      [
        'temperature',
        'REAL',
        ['NULL'],
        'NULL',
        '<b>缺配置就报错，不塞默认值</b>：请求参数统一由 <code>resolve_turn_params</code> 决定',
      ],
      ['top_p', 'REAL', ['NULL'], 'NULL', '同上'],
      ['max_tokens', 'INTEGER', ['NULL'], 'NULL', '同上'],
      ['is_default', 'INTEGER', ['NN'], '0', '0/1；<b>应只有一行为 1</b>，靠应用层保证，没有唯一索引'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
      ['context_limit', 'INTEGER', ['NN'], '128000', '非 0 时<b>优先于</b> model_configs.context_window（迁移 2）'],
      ['compact_keep_recent', 'INTEGER', ['NN'], '10', '压缩时保留最近几条'],
      ['enabled_tools', 'TEXT', ['NULL'], 'NULL', 'JSON 字符串数组（迁移 4）'],
      ['thinking_enabled', 'INTEGER', ['NN'], '0', '0/1（迁移 5）'],
      ['thinking_budget', 'INTEGER', ['NULL'], 'NULL', '只有 thinking_enabled=1 时才被读'],
      ['tool_preset_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>tool_presets(id)</code> SET NULL（迁移 8）'],
      ['auto_compact_enabled', 'INTEGER', ['NN'], '0', '0/1（迁移 13）'],
    ],
    rels: [
      '→ <code>providers</code>、<code>tool_presets</code>（都是 SET NULL）。',
      '被 <code>conversations</code>、<code>projects</code>（SET NULL）、<code>assistant_emoji_packs</code>、<code>skill_bindings_assistant</code>（CASCADE）引用。',
    ],
    rules: [
      '<code>provider_id</code> 与 <code>model_id</code> 要成对才可用。',
      '实际工具面 = <code>enabled_tools</code> ∩ <code>tool_preset_id</code> 指向的集合 ∩ 当前 mode 的白名单。',
      '<code>Conversation::pin_model</code> 在读出助手后可能就地改写 provider/model 并把 <code>context_limit</code> 归零——这是子 agent 会话钉模型的路径，落库的助手行不变。',
    ],
  },

  // ── 记忆 ─────────────────────────────────────────────────────
  {
    name: 'memories',
    group: 'memory',
    title: '记忆条目',
    mig: 19,
    tags: ['多态 scope', '软删除'],
    show: ['id', 'scope_type', 'scope_id', 'subject_scope_id', 'origin', 'visibility', 'deleted_at'],
    note: '迁移 11 建表、迁移 19 重建：单一的 project_id 锚点换成 (scope_type, scope_id)，同时引入 origin / visibility 两条正交的可见性规则。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      [
        'scope_type',
        'TEXT',
        ['NN', 'UQ'],
        '—',
        '<code>project</code> | <code>client_global</code> | <code>onebot_global</code> | <code>onebot_user</code>。<b>客户端全局与 OneBot 全局是兄弟根，互不注入</b>',
      ],
      [
        'scope_id',
        'TEXT',
        ['NN', 'UQ'],
        '—',
        "项目 UUID | 全局哨兵 <code>'_'</code> | <code>onebot:12345</code>。前缀不是装饰：裸数字 id 会跨平台撞车，撞了就是把一个人的记忆注进同号陌生人",
      ],
      ['key', 'TEXT', ['NN', 'UQ'], '—', '与前两列组成<b>部分</b>唯一索引 <code>WHERE deleted_at IS NULL</code>'],
      ['content', 'TEXT', ['NN'], '—', '上限 <b>500 字符</b>，在 ops 层统一强制（不是数据库约束）'],
      [
        'memory_type',
        'TEXT',
        ['NN'],
        "'general'",
        '<code>general</code> | <code>preference</code> | <code>fact</code> | <code>instruction</code> | <code>relationship</code>',
      ],
      [
        'subject_scope_id',
        'TEXT',
        ['NULL', 'IDX'],
        'NULL',
        '这条记忆<b>说的是谁</b>。onebot_user 作用域必填；project 作用域可选，好让退出机制能找到群里提到某人的记忆',
      ],
      [
        'origin',
        'TEXT',
        ['NN'],
        "'desktop'",
        '<b>在哪学到的</b>：<code>private</code> | <code>group</code> | <code>admin</code> | <code>desktop</code> | <code>legacy</code>。<code>Origin::group_visible()</code>（group/admin/legacy）是隐私边界的<b>唯一</b>谓词——private 永不进群',
      ],
      [
        'visibility',
        'TEXT',
        ['NN'],
        "'normal'",
        '<b>谁能看</b>：<code>normal</code> | <code>owner_only</code>。与 origin 分开，因为运营者对某人的私下批注和运营者批准的全局规则同 origin 却不同可见性',
      ],
      ['source_session_id', 'TEXT', ['NULL'], 'NULL', ''],
      [
        'deleted_at',
        'BIGINT',
        ['NULL'],
        'NULL',
        '<b>软删除</b>。部分唯一索引让同一个 key 删掉后还能再建，不必复活墓碑',
      ],
      [
        'deleted_by',
        'TEXT',
        ['NULL'],
        'NULL',
        '<code>self</code>（本人删自己的） | <code>admin</code> | <code>lru</code>（被淘汰）',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', '<b>删除不动它</b>，所以变更检测必须用两个游标'],
    ],
    rels: [
      '<b>对 projects 没有外键</b>（迁移 19 显式移除）：scope_id 是多态的。project 作用域的孤儿由 <code>db::ops::project::delete_project</code> 和启动扫描清理。',
      '<code>subject_scope_id</code> 逻辑上指向 <code>memory_subjects.scope_id</code>，同样无外键。',
      "冻结进历史后成为 <code>messages</code> 里 <code>role='context'</code> 的行（<code>memory_context.rs</code>）。",
    ],
    rules: [
      '上限（ops 层，非 DB）：项目 100 条 / OneBot 全局 50 / 客户端全局 50 / 每人 20 / 记住的人 200 / 只跟踪 last_seen 的人 2000 / 手动置顶的人 50。',
      "<code>scope_type='onebot_user'</code> ⇒ <code>subject_scope_id</code> 必填。",
      '变更检测是<b>两个 keyset 游标而不是一个时间戳</b>：删除只写 deleted_at；同一批写入共用同一毫秒所以要用 id 破平；窗口上界取开区间防止并发写正好落在边界；游标停在预算拒收的位置之前——被裁掉的顺序与写入时间无关。',
      '「被问过」就算送达，哪怕预算只装下一部分——要求整份送达永远收敛不了，记忆比配额多的人会永远是陌生人。',
      "对自动审查而言，<code>role='context'</code> 的冻结块属于 <b>untrusted</b>：在早期注入下写成的记忆不能被洗成用户意图。",
    ],
  },
  {
    name: 'memory_subjects',
    group: 'memory',
    title: '被记住的人',
    mig: 19,
    show: ['scope_id', 'display_name', 'last_seen_at', 'is_pinned', 'opted_out'],
    note: '每人一行，只带 LRU 时钟和几个开关；记忆本体留在 memories，让每人配额和注入查询都只打一张表。',
    cols: [
      [
        'scope_id',
        'TEXT',
        ['PK', 'NN'],
        '—',
        '与 <code>memories.scope_id</code> 同一套编码（<code>onebot:12345</code>）',
      ],
      [
        'display_name',
        'TEXT',
        ['NULL'],
        'NULL',
        '<b>当前</b>昵称。历史里的昵称在 <code>audit_messages.sender_name</code>，否则改名会追溯改写他说过的每一句',
      ],
      [
        'last_seen_at',
        'BIGINT',
        ['NN', 'IDX'],
        '—',
        '<b>互动时钟，不是写入时钟</b>；淘汰从最旧扫起，没有这个索引每次写都要排序整表',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['is_protected', 'INTEGER', ['NN'], '0', '镜像 admin_users，自愈'],
      ['is_pinned', 'INTEGER', ['NN'], '0', '手动豁免淘汰，<b>单独限额 50</b>，否则置顶就成了绕过总配额的口子'],
      ['opted_out', 'INTEGER', ['NN'], '0', '本人拒绝被记住'],
    ],
    rels: ['被 <code>memories.subject_scope_id</code> 逻辑引用（无外键）。'],
    rules: [
      "淘汰只删 <code>visibility='normal'</code> 的记忆：只剩运营者批注的人会永久占位，删他等于什么都没释放。",
      '<code>opted_out=1</code> ⇒ 不再为其写新记忆。',
    ],
  },
  {
    name: 'memory_proposals',
    group: 'memory',
    title: '待批准的全局记忆提案',
    mig: 19,
    show: ['id', 'key', 'proposer_id', 'status', 'expires_at'],
    cols: [
      [
        'id',
        'INTEGER',
        ['PK', 'NN'],
        'AUTOINCREMENT',
        '<b>必须 AUTOINCREMENT</b>：普通 INTEGER PRIMARY KEY 会重用删除后的最大 rowid，一句过期的「同意 N」就可能批准一条全新提案',
      ],
      ['key', 'TEXT', ['NN'], '—', ''],
      ['content', 'TEXT', ['NN'], '—', ''],
      ['memory_type', 'TEXT', ['NN'], "'general'", ''],
      ['origin_session', 'TEXT', ['NULL'], 'NULL', ''],
      ['proposer_id', 'BIGINT', ['NULL'], 'NULL', '平台 id'],
      [
        'status',
        'TEXT',
        ['NN', 'IDX'],
        "'pending'",
        '<code>pending</code> | <code>approved</code> | <code>rejected</code> | <code>expired</code>',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      [
        'expires_at',
        'BIGINT',
        ['NN', 'IDX'],
        '—',
        '与 status 组成复合索引；<b>批准窗口比进程活得久</b>，所以不能用内存里的 Mutex map',
      ],
      ['resolved_at', 'BIGINT', ['NULL'], 'NULL', ''],
      ['resolved_by', 'BIGINT', ['NULL'], 'NULL', '谁批的'],
    ],
    rels: ['批准后写入 <code>memories</code>（onebot_global 作用域），本表不存外键。'],
    rules: [
      "<code>status ≠ 'pending'</code> ⇒ <code>resolved_at</code> / <code>resolved_by</code> 应有值（过期由扫描写 <code>expired</code>）。",
      '<code>now &gt; expires_at</code> 且仍是 pending ⇒ 视为过期，不得批准。',
    ],
  },

  // ── 任务、计划与项目 ──────────────────────────────────────────
  {
    name: 'projects',
    group: 'task',
    title: '项目与会话来源',
    mig: 3,
    show: ['id', 'name', 'path', 'source_type', 'source_id', 'assistant_id'],
    note: '迁移 11 重建：path 变为可空，并加上 source_type/source_id，让一个 QQ 群或私聊也能是一个「项目」。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['path', 'TEXT', ['NULL'], 'NULL', '本地目录；非本地来源为 NULL'],
      [
        'source_type',
        'TEXT',
        ['NN', 'UQ'],
        "'local'",
        '<code>local</code> | <code>onebot_group</code> | <code>onebot_private</code>',
      ],
      [
        'source_id',
        'TEXT',
        ['NULL', 'UQ'],
        'NULL',
        '群号 / QQ 号。与 source_type 组成<b>部分</b>唯一索引 <code>WHERE source_id IS NOT NULL</code>',
      ],
      ['assistant_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>assistants(id)</code> SET NULL'],
      ['description', 'TEXT', ['NULL'], 'NULL', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: [
      '被 <code>conversations.project_id</code>（SET NULL）、<code>skill_bindings_project</code>（CASCADE）引用。',
      '<code>memories</code> 的 project 作用域<b>逻辑上</b>指向它，但无外键。',
    ],
    rules: [
      '旧的 <code>UNIQUE(path)</code> 在重建后已不存在；现在唯一的是 <code>(source_type, source_id)</code> 且只在 source_id 非空时生效。',
      '删项目要顺带清理 project 作用域的记忆（<code>delete_project</code> + 启动扫描），数据库不会替你做。',
      '<code>conversations.project_id</code> 是 SET NULL，所以审计行必须自带 <code>source_type</code>/<code>source_id</code> 快照——否则删个项目就抹掉了一年历史归属的群。',
    ],
  },
  {
    name: 'mode_artifacts',
    group: 'task',
    title: '模式产出的待批准物（计划）',
    mig: 20,
    show: ['id', 'conversation_id', 'kind', 'status'],
    note: '刻意<b>不</b>只放在 transcript 里：批准后的产物每回合都要重新注入系统提示，这样它才能熬过压缩。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['conversation_id', 'TEXT', ['FK', 'NN', 'IDX', 'UQ'], '—', '→ <code>conversations(id)</code> ON DELETE CASCADE'],
      [
        'kind',
        'TEXT',
        ['NN', 'IDX', 'UQ'],
        "'plan'",
        '今天只有 <code>plan</code>；这一列现在加只花一列，发布后再加就是数据迁移',
      ],
      ['content', 'TEXT', ['NN'], '—', 'Markdown'],
      [
        'status',
        'TEXT',
        ['NN', 'UQ'],
        '—',
        '<code>pending</code> | <code>approved</code> | <code>rejected</code> | <code>superseded</code>（被新的取代） | <code>done</code>（描述的活干完了）',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['<code>conversations</code>（CASCADE）。'],
    rules: [
      "<b>部分唯一索引</b> <code>(conversation_id, kind) WHERE status='approved'</code>：每个会话每种 kind 最多一份生效的产物。放在索引而不是只在批准事务里判断，是为了两个并发批准不会都成功、让注入内容变得含糊——与 todo_lists 守护单一活动清单同一手法。",
      '退休用 <code>superseded</code>/<code>done</code> 而不是删除，好让「曾经提过什么」还可读。',
    ],
  },
  {
    name: 'todo_lists',
    group: 'task',
    title: '任务清单',
    mig: 18,
    show: ['id', 'conversation_id', 'title', 'status'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['conversation_id', 'TEXT', ['FK', 'NN', 'IDX', 'UQ'], '—', '→ <code>conversations(id)</code> ON DELETE CASCADE'],
      ['title', 'TEXT', ['NN'], '—', ''],
      ['status', 'TEXT', ['NN', 'UQ'], "'in_progress'", '<code>in_progress</code> | <code>completed</code>'],
      ['created_at', 'BIGINT', ['NN', 'IDX'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['<code>conversations</code>（CASCADE）；被 <code>todo_items</code>（CASCADE）引用。'],
    rules: [
      "<b>部分唯一索引</b> <code>(conversation_id) WHERE status='in_progress'</code>：一个会话同时只能有一份进行中的清单，所以系统提示永远只有一份明确的清单可注入。",
    ],
  },
  {
    name: 'todo_items',
    group: 'task',
    title: '清单条目',
    mig: 18,
    show: ['id', 'list_id', 'content', 'status', 'sort_order'],
    note: '每次工具调用<b>整批替换</b>，所以条目除了在清单里的位置之外没有身份。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['list_id', 'TEXT', ['FK', 'NN', 'IDX'], '—', '→ <code>todo_lists(id)</code> ON DELETE CASCADE'],
      ['content', 'TEXT', ['NN'], '—', '祈使句形式（「修好 X」）'],
      ['active_form', 'TEXT', ['NN'], '—', '进行时形式（「正在修 X」），展示用'],
      [
        'status',
        'TEXT',
        ['NN'],
        "'pending'",
        '<code>pending</code> | <code>in_progress</code> | <code>completed</code>',
      ],
      ['sort_order', 'INTEGER', ['NN', 'IDX'], '0', '与 list_id 组成索引'],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['<code>todo_lists</code>（CASCADE）。'],
    rules: ['约定：同一清单里 <code>in_progress</code> 最多一条（应用层保证，无索引强制）。'],
  },
  {
    name: 'acp_sessions',
    group: 'conv',
    title: 'hosted 会话（Claude Code 接上哪一段）',
    mig: 38,
    show: ['conversation_id', 'acp_session_id', 'cwd'],
    note: '一个 hosted 对话是"哪个 agent 会话"，以便下次能接着说。以前这是 <code>preferences</code> 里的 <code>acp.cwd.&lt;conversation_id&gt;</code>——目录活过了重启，<b>会话没有</b>，于是重开就是在同一个文件夹里起一个全新的 agent：transcript 全在屏幕上，它一个字都看不见。注意不是"忘了"：hosted 的一轮只发最新那条消息，我们的 transcript 从来不进它的上下文。',
    cols: [
      [
        'conversation_id',
        'TEXT',
        ['PK', 'FK', 'NN'],
        '—',
        '→ <code>conversations(id)</code> ON DELETE CASCADE。<b>一行一对话</b>，不是一行一会话',
      ],
      [
        'acp_session_id',
        'TEXT',
        ['NULL', 'IDX'],
        'NULL',
        'NULL = 没有可恢复的会话，起新的。写回的是 <code>session/load</code> <b>回复里</b>那个 id——SDK 实际恢复到哪个由它说了算，不一定是请求的那个',
      ],
      ['cwd', 'TEXT', ['NN'], '—', '绝对路径；adapter 直接拒收相对路径'],
      ['created_at', 'BIGINT', ['NN'], '—', '这个对话第一次有会话是什么时候；upsert 冲突时不动它'],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['<code>conversations</code>（CASCADE）。'],
    rules: [
      '<b>一行一对话。</b>续接复用同一个 id，续接失败就覆盖它——一个对话永远不会有两个活着的会话。<code>AcpRegistry</code> 也是按 conversation 键的，表能表达而注册表不能表达的状态，就是在描述不会发生的事。',
      '<b><code>acp_session_id</code> 的 NULL 是一个真实状态</b>，不是待填的空。既往对话（迁移 38 从 preference 回填的）和"adapter 起来了但会话没开成"都是它，两者对调用方是同一件事，所以不区分。UNIQUE 索引里 SQLite 不认为多个 NULL 相等，正好放得下。',
      '<b>UNIQUE 在 <code>acp_session_id</code> 上</b>：两个对话指向同一个 agent 会话，就是两份 transcript 从同一个地方被写。',
      "迁移 38 顺手 <code>DELETE FROM preferences WHERE key LIKE 'acp.cwd.%'</code>——不留第二份拷贝，两处存同一个工作目录，输的那次是会话开在了错的文件夹里。",
    ],
  },
  {
    name: 'queued_prompts',
    group: 'task',
    title: '提示词队列（双投递语义 + 崩溃账本）',
    mig: 34,
    show: ['id', 'conversation_id', 'content', 'delivery', 'position'],
    note: '用户写好但还没交给 agent 的消息。子 agent 的 steering inbox 是 <code>Mutex&lt;HashMap&gt;</code>，随进程消失——那是对的，因为那个 inbox 只在那次运行期间有意义。而人<b>攒</b>出来的队列相反：提前几分钟写下，是「接下来要做什么」的记录，静默丢掉就是丢掉人做过的事。所以它是一张表。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['conversation_id', 'TEXT', ['FK', 'NN', 'IDX'], '—', '→ <code>conversations(id)</code> ON DELETE CASCADE'],
      [
        'content',
        'TEXT',
        ['NN'],
        '—',
        '纯文本，或与 <code>messages.content</code> 同款的 JSON parts；它会原样变成一行消息，两套编码就是两处要同步的东西',
      ],
      [
        'delivery',
        'TEXT',
        ['NN'],
        '—',
        '<code>follow_up</code>（整轮结束后另起一轮）| <code>interject</code>（下一个接受输入的间隙插进当前轮）',
      ],
      [
        'position',
        'INTEGER',
        ['NN', 'IDX'],
        '—',
        '重排时整体重写；列表很短且有人在看着，为省一次 UPDATE 换来不可预测的顺序不划算',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['dispatched_at', 'BIGINT', ['NULL'], 'NULL', '已交给 runner，结果未知'],
      ['dispatched_turn_id', 'TEXT', ['NULL'], 'NULL', '交给了哪一轮'],
      ['settled_at', 'BIGINT', ['NULL'], 'NULL', '已确认成为 transcript 里的一行'],
      ['settled_message_id', 'TEXT', ['NULL'], 'NULL', '成为了哪一行'],
      ['held_at', 'BIGINT', ['NULL'], 'NULL', '前一轮没跑完，整队挂起等人'],
      ['reported_at', 'BIGINT', ['NULL', 'IDX'], 'NULL', '存疑项已告知 agent；语义同 <code>turns.reported_at</code>'],
    ],
    rels: ['<code>conversations</code>（CASCADE）。'],
    rules: [
      '<b>状态就是「哪几个时间戳有值」</b>，不另设 status 列：时间戳是写操作真正产生的东西，旁边再放一个状态列，部分写入后两者就会互相矛盾。四态——全空=待发 / 有 dispatched 无 settled=<b>存疑</b> / 有 settled=已投递 / 有 held=挂起。',
      '<b>出队与写消息行在同一个事务里</b>（<code>ops::queue::take_next</code>）。这是整张表存在的理由：kill 只可能落在事务两侧之一——要么条目还在队列且没有消息行（重发安全），要么行已存在且条目已 settled（不会重发）。拆成两次写就会留下「行已存在但队列还以为欠着」的窗口，而那个窗口唯一的修复手段是猜 agent 有没有动过手。',
      '<b>存疑条目永不重发。</b>「不确定送到没有」就重发一遍「删掉旧迁移」，是队列变危险的方式。改为在下一轮告知 agent，由它看着 transcript 和文件自己判断——与 <code>interrupted.rs</code> 报告被打断的轮次同一套纪律，<code>reported_at</code> 也同样只在回复被完整读完后才写。',
      '<b>原生轮次与 hosted 会话在这里不对称</b>，这是设计里最要紧的一点：原生轮次每轮重发完整 history，所以只要行写进了 transcript，模型必定看到——自愈。hosted ACP 会话的对话状态在 adapter 进程里、我们不重发 history，所以这边写了行<b>并不能证明</b> agent 收到了 <code>_session/steering</code>。存疑窗口在那一侧不可消除，账本因此必须落在这张表上，而不能从 <code>messages</code> 反推。',
      '<b>存疑条目阻塞队列，而不是被跳过。</b>指令是当作一个序列写下的，因为第二条没结果就先发第三条，等于把人的意图乱序执行。',
      '<b>一轮失败挂起整队</b>，不只是队头：后面那些指令与失败的那步建立在同一个前提上——「接着把那个函数重命名」在函数根本没建成时毫无意义。',
    ],
  },

  // ── 工具、技能与 MCP ─────────────────────────────────────────
  {
    name: 'tool_permissions',
    group: 'tools',
    title: '工具权限（无代码读写 + 外键悬空）',
    mig: 1,
    tags: ['legacy'],
    legacy: true,
    show: ['id', 'tool_name', 'mcp_server_id', 'permission'],
    note:
      '<b>全项目只有模型定义，没有任何 ops、没有任何读写代码</b>——和 <code>attachments</code> 一样。' +
      '实际的权限判定走 <code>tools::reach</code> 与自动审查装饰器，不经过这张表。' +
      '而且它现在<b>也写不进去</b>：迁移 24 的重建把外键改写成指向一张随后被删掉的表，见下面的约束条。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['tool_name', 'TEXT', ['NN', 'UQ'], '—', '<code>UNIQUE(tool_name)</code>——<b>全局一条规则</b>，不是按服务器分的'],
      [
        'mcp_server_id',
        'TEXT',
        ['FK', 'NULL'],
        'NULL',
        '→ <code>mcp_servers(id)</code> ON DELETE CASCADE；内置工具为 NULL',
      ],
      [
        'permission',
        'TEXT',
        ['NN'],
        "'ask'",
        '<code>always</code> | <code>ask</code> | <code>never</code>（<code>tools::Permission</code>）',
      ],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: [
      '<b>库里这条外键指向 <code>mcp_servers_old</code>——一张不存在的表。</b>画布上画的是它本来的意思（指向 <code>mcp_servers</code>，CASCADE）。',
    ],
    rules: [
      '<b>迁移 24 把这张表写坏了。</b>那次重建走的是 <code>ALTER TABLE mcp_servers RENAME TO mcp_servers_old</code>，' +
        'SQLite 3.25 起会顺手把其它表里指向它的 REFERENCES 一并改写（两种 <code>foreign_keys</code> 设置下都会，' +
        '在 3.50.4 上实测过），于是这一列的外键变成指向 <code>mcp_servers_old</code>；' +
        '同一个迁移随后 <code>DROP</code> 掉了那张表。',
      '<b>后果是整张表都写不了</b>，不只是带 <code>mcp_server_id</code> 的行：SQLite 在准备 DML 时就要解析外键目标表，' +
        '所以插入一条内置工具（该列为 NULL）的权限同样报 <code>no such table: main.mcp_servers_old</code>。' +
        '眼下没人被绊到，只是因为没有任何代码在写它。要启用这张表，得先加一个迁移把它重建一遍。',
      '唯一键在 <code>tool_name</code> 上而不是 <code>(server, tool_name)</code>：两个 MCP 服务器提供同名工具时会互相覆盖。',
    ],
  },
  {
    name: 'mcp_servers',
    group: 'tools',
    title: 'MCP 服务器',
    mig: 1,
    show: ['id', 'name', 'transport_type', 'is_enabled'],
    note: '迁移 24 整表重建，只为把 <code>is_enabled</code> 的默认值从 1 改成 0，并把所有现存行刷成 0——这一列的语义变成了「启动时自动连接」，留着旧值等于首次升级后把用户配过的每个服务器都拉起来。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['transport_type', 'TEXT', ['NN'], "'stdio'", '<code>stdio</code> | HTTP/SSE 类'],
      ['command', 'TEXT', ['NULL'], 'NULL', 'stdio 时的可执行文件'],
      ['args', 'TEXT', ['NULL'], 'NULL', 'JSON 数组'],
      ['env', 'TEXT', ['NULL'], 'NULL', 'JSON 对象'],
      ['url', 'TEXT', ['NULL'], 'NULL', 'HTTP 类传输的地址'],
      ['headers', 'TEXT', ['NULL'], 'NULL', 'JSON 对象（迁移 9）'],
      ['is_enabled', 'INTEGER', ['NN'], '0', '「启动时自动连接」（迁移 24 改的默认与语义）'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['被 <code>tool_permissions.mcp_server_id</code>（CASCADE）引用。'],
    rules: [
      "<code>transport_type='stdio'</code> ⇒ <code>command</code> 必填、<code>url</code> 无意义；HTTP 类反之。数据库不校验。",
      'MCP 工具定义带着用户自己的服务器名和参数 schema，因此<b>群聊会话一律不下发</b>（<code>qq_tools.rs</code>）。',
    ],
  },
  {
    name: 'tool_categories',
    group: 'tools',
    title: '自定义工具分类',
    mig: 8,
    show: ['id', 'name', 'sort_order'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['description', 'TEXT', ['NULL'], 'NULL', ''],
      ['icon', 'TEXT', ['NULL'], 'NULL', ''],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['被 <code>custom_tools.category_id</code>（SET NULL）引用。'],
    rules: [],
  },
  {
    name: 'custom_tools',
    group: 'tools',
    title: '自定义（命令行）工具',
    mig: 8,
    show: ['id', 'name', 'category_id', 'command', 'permission'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN', 'UQ'], '—', '<code>UNIQUE</code>；这就是模型看到的工具名'],
      ['description', 'TEXT', ['NN'], '—', '给模型看的说明'],
      ['category_id', 'TEXT', ['FK', 'NULL'], 'NULL', '→ <code>tool_categories(id)</code> SET NULL'],
      [
        'parameters_schema',
        'TEXT',
        ['NN'],
        "'{...}'",
        'JSON Schema，默认 <code>{"type":"object","properties":{}}</code>',
      ],
      ['command', 'TEXT', ['NN'], '—', '可执行文件'],
      ['args_template', 'TEXT', ['NULL'], 'NULL', '参数模板'],
      ['working_directory', 'TEXT', ['NULL'], 'NULL', ''],
      ['timeout_ms', 'INTEGER', ['NULL'], '30000', '<b>可空但有默认</b>'],
      ['permission', 'TEXT', ['NN'], "'ask'", '同 tool_permissions 的取值'],
      ['is_enabled', 'INTEGER', ['NN'], '1', '0/1'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['<code>tool_categories</code>（SET NULL）。'],
    rules: [
      '<code>name</code> 会与内置工具、MCP 工具处在同一命名空间，重名的解析顺序由注册表决定。',
      '<code>parameters_schema</code> 必须是合法 JSON Schema，写入时校验，数据库不管。',
    ],
  },
  {
    name: 'tool_presets',
    group: 'tools',
    title: '工具预设',
    mig: 8,
    show: ['id', 'name', 'tool_names', 'is_builtin'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['description', 'TEXT', ['NULL'], 'NULL', ''],
      ['icon', 'TEXT', ['NULL'], 'NULL', ''],
      ['tool_names', 'TEXT', ['NN'], '—', '<b>JSON 字符串数组</b>，不是关联表'],
      ['is_builtin', 'INTEGER', ['NN'], '0', '0/1；内置预设不可删'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['被 <code>assistants.tool_preset_id</code>（SET NULL）引用。'],
    rules: ['<code>tool_names</code> 里的名字<b>可能已不存在</b>（工具被删/改名），解析时按名匹配、匹配不上就忽略。'],
  },
  {
    name: 'skills',
    group: 'tools',
    title: '技能索引',
    mig: 17,
    show: ['dir_name', 'llm_name', 'source', 'is_enabled', 'mtime_hash'],
    note: '内容在磁盘 <code>{app_data_dir}/skills/&lt;dir_name&gt;/SKILL.md</code>，这张表只是索引：让绑定有外键目标，也让列表不必扫盘。',
    cols: [
      ['dir_name', 'TEXT', ['PK'], '—', '<b>目录名即主键</b>'],
      ['llm_name', 'TEXT', ['NN', 'IDX'], '—', '来自 SKILL.md frontmatter 的 slug，<b>这才是模型看到的名字</b>'],
      ['llm_description', 'TEXT', ['NN'], '—', '模型看到的说明，决定何时加载'],
      ['display_name', 'TEXT', ['NN'], '—', '设置界面里给人看的，可以是任何语言'],
      ['display_description', 'TEXT', ['NULL'], 'NULL', ''],
      [
        'source',
        'TEXT',
        ['NN'],
        "'user'",
        '<code>official</code> | <code>user</code> | <code>assistant</code> | <code>imported</code>',
      ],
      ['is_enabled', 'INTEGER', ['NN'], '1', '0/1'],
      ['is_builtin', 'INTEGER', ['NN'], '0', '0/1'],
      ['mtime_hash', 'TEXT', ['NULL'], 'NULL', '磁盘变更检测；不匹配就重新读盘'],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['被三张绑定表以 <b>CASCADE</b> 引用。'],
    rules: [
      '两套名字是刻意的：<code>display_*</code> 给人，<code>llm_*</code> 给模型，别混用。',
      '磁盘是内容的唯一真相；这张表可以整表重建。目录被删而行还在 = 悬空索引，由扫描清理。',
    ],
  },
  {
    name: 'skill_bindings_global',
    group: 'tools',
    title: '技能绑定 · 全局',
    mig: 17,
    show: ['dir_name'],
    cols: [['dir_name', 'TEXT', ['PK', 'FK'], '—', '→ <code>skills(dir_name)</code> ON DELETE CASCADE']],
    rels: ['<code>skills</code>（CASCADE）。三层绑定<b>读时求并集</b>。'],
    rules: [
      '保持三个独立锚点而不是一个中心「技能集合」，是为了让某技能全局置顶的同时，用户改不动的助手依然能解析到它。',
    ],
  },
  {
    name: 'skill_bindings_project',
    group: 'tools',
    title: '技能绑定 · 项目',
    mig: 17,
    show: ['project_id', 'dir_name'],
    cols: [
      ['project_id', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>projects(id)</code> CASCADE'],
      ['dir_name', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>skills(dir_name)</code> CASCADE'],
    ],
    rels: ['复合主键 <code>(project_id, dir_name)</code>。'],
    rules: [],
  },
  {
    name: 'skill_bindings_assistant',
    group: 'tools',
    title: '技能绑定 · 助手',
    mig: 17,
    show: ['assistant_id', 'dir_name'],
    cols: [
      ['assistant_id', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>assistants(id)</code> CASCADE'],
      ['dir_name', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>skills(dir_name)</code> CASCADE'],
    ],
    rels: ['复合主键 <code>(assistant_id, dir_name)</code>。'],
    rules: [],
  },
  {
    name: 'prompt_templates',
    group: 'tools',
    title: '提示词模板',
    mig: 6,
    show: ['id', 'name', 'category', 'is_builtin'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['description', 'TEXT', ['NULL'], 'NULL', ''],
      ['category', 'TEXT', ['NN'], "'general'", ''],
      ['template_text', 'TEXT', ['NN'], '—', ''],
      ['is_builtin', 'INTEGER', ['NN'], '0', '0/1'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['孤立表，不引用任何东西也不被引用。'],
    rules: [],
  },

  // ── 表情与贴纸 ────────────────────────────────────────────────
  {
    name: 'emoji_packs',
    group: 'sticker',
    title: '表情包',
    mig: 7,
    show: ['id', 'name', 'kind', 'source_account_id'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['name', 'TEXT', ['NN'], '—', ''],
      ['description', 'TEXT', ['NULL'], 'NULL', ''],
      ['cover_image', 'TEXT', ['NULL'], 'NULL', ''],
      ['is_builtin', 'INTEGER', ['NN'], '0', '0/1'],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
      ['kind', 'TEXT', ['NN', 'UQ'], "'manual'", '<code>manual</code> | <code>onebot</code>（自动收集池）（迁移 32）'],
      [
        'source_account_id',
        'TEXT',
        ['NULL', 'UQ'],
        'NULL',
        'bot 账号；与 kind 组成<b>部分</b>唯一索引 <code>WHERE source_account_id IS NOT NULL</code>——每个账号一个自动池',
      ],
    ],
    rels: ['被 <code>emojis</code>（CASCADE）、<code>assistant_emoji_packs</code>（CASCADE）引用。'],
    rules: [
      "<code>kind='onebot'</code> 的包由 <code>ensure_pack</code> 按账号自动建；并发建包靠那个唯一索引兜底（撞了就回读）。",
    ],
  },
  {
    name: 'emojis',
    group: 'sticker',
    title: '表情 / 贴纸',
    mig: 7,
    show: ['id', 'pack_id', 'name', 'source', 'source_key', 'semantic_status'],
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      ['pack_id', 'TEXT', ['FK', 'NN', 'IDX', 'UQ'], '—', '→ <code>emoji_packs(id)</code> ON DELETE CASCADE'],
      ['name', 'TEXT', ['NN', 'UQ'], '—', '<code>UNIQUE(pack_id, name)</code>'],
      ['tags', 'TEXT', ['NULL'], 'NULL', '语义标签'],
      ['file_name', 'TEXT', ['NN'], '—', '磁盘文件名'],
      ['file_format', 'TEXT', ['NN'], "'gif'", ''],
      ['sort_order', 'INTEGER', ['NN'], '0', ''],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
      [
        'source',
        'TEXT',
        ['NN', 'UQ'],
        "'local'",
        '<code>local</code> | <code>onebot_face</code> | <code>onebot_mface</code>（迁移 32）',
      ],
      [
        'source_key',
        'TEXT',
        ['NULL', 'UQ'],
        'NULL',
        '平台侧标识；<code>(pack_id, source, source_key)</code> <b>部分</b>唯一索引 <code>WHERE source_key IS NOT NULL</code>',
      ],
      ['native_payload', 'TEXT', ['NULL'], 'NULL', '原样发回平台所需的 JSON（不是文件）'],
      [
        'semantic_status',
        'TEXT',
        ['NN', 'IDX'],
        "'confirmed'",
        '<code>confirmed</code> | <code>pending</code> | <code>suggested</code>。<b>只有 confirmed 才允许被发送</b>（<code>tools::sticker</code>、<code>qq_tools.rs</code> 各自再查一遍）',
      ],
      ['suggested_name', 'TEXT', ['NULL'], 'NULL', '模型给出的建议名，待人确认'],
      ['suggested_tags', 'TEXT', ['NULL'], 'NULL', ''],
      ['file_size', 'BIGINT', ['NN'], '0', '字节'],
      ['seen_count', 'INTEGER', ['NN'], '1', '见过几次'],
      [
        'last_seen_at',
        'BIGINT',
        ['NULL'],
        'NULL',
        '与 (pack_id, semantic_status) 组成索引，用于挑「最近见过但还没确认语义」的',
      ],
    ],
    rels: [
      '<code>emoji_packs</code>（CASCADE）；被 <code>message_stickers.sticker_id</code> 以 <b>RESTRICT</b> 引用——<b>发出去过的贴纸不许被删</b>。',
    ],
    rules: [
      "<code>source ≠ 'local'</code> ⇒ 通常 <code>source_key</code> + <code>native_payload</code> 有值。",
      "<code>semantic_status='pending'</code> 的行名字是 <code>pending-&lt;后缀&gt;</code> 占位；确认后才有真名和 tags。",
    ],
  },
  {
    name: 'assistant_emoji_packs',
    group: 'sticker',
    title: '助手 ↔ 表情包',
    mig: 7,
    show: ['assistant_id', 'pack_id'],
    cols: [
      ['assistant_id', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>assistants(id)</code> CASCADE'],
      ['pack_id', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>emoji_packs(id)</code> CASCADE'],
      ['created_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: ['复合主键 <code>(assistant_id, pack_id)</code>。'],
    rules: ["助手能发哪些贴纸 = 这里绑定的包 ∩ <code>semantic_status='confirmed'</code> 的行。"],
  },
  {
    name: 'message_stickers',
    group: 'sticker',
    title: '消息里的贴纸位',
    mig: 32,
    show: ['message_id', 'sticker_id', 'position'],
    cols: [
      ['message_id', 'TEXT', ['PK', 'FK', 'NN'], '—', '→ <code>messages(id)</code> ON DELETE CASCADE'],
      ['sticker_id', 'TEXT', ['FK', 'NN', 'IDX'], '—', '→ <code>emojis(id)</code> <b>ON DELETE RESTRICT</b>'],
      ['position', 'INTEGER', ['PK', 'NN'], '0', '与 message_id 组成主键：<b>同一条消息里位置唯一</b>'],
    ],
    rels: ['两端方向相反：消息删了贴纸位跟着删（CASCADE），贴纸想删得先没有引用（RESTRICT）。'],
    rules: [
      '<code>PRIMARY KEY (message_id, position)</code> 意味着同一张贴纸可以在一条消息里出现多次（不同 position），但一个位置只能有一张。',
    ],
  },

  // ── 审计与计费 ────────────────────────────────────────────────
  {
    name: 'audit_messages',
    group: 'audit',
    title: '审计日志（只增不改，零外键）',
    mig: 29,
    tags: ['nofk', 'append-only'],
    show: ['id', 'message_id', 'conversation_id', 'turn_id', 'provider_id', 'role', 'created_at', 'input_price'],
    note: 'transcript 回答「这个会话现在写着什么」，这张表回答「发生过什么」——有人编辑或重生成的那一刻，两者就分叉了。它<b>一个外键都没有</b>：不是 SET NULL，因为留下一行还在、却已经说不清它说的是什么的记录，比丢掉记录更糟。每个 id 都是可能已经消失的东西的名字，读懂这一行所需的一切都<b>抄在旁边</b>。',
    cols: [
      ['id', 'TEXT', ['PK', 'NN'], '—', ''],
      [
        'recorded_at',
        'BIGINT',
        ['NN'],
        '—',
        '<b>写下记录的时间，不是消息发生的时间</b>。两者差很多的行，要么是耗时很久的回复，要么是导入',
      ],
      ['message_id', 'TEXT', ['NN'], '—', '无外键，可能已不存在'],
      ['conversation_id', 'TEXT', ['NN'], '—', '同上'],
      ['turn_id', 'TEXT', ['NULL'], 'NULL', '同上'],
      [
        'source_type',
        'TEXT',
        ['NULL'],
        'NULL',
        '快照：哪个 QQ 群 / 私聊。现场 join 要经 <code>conversations.project_id</code>，而那是 SET NULL 的',
      ],
      ['source_id', 'TEXT', ['NULL'], 'NULL', '同上'],
      ['turn_origin', 'TEXT', ['NULL'], 'NULL', 'desktop / onebot，快照自 <code>turns.origin</code>'],
      [
        'role',
        'TEXT',
        ['NN'],
        '—',
        '<code>user</code> | <code>assistant</code> | <code>auto_review</code>（自动审查的花费按这个角色单独入账，好让总数能被拆开）',
      ],
      [
        'content',
        'TEXT',
        ['NN'],
        '—',
        '<b>不含工具调用与工具结果</b>：那是我们自己的文本，参数里还可能有文件内容和命令输出，这张表没道理再存一份',
      ],
      ['sender_id', 'BIGINT', ['NULL', 'IDX'], 'NULL', '部分索引 <code>WHERE sender_id IS NOT NULL</code>'],
      [
        'sender_name',
        'TEXT',
        ['NULL'],
        'NULL',
        '<b>当时</b>的昵称。memory_subjects 只有当前昵称，改名会追溯改写他说过的每一句',
      ],
      ['provider_id', 'TEXT', ['NULL', 'IDX'], 'NULL', '与 model_id 组成分组索引'],
      ['provider_name', 'TEXT', ['NULL'], 'NULL', '当时的名字'],
      ['model_id', 'TEXT', ['NULL', 'IDX'], 'NULL', ''],
      ['input_tokens', 'INTEGER', ['NULL'], 'NULL', ''],
      ['output_tokens', 'INTEGER', ['NULL'], 'NULL', ''],
      ['cache_read_tokens', 'INTEGER', ['NULL'], 'NULL', '与 messages 同一份契约：<b>是 input 的子集</b>'],
      ['cache_write_tokens', 'INTEGER', ['NULL'], 'NULL', '同上'],
      ['created_at', 'BIGINT', ['NN', 'IDX'], '—', '原消息自己的时间戳，报表按它开窗'],
      [
        'input_price',
        'REAL',
        ['NULL'],
        'NULL',
        '<b>写入时的价格快照</b>（迁移 30）。NULL = 记录于价格开始留存之前，读时回落到今天的 model_configs——正是这个迁移要避免的追溯数字，但那是这些行仅有的数字',
      ],
      ['output_price', 'REAL', ['NULL'], 'NULL', ''],
      ['cache_read_price', 'REAL', ['NULL'], 'NULL', ''],
      ['cache_write_price', 'REAL', ['NULL'], 'NULL', ''],
      ['self_id', 'BIGINT', ['NULL'], 'NULL', '哪个 bot 账号；桌面为 NULL'],
      ['server_tool_calls', 'INTEGER', ['NULL'], 'NULL', '这次请求里计费的服务商工具调用次数（迁移 37）'],
      [
        'server_tool_price',
        'REAL',
        ['NULL'],
        'NULL',
        '当时的每千次调用价，与四个 token 价一样是写入时快照。NULL = 早于本迁移，或该模型没填过',
      ],
    ],
    rels: [
      '<b>零外键</b>。所有 id 列都是裸 TEXT/BIGINT 快照。',
      '与 <code>model_configs</code> 也不 join：价格已经抄在行上。',
    ],
    rules: [
      '存四个价格列而不是一个 <code>cost</code>：单一总额<b>拆不回去</b>，而界面上的 input/output/cache 分解必须可重建，公式变了还要能对历史重跑。',
      '计价只有一处实现：<code>agent::pricing::compute_cost</code>。<code>db::ops::usage</code> 把几百万行归约成几十组再交给 <code>cost_of</code>，与停止事件里的 <code>cost_breakdown</code> 同一个函数。两套实现一定会在测试存在的那个 case 上打架。',
      '总数请用 <code>UsageDimension::Total</code>，<b>不要把分解加起来</b>。',
      '<code>0/0</code> 价格的模型算「没填」，其流量进 <code>unpriced_messages</code> 并显示出来——不带这个计数的花费数字，比真相小且没有任何提示。',
      '只增不改是<b>构造上的</b>而非约束上的：没有任何代码 UPDATE 这些行，编辑消息会产生第二行而不是覆盖第一行。',
    ],
  },

  // ── 系统 ─────────────────────────────────────────────────────
  {
    name: 'preferences',
    group: 'sys',
    title: '偏好 / 服务配置',
    mig: 1,
    tags: ['权限敏感'],
    show: ['key', 'value', 'updated_at'],
    note: '三个监听器（remote / hooks / onebot）以及 ACP、自动审查<b>全部把配置放在这里</b>，所以通用的 <code>set_preference</code> 命令能够到那些被单独标记为 <code>local</code> 的保存命令想保护的东西。<code>guard_preference</code> 就是为此存在的。',
    cols: [
      ['key', 'TEXT', ['PK', 'NN'], '—', '点分命名空间'],
      ['value', 'TEXT', ['NN'], '—', '字符串或 JSON 文本'],
      ['updated_at', 'BIGINT', ['NN'], '—', ''],
    ],
    rels: [
      '孤立表。但 <code>acp.cwd.&lt;conversation_id&gt;</code> 这类键<b>逻辑上</b>挂在会话上——ACP 还没有自己的 session 表，这是明说的权宜之计。',
    ],
    rules: [
      '<b><code>SERVER_OWNED_PREFIXES</code>（远程调用者一律拒绝）：<code>remote.</code> / <code>hooks.</code> / <code>onebot.</code> / <code>autoreview.</code> / <code>acp.</code></b>',
      '拒绝的理由各不相同：<code>remote.*</code>、<code>hooks.port</code> 之类是自锁；<code>hooks.token</code> 与 <code>onebot.access_token</code> 是<b>别人服务的凭据</b>；<code>onebot.admin_users</code> 决定 QQ 里谁是管理员——写它是<b>对第三方的提权</b>；<code>autoreview.model</code> / <code>autoreview.allow_rules</code> 按<b>取值</b>授予能力，把设置写入变成了「允许运行任何东西」；<code>acp.command</code> <b>直接命名本机要执行的二进制</b>，能写它就是主机上的任意代码执行。',
      '常见键：<code>ui.theme</code>、<code>logging.level</code>（文件日志级别，故意不受 RUST_LOG 影响）、<code>voice.filter_level</code>、<code>sandbox.enabled</code>、<code>android.manage_storage_enabled</code>、<code>android.saf_roots</code>、<code>hooks.plan_review.{model,assistant_id,max_rounds,timeout_secs}</code>、<code>autoreview.{enabled,model,escalate,environment,allow_rules,deny_rules}</code>、<code>acp.{command,args}</code> 与 <code>acp.cwd.&lt;conversation_id&gt;</code>。',
      '密钥（API key）<b>不</b>存这里，走 keyring（service「meridian」）/ secrets 后端。',
    ],
  },
]

export const EDGES: SchemaEdge[] = [
  // 真外键
  { from: 'assistants', col: 'provider_id', to: 'providers', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'assistants', col: 'tool_preset_id', to: 'tool_presets', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'projects', col: 'assistant_id', to: 'assistants', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'model_configs', col: 'provider_id', to: 'providers', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'cached_models', col: 'provider_id', to: 'providers', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'conversations', col: 'assistant_id', to: 'assistants', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'conversations', col: 'project_id', to: 'projects', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'conversations', col: 'head_message_id', to: 'messages', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'messages', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'messages', col: 'provider_id', to: 'providers', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  { from: 'messages', col: 'compact_anchor_id', to: 'messages', toCol: 'id', kind: 'fk', act: 'CASCADE', self: true },
  { from: 'turns', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'mode_artifacts', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'todo_lists', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'todo_items', col: 'list_id', to: 'todo_lists', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'queued_prompts', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'acp_sessions', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'attachments', col: 'message_id', to: 'messages', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'message_stickers', col: 'message_id', to: 'messages', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'message_stickers', col: 'sticker_id', to: 'emojis', toCol: 'id', kind: 'fk', act: 'RESTRICT' },
  { from: 'emojis', col: 'pack_id', to: 'emoji_packs', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'assistant_emoji_packs', col: 'assistant_id', to: 'assistants', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'assistant_emoji_packs', col: 'pack_id', to: 'emoji_packs', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'custom_tools', col: 'category_id', to: 'tool_categories', toCol: 'id', kind: 'fk', act: 'SET NULL' },
  // 库里这条外键指向 mcp_servers_old —— 迁移 24 的 RENAME 改写了它，同一个迁移又把
  // 那张表 DROP 了。线画成断的，因为它确实是断的：整张 tool_permissions 写不进去。
  {
    from: 'tool_permissions',
    col: 'mcp_server_id',
    to: 'mcp_servers',
    toCol: 'id',
    kind: 'broken',
    // act 只写 ON DELETE 行为，坏在哪由 kind + actualTarget 说，渲染时自己拼。
    // 两种含义挤进一个字段，校验就得靠切字符串，而那正是它开始不准的地方。
    act: 'CASCADE',
    actualTarget: 'mcp_servers_old',
  },
  { from: 'skill_bindings_global', col: 'dir_name', to: 'skills', toCol: 'dir_name', kind: 'fk', act: 'CASCADE' },
  { from: 'skill_bindings_project', col: 'dir_name', to: 'skills', toCol: 'dir_name', kind: 'fk', act: 'CASCADE' },
  { from: 'skill_bindings_project', col: 'project_id', to: 'projects', toCol: 'id', kind: 'fk', act: 'CASCADE' },
  { from: 'skill_bindings_assistant', col: 'dir_name', to: 'skills', toCol: 'dir_name', kind: 'fk', act: 'CASCADE' },
  { from: 'skill_bindings_assistant', col: 'assistant_id', to: 'assistants', toCol: 'id', kind: 'fk', act: 'CASCADE' },

  // 逻辑引用（故意不建外键）
  {
    from: 'messages',
    col: 'parent_id',
    to: 'messages',
    toCol: 'id',
    kind: 'soft',
    act: '树边 · 整棵子树删',
    self: true,
  },
  { from: 'messages', col: 'turn_id', to: 'turns', toCol: 'id', kind: 'soft', act: '谁写的这行' },
  {
    from: 'conversations',
    col: 'parent_conversation_id',
    to: 'conversations',
    toCol: 'id',
    kind: 'soft',
    act: '子 agent',
    self: true,
  },
  {
    from: 'conversations',
    col: 'spawned_by_message_id',
    to: 'messages',
    toCol: 'id',
    kind: 'soft',
    act: '与 call_id 成对',
  },
  { from: 'conversations', col: 'spawned_turn_id', to: 'turns', toCol: 'id', kind: 'soft', act: '钉死那一次运行' },
  { from: 'memories', col: 'scope_id', to: 'projects', toCol: 'id', kind: 'soft', act: '多态 scope' },
  {
    from: 'memories',
    col: 'subject_scope_id',
    to: 'memory_subjects',
    toCol: 'scope_id',
    kind: 'soft',
    act: '说的是谁',
  },
  { from: 'memory_proposals', col: 'key', to: 'memories', toCol: 'key', kind: 'soft', act: '批准后写入' },
  { from: 'audit_messages', col: 'message_id', to: 'messages', toCol: 'id', kind: 'soft', act: '快照 · 可能已消失' },
  { from: 'audit_messages', col: 'conversation_id', to: 'conversations', toCol: 'id', kind: 'soft', act: '快照' },
  { from: 'audit_messages', col: 'turn_id', to: 'turns', toCol: 'id', kind: 'soft', act: '快照' },
  { from: 'audit_messages', col: 'provider_id', to: 'providers', toCol: 'id', kind: 'soft', act: '快照 + 价格快照' },
  { from: 'preferences', col: 'key', to: 'conversations', toCol: 'id', kind: 'soft', act: 'acp.cwd.<id>' },
]

/**
 * 布局：节点在画布上全字段展开，高度是字段数的函数，手写 y 坐标加一个字段就得重排。
 * 所以这里只决定「哪张表在哪一列、列内什么顺序」，y 由高度累加算出来。
 * 列的排法大致沿数据流向：配置 → 助手/项目 → 会话 → 消息 → 贴纸。
 */
const LAYOUT: { x: number; tables: string[] }[] = [
  {
    x: 0,
    tables: ['providers', 'model_configs', 'cached_models', 'mcp_servers', 'tool_permissions', 'prompt_templates'],
  },
  { x: 340, tables: ['assistants', 'tool_presets', 'tool_categories', 'custom_tools', 'projects', 'skills'] },
  {
    x: 680,
    tables: [
      'skill_bindings_global',
      'skill_bindings_project',
      'skill_bindings_assistant',
      'memories',
      'memory_subjects',
      'memory_proposals',
    ],
  },
  { x: 1020, tables: ['turns', 'conversations', 'mode_artifacts', 'todo_lists', 'preferences'] },
  {
    x: 1360,
    tables: [
      'messages',
      'attachments',
      'message_stickers',
      'todo_items',
      'queued_prompts',
      'acp_sessions',
      'audit_messages',
    ],
  },
  { x: 1700, tables: ['emoji_packs', 'emojis', 'assistant_emoji_packs'] },
]

/** 节点宽度。画布上是定值，边的方向判断也用它。 */
export const NODE_WIDTH = 280
/** 表头 + 中文副标题 + 字段区内边距，与 schema-lab 的样式对齐。 */
const NODE_HEAD = 78
/** 单个字段行高，与 .trow 的固定行高一致。 */
export const ROW_HEIGHT = 22
const GAP = 64

function place(): SchemaTable[] {
  const byName = new Map(RAW_TABLES.map((t) => [t.name, t]))
  const out: SchemaTable[] = []
  for (const col of LAYOUT) {
    let y = 0
    for (const name of col.tables) {
      const raw = byName.get(name)
      if (!raw) throw new Error(`布局里有一张不存在的表：${name}`)
      const columns: SchemaColumn[] = raw.cols.map(([n, type, flags, def, desc]) => ({
        name: n,
        type,
        flags,
        def,
        desc,
      }))
      const h = NODE_HEAD + columns.length * ROW_HEIGHT
      out.push({
        ...raw,
        columns,
        pk: columns.filter((c) => c.flags.includes('PK')).map((c) => c.name),
        x: col.x,
        y,
        h,
      })
      y += h + GAP
    }
  }
  const placed = new Set(out.map((t) => t.name))
  const missing = RAW_TABLES.filter((t) => !placed.has(t.name)).map((t) => t.name)
  if (missing.length) throw new Error(`这些表没被排进布局：${missing.join(', ')}`)
  return out
}

export const TABLES: SchemaTable[] = place()
export const TABLE_BY_NAME = new Map(TABLES.map((t) => [t.name, t]))
export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]))

/** 墓碑高度：表头一行加一行说明，比真表矮，看一眼就知道它不是一张表。 */
const GHOST_HEIGHT = 64

/**
 * 从 broken 边推导，不单独维护一份名单——两处各写一次，迟早有一处忘了改。
 * 摆在引用它的那张表左边、所有列之外（LAYOUT 最左是 x=0）。
 */
export const GHOSTS: SchemaGhost[] = EDGES.filter((e) => e.kind === 'broken' && e.actualTarget).map((e) => {
  const owner = TABLE_BY_NAME.get(e.from)
  if (!owner) throw new Error(`断掉的外键挂在一张不存在的表上：${e.from}`)
  return {
    id: ghostId(e.actualTarget as string),
    name: e.actualTarget as string,
    referencedBy: e.from,
    x: owner.x - 340,
    y: owner.y + Math.max(0, (owner.h - GHOST_HEIGHT) / 2),
    h: GHOST_HEIGHT,
  }
})

export const GHOST_BY_ID = new Map(GHOSTS.map((g) => [g.id, g]))

/** 画布上任一节点的 x —— 表或墓碑。边的走向靠它决定。 */
export function nodeX(id: string): number {
  return TABLE_BY_NAME.get(id)?.x ?? GHOST_BY_ID.get(id)?.x ?? 0
}

/**
 * 参与了边的列 → 该怎么标它。节点要把这些列画出来，否则连线没有落点。
 *
 * 一列可能同时是好几条边的端点（`messages.id` 被五处指着），取最要紧的那种：
 * 断的盖过逻辑引用，逻辑引用盖过外键——列上的标记要说的是「这里有事」。
 */
export type ColumnMark = 'fk' | 'soft' | 'broken'
const MARK_RANK: Record<ColumnMark, number> = { fk: 0, soft: 1, broken: 2 }

export const EDGE_COLUMNS: Map<string, ColumnMark> = (() => {
  const m = new Map<string, ColumnMark>()
  const mark = (table: string, col: string, kind: ColumnMark) => {
    const key = `${table}.${col}`
    const prev = m.get(key)
    if (!prev || MARK_RANK[kind] > MARK_RANK[prev]) m.set(key, kind)
  }
  for (const e of EDGES) {
    mark(e.from, e.col, e.kind)
    mark(e.to, e.toCol, 'fk')
  }
  return m
})()
