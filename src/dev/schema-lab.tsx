// 数据库模型画布。`#playground/schema`。
//
// 这里画的是 `schema-data.ts`,那份数据一半是散文、一半由
// `scripts/check-db-schema.mjs` 拿迁移核着。所以这个文件只管画,不带任何关于
// schema 的判断——一条边是不是外键、一列该不该加重,都是数据说了算。
//
// 节点全字段展开,不折叠:一张表要么值得画出来,要么不该在图上。折叠起来的字段
// 等于让人在图和文档之间来回跳,而这张图存在的理由就是不用跳。
import './schema-lab.css'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Moon, Sun, X } from '@keyline-icons/react/two-tone'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ToggleButton } from 'react-aria-components'

import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ListBox, ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { useAppTheme } from '@/lib/theme'
import {
  EDGES,
  EDGE_COLUMNS,
  GROUPS,
  GROUP_BY_ID,
  NODE_WIDTH,
  ROW_HEIGHT,
  TABLES,
  TABLE_BY_NAME,
  nodeX,
  type SchemaColumn,
  type SchemaEdge,
  type SchemaTable,
} from './schema-data'

/**
 * 说明文字里只有 `<code>` 和 `<b>` 两种标记。
 *
 * 手写这十行而不是 `dangerouslySetInnerHTML`:数据是自己的,但把一个能塞任意
 * HTML 的口子留在预览页里,下一个往说明里粘一段别处文案的人就会踩到。
 */
const MARKUP = /<(code|b)>([\s\S]*?)<\/\1>/g

function unescape(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function richText(source: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of source.matchAll(MARKUP)) {
    const at = m.index
    if (at > last) out.push(unescape(source.slice(last, at)))
    const inner = unescape(m[2])
    out.push(
      m[1] === 'code' ? (
        <code key={key++} data-slot="schema-rich-code" className="m-dev-schema-rich__code">
          {inner}
        </code>
      ) : (
        <b key={key++} data-slot="schema-rich-strong" className="m-dev-schema-rich__strong">
          {inner}
        </b>
      ),
    )
    last = at + m[0].length
  }
  if (last < source.length) out.push(unescape(source.slice(last)))
  return out
}

// ── 节点 ──────────────────────────────────────────────────────────────────

type TableNodeData = { table: SchemaTable; dimmed: boolean; hit: boolean }

function ColumnRow({ table, column, keyed }: { table: SchemaTable; column: SchemaColumn; keyed: boolean }) {
  const isPk = column.flags.includes('PK')
  // 列上的点说的是「这里连着什么」：外键或逻辑引用。
  const mark = EDGE_COLUMNS.get(`${table.name}.${column.name}`)
  const isSoft = mark === 'soft'
  const isFk = !isSoft && column.flags.includes('FK')
  const kind = isPk ? 'pk' : isFk ? 'fk' : isSoft ? 'soft' : 'plain'
  const role = isPk ? 'pk' : keyed ? 'keyed' : 'normal'

  // 一列的两侧各挂一对 handle。边往哪边走由两张表的相对位置决定,所以两侧都得备着。
  const handles = (['l', 'r'] as const).map((side) => {
    const position = side === 'l' ? Position.Left : Position.Right
    return [
      <Handle
        key={`${side}t`}
        type="target"
        id={`${column.name}__${side}t`}
        position={position}
        isConnectable={false}
      />,
      <Handle
        key={`${side}s`}
        type="source"
        id={`${column.name}__${side}s`}
        position={position}
        isConnectable={false}
      />,
    ]
  })

  return (
    <div data-slot="schema-column" className="m-dev-schema-col" style={{ height: ROW_HEIGHT }}>
      {handles}
      <span data-slot="schema-column-mark" aria-hidden className="m-dev-schema-col__mark" data-kind={kind} />
      <span data-slot="schema-column-name" className="m-dev-schema-col__name" data-role={role}>
        {column.name}
      </span>
      <span data-slot="schema-column-type" className="m-dev-schema-col__type">
        {column.type}
      </span>
    </div>
  )
}

