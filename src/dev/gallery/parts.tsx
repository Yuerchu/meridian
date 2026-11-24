import { useState } from 'react'
import { Bin } from '@keyline-icons/react/two-tone'
import {
  Kanban,
  KanbanCard,
  KanbanColumn,
  type KanbanColumnData,
  type KanbanItem,
} from '@/components/yuerchu-ui/components/kanban/kanban'
import { CommandPalette } from '@/components/yuerchu-ui/components/command-palette/command-palette'
import { MenuItem, MenuSection } from '@/components/yuerchu-ui/components/menu/menu'
import { ResizablePanels } from '@/components/yuerchu-ui/components/resizable-panels/resizable-panels'
import { SelectionBar } from '@/components/yuerchu-ui/components/selection-bar/selection-bar'
import { Tree, TreeItem } from '@/components/yuerchu-ui/components/tree/tree'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { ConversationIcon, HostedAgentGlyph } from '@/components/ui/agent-icon'
import { useConfirm } from '@/hooks/use-confirm'
import { ErrorAlert } from '@/components/ui/error-alert'
import { Hint } from '@/components/ui/hint'
import { ModelIcon } from '@/components/ui/model-icon'
import { PathLabel } from '@/components/ui/path-label'
import { ProviderMark } from '@/components/ui/provider-icon'
import { Section } from './shell'
import { DraggableKanban } from './kanban-demo'

function noop() {}

