import { useState } from 'react'
import { Archive, Folder, Gauge, Messages, Plug } from '@keyline-icons/react/two-tone'

import { FileDetails } from '@/components/yuerchu-ui/blocks/file-details/file-details'
import { NavGroup, NavItem, NavList, NavSection } from '@/components/yuerchu-ui/components/nav-list/nav-list'
import { Pagination } from '@/components/yuerchu-ui/components/pagination/pagination'
import { PathBar, type PathSegment } from '@/components/yuerchu-ui/components/path-bar/path-bar'
import { Tab, TabList, TabPanel, Tabs } from '@/components/yuerchu-ui/components/tabs/tabs'
import { AppShell } from '@/components/yuerchu-ui/templates/app-shell/app-shell'
import { FileManager } from '@/components/yuerchu-ui/templates/file-manager/file-manager'
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

const SAMPLE_SEGMENTS: readonly PathSegment[] = [
  { id: 'root', label: '表情包', icon: <Folder /> },
  { id: 'daily', label: '日常' },
]

function PathBarCase() {
  const [segments, setSegments] = useState<readonly PathSegment[]>(SAMPLE_SEGMENTS)
  return (
    <Stage>
      <PathBar
        segments={segments}
        onNavigate={(id) => {
          const idx = SAMPLE_SEGMENTS.findIndex((s) => s.id === id)
          if (idx >= 0) setSegments(SAMPLE_SEGMENTS.slice(0, idx + 1))
        }}
        aria-label="表情路径"
      />
    </Stage>
  )
}

function FileManagerCase() {
  const [tags, setTags] = useState(['可爱', '好奇'])
  return (
    <FileManager
      embedded
      headingLevel={3}
      heading="日常表情包"
      description="统一管理本地表情资源与语义标签"
      details={
        <FileDetails
          heading="猫猫探头"
          info={[
            { label: '状态', value: '已确认' },
            { label: '出现次数', value: '3' },
          ]}
          tags={tags}
          onTagsChange={setTags}
        />
      }
    >
      <p>文件列表区域</p>
    </FileManager>
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
      <Section title="PathBar">
        <PathBarCase />
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
      <Section title="FileManager & FileDetails">
        <FileManagerCase />
      </Section>
      <NavigationParts />
    </>
  )
}