function TableNode({ data, selected }: NodeProps<Node<TableNodeData>>) {
  const { table, dimmed, hit } = data
  const group = GROUP_BY_ID.get(table.group)
  const keyed = useMemo(() => new Set(table.show), [table.show])

  return (
    <div
      data-slot="schema-table"
      className="m-dev-schema-table"
      data-selected={selected || undefined}
      data-hit={hit && !selected ? true : undefined}
      data-dimmed={dimmed || undefined}
      style={{ width: NODE_WIDTH }}
    >
      <div data-slot="schema-table-header" className="m-dev-schema-table__header">
        <span
          data-slot="schema-table-swatch"
          aria-hidden
          className="m-dev-schema-table__swatch"
          style={{ background: group?.color }}
        />
        <span data-slot="schema-table-name" className="m-dev-schema-table__name">
          {table.name}
        </span>
        <span data-slot="schema-table-migration" className="m-dev-schema-table__migration">
          迁移 {table.mig}
        </span>
      </div>
      <div data-slot="schema-table-subtitle" className="m-dev-schema-table__subtitle">
        <span data-slot="schema-table-title" className="m-dev-schema-table__title">
          {table.title}
        </span>
        <span data-slot="schema-table-count" className="m-dev-schema-table__count">
          {table.columns.length} 列
        </span>
      </div>
      <div data-slot="schema-table-columns" className="m-dev-schema-table__columns">
        {table.columns.map((c) => (
          <ColumnRow key={c.name} table={table} column={c} keyed={keyed.has(c.name)} />
        ))}
      </div>
    </div>
  )
}

const nodeTypes = { table: TableNode }

// ── 边 ────────────────────────────────────────────────────────────────────

function buildEdges(showSoft: boolean, selected: string | null): Edge[] {
  return EDGES.filter((e) => e.kind !== 'soft' || showSoft).map((e, i) => {
    const target = e.to
    const fromX = nodeX(e.from)
    const toX = nodeX(target)
    // 往右还是往左,由两端的相对位置决定;自环固定走右侧。
    const side = e.self || fromX < toX ? 'r' : fromX > toX ? 'l' : 'r'
    const related = selected !== null && (e.from === selected || target === selected || e.to === selected)
    return {
      id: `e${i}`,
      source: e.from,
      target,
      sourceHandle: `${e.col}__${side}s`,
      targetHandle: `${e.toCol}__${side === 'r' ? 'l' : 'r'}t`,
      type: e.self ? 'smoothstep' : 'default',
      className: [
        e.kind === 'soft' && 'schema-edge-soft',
        related && 'schema-edge-hl',
        selected !== null && !related && 'schema-edge-dim',
      ]
        .filter(Boolean)
        .join(' '),
      // 全部边都挂标签会糊成一片:外键常驻(它标的是删除行为,是这张图的重点),
      // 逻辑引用只在选中相关表时才说话。
      label: e.kind === 'fk' ? e.act : related ? e.act : undefined,
      labelShowBg: true,
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
    }
  })
}

// ── 画布 ──────────────────────────────────────────────────────────────────

