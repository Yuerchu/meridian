import { useState } from 'react'
import { Bin, FaceSmile } from '@keyline-icons/react/two-tone'
import { EmojiPicker, FloatingToc, Kanban, Resizable } from '@/components/base'
import { CommandPalette } from '@/components/yuerchu-ui/components/command-palette/command-palette'
import { MenuItem, MenuSection } from '@/components/yuerchu-ui/components/menu/menu'
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
        <SegmentedControl aria-label="传输" defaultSelectedKey="stdio">
          <Segment id="stdio">stdio</Segment>
          <Segment id="streamablehttp">HTTP</Segment>
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

/** The overlays the product opens on its own terms: bulk bar, confirm, emoji. */
export function OverlayParts() {
  const [bar, setBar] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const [emoji, setEmoji] = useState(false)
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
