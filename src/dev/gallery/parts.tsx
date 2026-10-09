import { useState } from 'react'
import { Bin, Bot, FaceSmile, Search } from '@keyline-icons/react/two-tone'
import {
  ActionBar,
  Button,
  Command,
  EmojiPicker,
  FloatingToc,
  Kanban,
  Link,
  Resizable,
  TreeView,
  TreeViewItem,
} from '@/components/base'
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control'
import { NotificationBell } from '@/components/application/app-shell/notification-bell'
import type { NotificationCenterItem } from '@/components/application/notification-center/notification-center'
import { ConversationIcon, HostedAgentGlyph } from '@/components/ui/agent-icon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
          <Link onPress={noop}>已压缩 12 条消息</Link>
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

/** A file tree and a board, the two collections the product builds on. */
export function DataParts() {
  return (
    <>
      <Section title="TreeView / 文件树">
        <div className="max-w-sm rounded-2xl bg-background-secondary-default p-2">
          <TreeView aria-label="改动" size="sm" selectionMode="none" defaultExpandedKeys={['src', 'chat']}>
            <TreeViewItem id="src" label="src">
              <TreeViewItem id="chat" label="components/chat">
                <TreeViewItem id="entry" label="plan-review-entry.tsx" trailingContent="A" />
                <TreeViewItem id="tab" label="composer-status-tab.tsx" trailingContent="M" />
              </TreeViewItem>
              <TreeViewItem id="hook" label="hooks/use-project-branch.ts" trailingContent="A" />
            </TreeViewItem>
          </TreeView>
        </div>
      </Section>
      <Section title="Kanban / 看板">
        <Kanban size="sm" aria-label="待办" className="max-w-2xl [--kanban-column-height:auto]">
          {[
            ['待做', ['补过期 token 的测试']],
            ['进行中', ['抽出 verify_token']],
            ['已完成', ['确认走 middleware', '列出三个路由']],
          ].map(([title, cards]) => (
            <Kanban.Column key={title as string}>
              <Kanban.ColumnHeader>
                <Kanban.ColumnTitle>{title}</Kanban.ColumnTitle>
                <Kanban.ColumnCount>{(cards as string[]).length}</Kanban.ColumnCount>
              </Kanban.ColumnHeader>
              <Kanban.ColumnBody>
                <Kanban.CardList aria-label={title as string}>
                  {(cards as string[]).map((card) => (
                    <Kanban.Card key={card} id={card} textValue={card}>
                      <div className="p-2.5 text-caption-1-regular">{card}</div>
                    </Kanban.Card>
                  ))}
                </Kanban.CardList>
              </Kanban.ColumnBody>
            </Kanban.Column>
          ))}
        </Kanban>
      </Section>
      <Section title="Kanban / 拖拽">
        {/* Pointer: drag a card. Keyboard: Tab to a card's grip, Enter to pick
            it up, Tab to a drop position, Enter to drop. */}
        <DraggableKanban />
      </Section>
      <Section title="Resizable / 可拖拽分栏">
        <div className="h-40 max-w-2xl overflow-hidden rounded-2xl ring-1 ring-border-button-default ring-inset">
          <Resizable orientation="horizontal" className="h-full">
            <Resizable.Panel id="left" defaultSize="60%" minSize="20%">
              <div className="flex h-full items-center justify-center text-body-2-regular text-text-secondary">
                对话
              </div>
            </Resizable.Panel>
            <Resizable.Handle />
            <Resizable.Panel id="right" defaultSize="40%" minSize="20%">
              <div className="flex h-full items-center justify-center text-body-2-regular text-text-secondary">
                改动
              </div>
            </Resizable.Panel>
          </Resizable>
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
        <SegmentedControl aria-label="传输" defaultSelectedKeys={['stdio']}>
          <SegmentedControlItem id="stdio">stdio</SegmentedControlItem>
          <SegmentedControlItem id="streamablehttp">HTTP</SegmentedControlItem>
        </SegmentedControl>
      </Section>
      <Section title="FloatingToc / 对话小地图">
        <div className="relative flex h-40 max-w-md items-center justify-end rounded-2xl bg-background-secondary-default pe-2">
          <FloatingToc placement="right">
            <FloatingToc.Trigger aria-label="对话目录">
              {[0, 1, 2, 3, 4].map((i) => (
                <FloatingToc.Bar key={i} active={i === 2} />
              ))}
            </FloatingToc.Trigger>
            <FloatingToc.Content>
              {['鉴权改走 middleware', '先别动 handler', '补测试', '跑一遍 clippy', '提交'].map((q, i) => (
                <FloatingToc.Item key={q} active={i === 2} onPress={noop}>
                  {q}
                </FloatingToc.Item>
              ))}
            </FloatingToc.Content>
          </FloatingToc>
        </div>
      </Section>
      <Section title="Command / 命令面板底座">
        <Button variant="secondary" onPress={() => setPaletteOpen(true)}>
          打开 Command
        </Button>
        <Command>
          <Command.Backdrop isOpen={paletteOpen} onOpenChange={setPaletteOpen}>
            <Command.Container size="md">
              <Command.Dialog aria-label="命令">
                <Command.Header>
                  <Command.InputGroup aria-label="命令">
                    <Command.InputGroup.Prefix>
                      <Search className="size-4" />
                    </Command.InputGroup.Prefix>
                    <Command.InputGroup.Input placeholder="搜索对话和命令…" />
                    <Command.InputGroup.ClearButton aria-label="清除" />
                  </Command.InputGroup>
                </Command.Header>
                <Command.List aria-label="命令" renderEmptyState={() => '没有结果'}>
                  <Command.Group heading="操作">
                    <Command.Item id="new" textValue="新对话" onAction={() => setPaletteOpen(false)}>
                      新对话
                    </Command.Item>
                  </Command.Group>
                  <Command.Group heading="最近">
                    <Command.Item id="c1" textValue="鉴权改走 middleware">
                      鉴权改走 middleware
                    </Command.Item>
                  </Command.Group>
                </Command.List>
              </Command.Dialog>
            </Command.Container>
          </Command.Backdrop>
        </Command>
      </Section>
    </>
  )
}