function Canvas({
  query,
  hiddenGroups,
  showSoft,
  selected,
  onSelect,
}: {
  query: string
  hiddenGroups: Set<string>
  showSoft: boolean
  selected: string | null
  onSelect: (name: string | null) => void
}) {
  const rf = useReactFlow()
  const { resolvedTheme } = useAppTheme()

  const initial = useMemo<Node[]>(
    () =>
      TABLES.map((t) => ({
        id: t.name,
        type: 'table',
        position: { x: t.x, y: t.y },
        data: { table: t, dimmed: false, hit: false },
        // 带上尺寸,否则首次 fitView 会赶在节点测量之前跑,视口停在左上角。
        width: NODE_WIDTH,
        height: t.h,
      })),
    [],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initial)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => setEdges(buildEdges(showSoft, selected)), [showSoft, selected, setEdges])

  useEffect(() => {
    const q = query.trim().toLowerCase()
    setNodes((ns) =>
      ns.map((n) => {
        const t = TABLE_BY_NAME.get(n.id)
        if (!t) return n
        const hit =
          q.length > 0 &&
          (t.name.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.columns.some((c) => c.name.toLowerCase().includes(q)))
        return {
          ...n,
          hidden: hiddenGroups.has(t.group),
          selected: n.id === selected,
          data: { ...n.data, hit, dimmed: q.length > 0 && !hit },
        }
      }),
    )
  }, [query, hiddenGroups, selected, setNodes])

  // 收一次视口。initial 里给了尺寸,但节点测量仍在下一帧,`fitView` prop 会早一步。
  useEffect(() => {
    const id = setTimeout(() => void rf.fitView({ padding: 0.06 }), 80)
    return () => clearTimeout(id)
  }, [rf])

  const onNodeClick = useCallback((_: unknown, node: Node) => onSelect(node.id), [onSelect])
  const onPaneClick = useCallback(() => onSelect(null), [onSelect])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
      fitView
      minZoom={0.15}
      maxZoom={2}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={22} size={1.6} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => {
          const t = TABLE_BY_NAME.get(n.id)
          return t ? (GROUP_BY_ID.get(t.group)?.color ?? 'var(--text-secondary)') : 'var(--text-secondary)'
        }}
        nodeStrokeWidth={0}
      />
    </ReactFlow>
  )
}

// ── 详情面板 ──────────────────────────────────────────────────────────────

function FlagChip({ flag }: { flag: string }) {
  const tone = flag === 'PK' ? 'warning' : flag === 'FK' ? 'success' : 'neutral'
  return (
    <Badge size="sm" tone={tone}>
      {flag}
    </Badge>
  )
}

function edgeText(edge: SchemaEdge, dir: 'out' | 'in') {
  return dir === 'out' ? `${edge.col} → ${edge.to}.${edge.toCol}` : `${edge.from}.${edge.col} → ${edge.toCol}`
}

function EdgeList({
  title,
  edges,
  dir,
  onJump,
}: {
  title: string
  edges: SchemaEdge[]
  dir: 'out' | 'in'
  onJump: (n: string) => void
}) {
  if (edges.length === 0) return null
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div className="m-dev-schema-edge-list">
        <ListBox
          aria-label={title}
          onAction={(key) => {
            const edge = edges[Number(key)]
            if (edge) onJump(dir === 'out' ? edge.to : edge.from)
          }}
        >
          {edges.map((edge, i) => (
            <ListBoxItem
              key={i}
              id={i}
              textValue={edgeText(edge, dir)}
              description={
                <span data-slot="schema-edge-action" className="m-dev-schema-edge__action">
                  {edge.kind === 'soft' ? '逻辑 · ' : ''}
                  {edge.act}
                </span>
              }
            >
              <span data-slot="schema-edge-path" className="m-dev-schema-edge__path" data-kind={edge.kind}>
                {edgeText(edge, dir)}
              </span>
            </ListBoxItem>
          ))}
        </ListBox>
      </div>
    </>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 data-slot="schema-section-title" className="m-dev-schema-detail__section-title">
      {children}
    </h3>
  )
}

