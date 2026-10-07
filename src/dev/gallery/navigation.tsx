import { useState } from 'react'
import { Archive, FolderPlus, Gauge, Messages, Plug, Search, Settings } from '@keyline-icons/react/two-tone'

import { Pagination, Sidebar, Tab, TabList, TabPanel, Tabs } from '@/components/base'
import { PillTab, PillTabList } from '@/components/base/tabs/pill-tab'
import { Row, Section, Stage } from './shell'
import { NavigationParts } from './parts'

function TabsCase() {
  const [pill, setPill] = useState('all')
  return (
    <Stage>
      <Tabs defaultSelectedKey="usage">
        <TabList aria-label="设置分区">
          <Tab id="usage" icon={Gauge} count={3}>
            用量
          </Tab>
          <Tab id="mcp" icon={Plug}>
            MCP
          </Tab>
          <Tab id="general">通用</Tab>
        </TabList>
        <TabPanel id="usage" className="text-body-2-regular text-text-secondary">
          用量面板
        </TabPanel>
        <TabPanel id="mcp" className="text-body-2-regular text-text-secondary">
          MCP 面板
        </TabPanel>
        <TabPanel id="general" className="text-body-2-regular text-text-secondary">
          通用面板
        </TabPanel>
      </Tabs>
      {(['blue', 'gray'] as const).map((variant) => (
        <Row key={variant} label={`PillTab · ${variant}`}>
          <PillTabList>
            {['all', 'approvals', 'questions'].map((id) => (
              <PillTab key={id} variant={variant} isSelected={pill === id} onSelect={() => setPill(id)}>
                {{ all: '全部', approvals: '审批', questions: '提问' }[id]}
              </PillTab>
            ))}
          </PillTabList>
        </Row>
      ))}
    </Stage>
  )
}

function PaginationCase() {
  const [page, setPage] = useState(3)
  return (
    <Stage>
      <Pagination
        page={page}
        totalPages={12}
        onChange={setPage}
        aria-label="贴纸分页"
        previousLabel="上一页"
        nextLabel="下一页"
        pageLabel={(n) => `第 ${n} 页`}
      />
    </Stage>
  )
}

/**
 * The panel by itself, at a fixed height: the shell's real sidebar has the
 * whole app behind it, and what is worth seeing here is the row vocabulary —
 * the navigation row's accent, the thread row's neutral fill, the pill.
 */
function SidebarCase() {
  const [open, setOpen] = useState(true)
  return (
    <div className="h-[26rem] overflow-hidden rounded-3xl ring-1 ring-border-button-default">
      <Sidebar.Provider open={open} onOpenChange={setOpen}>
        <Sidebar className="flex">
          <Sidebar.Header className="flex items-center justify-between">
            <Sidebar.Trigger aria-label="收起侧栏" />
          </Sidebar.Header>
          <Sidebar.Content>
            <Sidebar.Menu aria-label="导航">
              <Sidebar.MenuItem id="search" textValue="搜索" appearance="pill">
                <Sidebar.MenuIcon>
                  <Search />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>搜索</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
              <Sidebar.MenuItem id="chats" textValue="对话" isCurrent>
                <Sidebar.MenuIcon>
                  <Messages />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>对话</Sidebar.MenuLabel>
                <Sidebar.MenuChip>3</Sidebar.MenuChip>
              </Sidebar.MenuItem>
              <Sidebar.MenuItem id="project" textValue="新建项目">
                <Sidebar.MenuIcon>
                  <FolderPlus />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>新建项目</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
              <Sidebar.MenuItem id="archive" textValue="已归档">
                <Sidebar.MenuIcon>
                  <Archive />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>已归档</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
            <Sidebar.Group>
              <Sidebar.GroupLabel>今天</Sidebar.GroupLabel>
              <Sidebar.Menu aria-label="对话">
                <Sidebar.MenuItem id="t1" textValue="流式输出时回答写在屏幕外" appearance="thread" isCurrent>
                  <Sidebar.MenuLabel>流式输出时回答写在屏幕外</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem id="t2" textValue="设置页导出入口" appearance="thread">
                  <Sidebar.MenuLabel>设置页导出入口</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.Group>
          </Sidebar.Content>
          <Sidebar.Footer>
            <Sidebar.Menu aria-label="底部">
              <Sidebar.MenuItem id="settings" textValue="设置">
                <Sidebar.MenuIcon>
                  <Settings />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>设置</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Footer>
        </Sidebar>
        <Sidebar.Main className="items-center justify-center text-body-2-regular text-text-secondary">
          Sidebar.Main
        </Sidebar.Main>
      </Sidebar.Provider>
    </div>
  )
}

export default function Navigation() {
  return (
    <>
      <Section title="Tabs / PillTab">
        <TabsCase />
      </Section>
      <Section title="Pagination">
        <PaginationCase />
      </Section>
      <Section title="Sidebar · 导航行 / 线程行 / 胶囊 / 图标栏">
        <SidebarCase />
      </Section>
      <NavigationParts />
    </>
  )
}