const INBOX: NotificationCenterItem[] = [
  {
    id: 'n1',
    category: 'system',
    group: '鉴权改走 middleware',
    title: 'run_command 等待批准',
    description: 'cargo test --workspace',
    timestamp: '刚刚',
    unread: true,
    status: 'information',
  },
  {
    id: 'n2',
    category: 'system',
    group: '导出功能计划',
    title: '计划等待审阅',
    description: '第 3 版',
    timestamp: '5 分钟前',
    icon: Bot,
  },
]

/** The overlays the product opens on its own terms: bulk bar, inbox, confirm, emoji. */
export function OverlayParts() {
  const [bar, setBar] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [emoji, setEmoji] = useState(false)
  return (
    <>
      <Section title="ActionBar / 批量操作条（固定在视口底部）">
        <Button variant="secondary" onPress={() => setBar((v) => !v)}>
          {bar ? '收起' : '选中 3 项'}
        </Button>
        <ActionBar isOpen={bar}>
          <ActionBar.Prefix>
            <span className="text-body-regular text-text-secondary">已选 3 项</span>
          </ActionBar.Prefix>
          <ActionBar.Content>
            <Button leadingIcon={Bin} variant="danger" onPress={() => setBar(false)}>
              删除所选
            </Button>
          </ActionBar.Content>
        </ActionBar>
      </Section>
      <Section title="NotificationBell / 待处理收件箱">
        <NotificationBell notifications={INBOX} triggerLabel="待处理 2 项" dialogLabel="待处理" />
      </Section>
      <Section title="ConfirmDialog / 确认">
        <Button variant="danger" onPress={() => setConfirm(true)}>
          删除这段对话
        </Button>
        <ConfirmDialog
          isOpen={confirm}
          onOpenChange={setConfirm}
          onConfirm={() => setConfirm(false)}
          body="从这条消息往后的整段都会删除。"
          confirmLabel="删除"
        />
      </Section>
      <Section title="EmojiPicker">
        <EmojiPicker isOpen={emoji} onOpenChange={setEmoji} aria-label="表情">
          <EmojiPicker.Trigger aria-label="表情" leadingIcon={FaceSmile} />
          <EmojiPicker.Popover>
            <EmojiPicker.Content>
              <EmojiPicker.Grid items={['😀', '🎉', '👍', '🤔', '🔥', '✅', '🚀', '👀']}>
                {(item: string) => (
                  <EmojiPicker.Item id={item} textValue={item}>
                    {item}
                  </EmojiPicker.Item>
                )}
              </EmojiPicker.Grid>
            </EmojiPicker.Content>
          </EmojiPicker.Popover>
        </EmojiPicker>
      </Section>
    </>
  )
}
