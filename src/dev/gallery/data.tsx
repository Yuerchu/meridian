import { useState } from 'react'
import { Check, FileText, Folder, Plug } from '@keyline-icons/react/two-tone'

import {
  Button,
  DataGrid,
  Disclosure,
  DisclosureGroup,
  EmptyState,
  ItemCard,
  ItemCardGroup,
  ListBox,
  ScrollShadow,
  type DataGridColumn,
  type DataGridSelection,
} from '@/components/base'
import { Section, Stage } from './shell'
import { DataParts } from './parts'

interface Server {
  id: string
  name: string
  transport: string
  tools: number
}

const SERVERS: Server[] = [
  { id: 'fs', name: 'filesystem', transport: 'stdio', tools: 11 },
  { id: 'gh', name: 'github', transport: 'http', tools: 42 },
  { id: 'pw', name: 'playwright', transport: 'stdio', tools: 23 },
  { id: 'db', name: 'sqlite', transport: 'stdio', tools: 6 },
]

const COLUMNS: DataGridColumn<Server>[] = [
  { key: 'name', header: '名称', accessorKey: 'name', isRowHeader: true, allowsSorting: true },
  { key: 'transport', header: '传输', accessorKey: 'transport' },
  { key: 'tools', header: '工具数', cell: (s) => s.tools, align: 'end' },
]

function Grids() {
  const [selected, setSelected] = useState<DataGridSelection>(new Set(['gh']))
  return (
    <div className="flex flex-col gap-4">
      {(['primary', 'secondary'] as const).map((variant) => (
        <DataGrid<Server>
          key={variant}
          aria-label={`MCP 服务器 · ${variant}`}
          variant={variant}
          columns={COLUMNS}
          data={SERVERS}
          getRowId={(s) => s.id}
          selectionMode="multiple"
          showSelectionCheckboxes
          selectedKeys={selected}
          onSelectionChange={setSelected}
        />
      ))}
      <DataGrid<Server>
        aria-label="空表"
        columns={COLUMNS}
        data={[]}
        getRowId={(s) => s.id}
        renderEmptyState={() => (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>还没有 MCP 服务器</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        )}
      />
    </div>
  )
}

function Lists() {
  return (
    <Stage>
      <ListBox aria-label="移动到" selectionMode="single" defaultSelectedKeys={['meridian']} className="gap-1">
        {[
          { id: 'none', label: '不属于任何项目', icon: FileText },
          { id: 'meridian', label: 'meridian', icon: Folder },
          { id: 'core', label: 'meridian-core', icon: Folder },
        ].map(({ id, label, icon: Icon }) => (
          <ListBox.Item key={id} id={id} textValue={label}>
            {({ isSelected }) => (
              <>
                <Icon className="size-4 text-text-secondary" aria-hidden />
                {label}
                {isSelected ? (
                  <ListBox.ItemIndicator>
                    <Check className="size-4" aria-hidden />
                  </ListBox.ItemIndicator>
                ) : null}
              </>
            )}
          </ListBox.Item>
        ))}
      </ListBox>
    </Stage>
  )
}

function Disclosures() {
  return (
    <DisclosureGroup className="flex flex-col gap-2">
      {['默认助手', '代码审查员'].map((name, i) => (
        <Disclosure
          key={name}
          id={name}
          defaultExpanded={i === 0}
          className="flex w-full flex-col overflow-hidden rounded-lg border border-border-button-default"
        >
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-body-regular outline-none">
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <Disclosure.Indicator />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="px-3 pb-3 text-body-2-regular text-text-secondary">
              模型 claude-sonnet-5 · 工具 12 个 · 记忆开启
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      ))}
    </DisclosureGroup>
  )
}

function ItemCards() {
  return (
    <ItemCardGroup variant="transparent">
      <ItemCardGroup.Header className="px-1.5">
        <ItemCardGroup.Title>MCP 服务器</ItemCardGroup.Title>
      </ItemCardGroup.Header>
      <ItemCardGroup className="overflow-hidden">
        {SERVERS.slice(0, 3).map((s) => (
          <ItemCard key={s.id}>
            <ItemCard.Icon>
              <Plug />
            </ItemCard.Icon>
            <ItemCard.Content>
              <ItemCard.Title>{s.name}</ItemCard.Title>
              <ItemCard.Description>
                {s.transport} · {s.tools} 个工具
              </ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action>
              <Button size="small" variant="secondary">
                编辑
              </Button>
            </ItemCard.Action>
          </ItemCard>
        ))}
      </ItemCardGroup>
    </ItemCardGroup>
  )
}

function Scroll() {
  return (
    <Stage>
      <ScrollShadow hideScrollBar orientation="horizontal" className="min-w-0">
        <div className="flex w-max gap-2">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className="rounded-full bg-background-secondary-default px-3 py-1 text-body-2-medium">
              表情包 {i + 1}
            </span>
          ))}
        </div>
      </ScrollShadow>
    </Stage>
  )
}

export default function Data() {
  return (
    <>
      <Section title="DataGrid">
        <Grids />
      </Section>
      <Section title="ListBox">
        <Lists />
      </Section>
      <Section title="Disclosure / DisclosureGroup">
        <Disclosures />
      </Section>
      <Section title="ItemCard">
        <ItemCards />
      </Section>
      <Section title="ScrollShadow">
        <Scroll />
      </Section>
      <DataParts />
    </>
  )
}
