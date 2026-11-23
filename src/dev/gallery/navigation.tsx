import { useState } from 'react'
import { Archive, Gauge, Messages, Plug } from '@keyline-icons/react/two-tone'

import { NavGroup, NavItem, NavList, NavSection } from '@/components/yuerchu-ui/components/nav-list/nav-list'
import { Pagination } from '@/components/yuerchu-ui/components/pagination/pagination'
import { Tab, TabList, TabPanel, Tabs } from '@/components/yuerchu-ui/components/tabs/tabs'
import { AppShell } from '@/components/yuerchu-ui/templates/app-shell/app-shell'
import { Section, Stage } from './shell'
import { NavigationParts } from './parts'

function TabsCase() {
  return (
    <Stage>
      <Tabs defaultSelectedKey="usage">
        <TabList aria-label="设置分区">
          <Tab id="usage" icon={<Gauge />} count={3}>
            用量
          </Tab>
          <Tab id="mcp" icon={<Plug />}>
            MCP
          </Tab>
          <Tab id="general">通用</Tab>
        </TabList>
        <TabPanel id="usage">用量面板</TabPanel>
        <TabPanel id="mcp">MCP 面板</TabPanel>
        <TabPanel id="general">通用面板</TabPanel>
      </Tabs>
    </Stage>
  )
}

function PaginationCase() {
  const [page, setPage] = useState(3)
  return (
    <Stage>
      <Pagination page={page} totalPages={12} onChange={setPage} aria-label="贴纸分页" />
    </Stage>
  )
}

export default function Navigation() {
  return (
    <>
      <Section title="Tabs">
        <TabsCase />
      </Section>
      <Section title="Pagination">
        <PaginationCase />
      </Section>
      <Section title="NavList">
        <Stage>
          <NavList size="sm" showGuides aria-label="示例导航">
            <NavSection header="工作区">
              <NavGroup label="Meridian" defaultExpanded>
                <NavItem icon={<Messages />} isCurrent trailing="2分钟前">
                  侧边栏迁移
                </NavItem>
                <NavItem icon={<Archive />} trailing="1小时前">
                  历史归档
                </NavItem>
              </NavGroup>
            </NavSection>
          </NavList>
        </Stage>
      </Section>
      <Section title="AppShell">
        <AppShell
          embedded
          variant="inset"
          brand={null}
          showMobileBar={false}
          sidebarLabel="侧边栏"
          navigation={<p>导航</p>}
        >
          <p>主内容</p>
        </AppShell>
      </Section>
      <NavigationParts />
    </>
  )
}