function DetailPanel({
  name,
  onClose,
  onJump,
}: {
  name: string | null
  onClose: () => void
  onJump: (n: string) => void
}) {
  if (!name) {
    return (
      <aside data-slot="schema-detail-empty" className="m-dev-schema-detail-empty">
        <div data-slot="schema-detail-empty-body" className="m-dev-schema-detail-empty__body">
          <p data-slot="schema-detail-empty-hint" className="m-dev-schema-detail-empty__hint">
            点一个表看它的全部字段、跨字段约束与关联关系
          </p>
          <p data-slot="schema-detail-empty-tips" className="m-dev-schema-detail-empty__tips">
            拖动节点重新排布 · 滚轮缩放 · 选中一个表会把它的边挑出来
          </p>
        </div>
      </aside>
    )
  }

  const table = TABLE_BY_NAME.get(name)
  if (!table) return null
  const group = GROUP_BY_ID.get(table.group)
  const out = EDGES.filter((e) => e.from === name)
  const inc = EDGES.filter((e) => e.to === name)

  return (
    <aside data-slot="schema-detail" className="m-dev-schema-detail">
      <header data-slot="schema-detail-header" className="m-dev-schema-detail__header">
        <div data-slot="schema-detail-heading" className="m-dev-schema-detail__heading">
          <div data-slot="schema-detail-identity" className="m-dev-schema-detail__identity">
            <h2 data-slot="schema-detail-name" className="m-dev-schema-detail__name">
              {table.name}
            </h2>
            <p data-slot="schema-detail-meta" className="m-dev-schema-detail__meta">
              {table.title} · {group?.title} · 迁移 {table.mig}
            </p>
          </div>
          <TooltipTrigger>
            <Button icon={<X />} aria-label="关闭详情" variant="ghost" size="sm" onPress={onClose} />
            <Tooltip placement="left">关闭</Tooltip>
          </TooltipTrigger>
        </div>
        {table.tags && table.tags.length > 0 && (
          <div data-slot="schema-detail-tags" className="m-dev-schema-detail__tags">
            {table.tags.map((tag) => (
              <Badge key={tag} size="sm">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </header>

      <div data-slot="schema-detail-body" className="m-dev-schema-detail__body">
        {table.note && (
          <p data-slot="schema-detail-note" className="m-dev-schema-detail__note">
            {richText(table.note)}
          </p>
        )}

        <SectionTitle>字段 · {table.columns.length} 列</SectionTitle>
        {/* 一列一块,不是表格:说明里带着 `messages.compact_anchor_id` 这种长标识符,
            在 420px 宽的面板里排成三栏会把最后一栏顶出可视区。 */}
        <ul data-slot="schema-detail-columns" className="m-dev-schema-detail__columns">
          {table.columns.map((c) => (
            <li data-slot="schema-detail-column" key={c.name} className="m-dev-schema-detail__column">
              <div data-slot="schema-detail-column-heading" className="m-dev-schema-detail__column-heading">
                <span data-slot="schema-detail-column-name" className="m-dev-schema-detail__column-name">
                  {c.name}
                </span>
                <span data-slot="schema-detail-column-type" className="m-dev-schema-detail__column-type">
                  {c.type}
                </span>
              </div>
              <div data-slot="schema-detail-column-flags" className="m-dev-schema-detail__column-flags">
                {c.flags.map((f) => (
                  <FlagChip key={f} flag={f} />
                ))}
                {c.def !== '—' && (
                  <span data-slot="schema-detail-column-default" className="m-dev-schema-detail__column-default">
                    默认 {c.def}
                  </span>
                )}
              </div>
              {c.desc && (
                <p data-slot="schema-detail-column-desc" className="m-dev-schema-detail__column-desc">
                  {richText(c.desc)}
                </p>
              )}
            </li>
          ))}
        </ul>

        <EdgeList title="指向别人" edges={out} dir="out" onJump={onJump} />

        <EdgeList title="被谁指着" edges={inc} dir="in" onJump={onJump} />

        {table.rels && table.rels.length > 0 && (
          <>
            <SectionTitle>关联关系</SectionTitle>
            <ul data-slot="schema-detail-rels" className="m-dev-schema-detail__list">
              {table.rels.map((r, i) => (
                <li data-slot="schema-detail-rel" key={i}>
                  {richText(r)}
                </li>
              ))}
            </ul>
          </>
        )}

        {table.rules && table.rules.length > 0 && (
          <>
            <SectionTitle>跨字段约束与不变式</SectionTitle>
            <ul data-slot="schema-detail-rules" className="m-dev-schema-detail__list">
              {table.rules.map((r, i) => (
                <li data-slot="schema-detail-rule" key={i}>
                  {richText(r)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}

// ── 页面 ──────────────────────────────────────────────────────────────────

function Lab() {
  const rf = useReactFlow()
  const { resolvedTheme, setTheme } = useAppTheme()
  const [query, setQuery] = useState('')
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set())
  const [showSoft, setShowSoft] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const fkCount = EDGES.filter((e) => e.kind === 'fk').length
  const softCount = EDGES.filter((e) => e.kind === 'soft').length

  const jump = useCallback(
    (name: string) => {
      const table = TABLE_BY_NAME.get(name)
      if (!table) return
      setSelected(name)
      void rf.setCenter(table.x + NODE_WIDTH / 2, table.y + table.h / 2, { zoom: 0.8, duration: 500 })
    },
    [rf],
  )

  const toggleGroup = (id: string) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div data-slot="schema-lab" className="m-dev-schema-lab">
      <header data-slot="schema-lab-header" className="m-dev-schema-lab__header">
        <h1 data-slot="schema-lab-title" className="m-dev-schema-lab__title">
          数据库模型
        </h1>
        <span data-slot="schema-lab-stats" className="m-dev-schema-lab__stats">
          {TABLES.length} 表 · {fkCount} 外键 · {softCount} 逻辑引用
        </span>
        <TextField
          aria-label="搜索表名或字段"
          placeholder="搜表名 / 字段，回车跳转"
          size="sm"
          value={query}
          onChange={(e) => setQuery(e)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const q = query.trim().toLowerCase()
            const found = TABLES.find((t) => t.name.toLowerCase().includes(q))
            if (found) jump(found.name)
          }}
        />
        <Switch size="sm" isSelected={showSoft} onChange={setShowSoft}>
          逻辑引用
        </Switch>
        <Button variant="secondary" size="sm" onPress={() => void rf.fitView({ padding: 0.06, duration: 400 })}>
          适应画布
        </Button>

        <div data-slot="schema-lab-groups" className="m-dev-schema-lab__groups">
          {GROUPS.map((g) => {
            const off = hiddenGroups.has(g.id)
            return (
              <TooltipTrigger key={g.id} delay={300}>
                <ToggleButton
                  isSelected={!off}
                  onChange={() => toggleGroup(g.id)}
                  className="m-dev-schema-lab__group-toggle"
                >
                  <span
                    data-slot="schema-lab-group-swatch"
                    aria-hidden
                    className="m-dev-schema-lab__group-swatch"
                    style={{ background: g.color }}
                  />
                  {g.title}
                </ToggleButton>
                <Tooltip placement="bottom">{g.desc}</Tooltip>
              </TooltipTrigger>
            )
          })}
          <TooltipTrigger>
            <Button
              icon={resolvedTheme === 'dark' ? <Sun /> : <Moon />}
              aria-label="切换主题"
              variant="secondary"
              size="sm"
              onPress={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            />
            <Tooltip placement="bottom">切换主题</Tooltip>
          </TooltipTrigger>
        </div>
      </header>

      <div data-slot="schema-lab-body" className="m-dev-schema-lab__body">
        <div data-slot="schema-lab-canvas" className="m-dev-schema-lab__canvas">
          <Canvas
            query={query}
            hiddenGroups={hiddenGroups}
            showSoft={showSoft}
            selected={selected}
            onSelect={setSelected}
          />
          <p data-slot="schema-lab-legend" className="m-dev-schema-lab__legend">
            实线 = 真外键（标注 ON DELETE 行为） · 虚线 = 代码维护的逻辑引用，故意不建外键
          </p>
        </div>
        <DetailPanel name={selected} onClose={() => setSelected(null)} onJump={jump} />
      </div>
    </div>
  )
}

export default function SchemaLab() {
  return (
    <ReactFlowProvider>
      <Lab />
    </ReactFlowProvider>
  )
}
