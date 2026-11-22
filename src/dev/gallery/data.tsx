import { useState } from 'react'
import { Check, FileText, Folder } from '@keyline-icons/react/two-tone'

import {
  DataGrid,
  Disclosure,
  ListBox,
  ScrollShadow,
  type DataGridColumn,
  type DataGridSelection,
} from '@/components/base'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
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
        renderEmptyState={() => <EmptyState heading="还没有 MCP 服务器" headingLevel={3} size="sm" />}
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
    <div className="flex flex-col gap-2">
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
    </div>
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
      <Section title="Disclosure">
        <Disclosures />
      </Section>
      <Section title="SettingsGroup / SettingsRow（库）">
        <SettingsGroup heading="通用" description="这些设置仅对当前设备生效。">
          <SettingsRow label="外观" description="浅色、深色或跟随系统。">
            <Switch defaultSelected />
          </SettingsRow>
          <SettingsRow label="发送消息" description="关闭后使用 Ctrl + Enter 发送。">
            <Switch />
          </SettingsRow>
        </SettingsGroup>
      </Section>
      <Section title="ScrollShadow">
        <Scroll />
      </Section>
      <DataParts />
    </>
  )
}