/** Marks, labels and the small inline pieces the product draws everywhere. */
export function CoreParts() {
  return (
    <>
      <Section title="ModelIcon · ProviderMark · HostedAgentGlyph · ConversationIcon">
        <div className="flex flex-wrap items-center gap-4">
          {['claude-sonnet-5', 'gpt-5.1', 'gemini-3-flash', 'deepseek-v4', 'qwen3-coder'].map((model) => (
            <span key={model} className="flex items-center gap-1.5 text-body-2-regular text-text-secondary">
              <ModelIcon model={model} size={18} />
              {model}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {['openai', 'anthropic', 'google', 'ollama'].map((type) => (
            <ProviderMark key={type} providerType={type} size={20} />
          ))}
          <HostedAgentGlyph />
          <ConversationIcon />
          <ConversationIcon agentKind="claude-code" />
        </div>
      </Section>
      <Section title="PathLabel · Hint · Link">
        <div className="flex max-w-md flex-col gap-3">
          <PathLabel path="src/components/chat/plan-review-entry.tsx" />
          <PathLabel path="src-tauri/crates/core/src/workspace/git.rs" wrap />
          <p className="text-body-2-regular text-text-secondary">
            悬停看说明：<Hint label="run_command 在受限令牌沙箱里运行">沙箱</Hint>
          </p>
          <Button variant="ghost" size="sm" onPress={noop}>
            已压缩 12 条消息
          </Button>
        </div>
      </Section>
      <Section title="ErrorAlert / 带原因的错误">
        <div className="flex max-w-xl flex-col gap-3">
          <ErrorAlert message="connection refused (os error 10061)" />
          <ErrorAlert title="无法加载会话" message="database is locked" onRetry={noop} />
        </div>
      </Section>
    </>
  )
}

const READONLY_KANBAN: KanbanColumnData<KanbanItem>[] = [
  { id: 'todo', heading: '待做', cards: [{ id: 'k1', textValue: '补过期 token 的测试' }] },
  { id: 'doing', heading: '进行中', cards: [{ id: 'k2', textValue: '抽出 verify_token' }] },
  {
    id: 'done',
    heading: '已完成',
    cards: [
      { id: 'k3', textValue: '确认走 middleware' },
      { id: 'k4', textValue: '列出三个路由' },
    ],
  },
]

/** A file tree and a board, the two collections the product builds on. */
export function DataParts() {
  return (
    <>
      <Section title="Tree / 文件树（库）">
        <div className="max-w-sm rounded-2xl bg-background-secondary-default p-2">
          <Tree aria-label="改动" size="sm" selectionMode="none" defaultExpandedKeys={['src', 'chat']}>
            <TreeItem id="src" label="src">
              <TreeItem id="chat" label="components/chat">
                <TreeItem id="entry" label="plan-review-entry.tsx" actions={<span aria-hidden>A</span>} />
                <TreeItem id="tab" label="composer-status-tab.tsx" actions={<span aria-hidden>M</span>} />
              </TreeItem>
              <TreeItem id="hook" label="hooks/use-project-branch.ts" actions={<span aria-hidden>A</span>} />
            </TreeItem>
          </Tree>
        </div>
      </Section>
      <Section title="Kanban / 看板（库）">
        <div className="max-w-2xl">
          <Kanban columns={READONLY_KANBAN} isReadOnly aria-label="待办">
            {(column) => (
              <KanbanColumn key={column.id} column={column}>
                {(card) => <KanbanCard key={card.id} card={card} />}
              </KanbanColumn>
            )}
          </Kanban>
        </div>
      </Section>
      <Section title="Kanban / 拖拽">
        {/* Pointer: drag a card. Keyboard: Tab to a card's grip, Enter to pick
            it up, Tab to a drop position, Enter to drop. */}
        <DraggableKanban />
      </Section>
      <Section title="ResizablePanels / 可拖拽分栏">
        <div className="h-40 max-w-2xl overflow-hidden rounded-2xl ring-1 ring-border-button-default ring-inset">
          <ResizablePanels orientation="horizontal" defaultSize={60} minSize={20} maxSize={80} className="h-full">
            {[
              <div
                key="left"
                className="flex h-full items-center justify-center text-body-2-regular text-text-secondary"
              >
                对话
              </div>,
              <div
                key="right"
                className="flex h-full items-center justify-center text-body-2-regular text-text-secondary"
              >
                改动
              </div>,
            ]}
          </ResizablePanels>
        </div>
      </Section>
    </>
  )
}

/** The segmented choice, the outline strip and the palette's parts. */
export function NavigationParts() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  return (
    <>
      <Section title="SegmentedControl">
        <SegmentedControl aria-label="传输" defaultSelectedKey="stdio">
          <Segment id="stdio">stdio</Segment>
          <Segment id="streamablehttp">HTTP</Segment>
        </SegmentedControl>
      </Section>
      <Section title="CommandPalette（库）">
        <Button variant="secondary" onPress={() => setPaletteOpen(true)}>
          打开命令面板
        </Button>
        <CommandPalette isOpen={paletteOpen} onOpenChange={setPaletteOpen} shortcut={false} aria-label="命令">
          <MenuSection header="操作">
            <MenuItem id="new">新对话</MenuItem>
          </MenuSection>
          <MenuSection header="最近">
            <MenuItem id="c1" description="middleware 之后不再读环境变量">
              鉴权改走 middleware
            </MenuItem>
          </MenuSection>
        </CommandPalette>
      </Section>
    </>
  )
}

/** The overlays the product opens on its own terms: bulk bar, confirm. */
export function OverlayParts() {
  const [bar, setBar] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  return (
    <>
      <Section title="SelectionBar / 批量选择（库）">
        <Button variant="secondary" onPress={() => setBar((v) => !v)}>
          {bar ? '清空选择' : '选中 3 项'}
        </Button>
        {bar && (
          <SelectionBar selectedCount={3} onClear={() => setBar(false)}>
            <Button icon={<Bin />} size="sm" variant="destructive" onPress={() => setBar(false)}>
              删除所选
            </Button>
          </SelectionBar>
        )}
      </Section>
      <Section title="useConfirm / 确认">
        <Button
          variant="destructive"
          onPress={() =>
            void confirm({ description: '从这条消息往后的整段都会删除。', confirmLabel: '删除', tone: 'danger' })
          }
        >
          删除这段对话
        </Button>
        {confirmDialog}
      </Section>
    </>
  )
}
