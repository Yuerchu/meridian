import { useState } from 'react'
import type { Key, Selection } from 'react-aria-components'
import { Check, FileText, Folder } from '@keyline-icons/react/two-tone'

import { ListBox } from '@/components/base'
import { DataTable, type DataTableColumn } from '@/components/yuerchu-ui/components/data-table/data-table'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '@/components/yuerchu-ui/components/table/table'
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

const COLUMNS: DataTableColumn<Server>[] = [
  { id: 'name', header: '名称', isRowHeader: true, sortValue: (s) => s.name },
  { id: 'transport', header: '传输' },
  { id: 'tools', header: '工具数', align: 'end', sortValue: (s) => s.tools },
]

function Tables() {
  const [selected, setSelected] = useState<Set<Key>>(new Set(['gh']))
  const [tableSelected, setTableSelected] = useState<Selection>(new Set(['fs']))
  return (
    <div className="flex flex-col gap-4">
      <DataTable<Server>
        aria-label="MCP 服务器 · DataTable"
        size="sm"
        columns={COLUMNS}
        rows={SERVERS}
        getRowId={(s) => s.id}
        selectionMode="multiple"
        selectedKeys={selected}
        onSelectionChange={setSelected}
      />
      <Table
        aria-label="MCP 服务器 · Table"
        size="sm"
        selectionMode="multiple"
        selectedKeys={tableSelected}
        onSelectionChange={setTableSelected}
      >
        <TableHeader>
          <Column id="name" isRowHeader>
            名称
          </Column>
          <Column id="transport">传输</Column>
          <Column id="tools" data-align="end">
            工具数
          </Column>
        </TableHeader>
        <TableBody items={SERVERS}>
          {(s) => (
            <Row id={s.id}>
              <Cell>{s.name}</Cell>
              <Cell>{s.transport}</Cell>
              <Cell>{s.tools}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      <DataTable<Server>
        aria-label="空表"
        size="sm"
        columns={COLUMNS}
        rows={[]}
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

export default function Data() {
  return (
    <>
      <Section title="Table / DataTable（库）">
        <Tables />
      </Section>
      <Section title="ListBox">
        <Lists />
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
      <DataParts />
    </>
  )
}
