import { useState } from 'react'
import { Copy, Hammer, Pen, Scissors, TriangleAlert } from '@keyline-icons/react/two-tone'

import {
  AlertDialog,
  Button,
  ContextMenu,
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
  Input,
  Kbd,
  Modal,
  Notification,
  Popover,
  Sheet,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import type { ModalSize } from '@/components/base/modal'
import type { SheetPlacement } from '@/components/base/sheet'
import { CommandPalette } from '@/components/layout/command-palette'
import { useHotkey } from '@/hooks/use-hotkey'
import { noop, PALETTE_PROJECTS, PALETTE_ROWS } from './fixtures'
import { Row, Section, Stage } from './shell'

function Menus() {
  return (
    <Stage>
      <Row>
        <Dropdown>
          <DropdownTrigger className="rounded-full bg-background-secondary-default px-3 py-1.5 text-body-medium">
            权限 · 手动
          </DropdownTrigger>
          <DropdownPopover aria-label="权限" selectionMode="single" defaultSelectedKeys={['ask']}>
            <DropdownGroup label="权限">
              <DropdownItem id="ask" textValue="手动">
                <Hammer className="size-5 text-foreground-icon-secondary" aria-hidden />
                <span className="flex flex-col">
                  <span>手动</span>
                  <span className="text-caption-1-regular text-text-secondary">每次修改前询问</span>
                </span>
              </DropdownItem>
              <DropdownItem id="accept" textValue="接受编辑">
                <Pen className="size-5 text-foreground-icon-secondary" aria-hidden />
                接受编辑
              </DropdownItem>
            </DropdownGroup>
            <DropdownGroup label="对话">
              <DropdownItem id="rename" textValue="重命名">
                重命名
                <Kbd className="ms-auto">F2</Kbd>
              </DropdownItem>
              <DropdownItem id="delete" textValue="删除" variant="danger">
                删除
              </DropdownItem>
              <DropdownItem id="disabled" textValue="不可用" isDisabled>
                不可用
              </DropdownItem>
            </DropdownGroup>
          </DropdownPopover>
        </Dropdown>
        <ContextMenu>
          <ContextMenu.Trigger className="rounded-2xl border border-dashed border-border-button-default px-4 py-3 text-body-2-regular text-text-secondary">
            在这里右键
          </ContextMenu.Trigger>
          <ContextMenu.Popover>
            <ContextMenu.Menu aria-label="右键菜单">
              <ContextMenu.Item id="cut" textValue="剪切">
                <Scissors className="size-4 text-text-secondary" />
                <span>剪切</span>
                <Kbd className="ms-auto">Ctrl X</Kbd>
              </ContextMenu.Item>
              <ContextMenu.Item id="copy" textValue="复制">
                <Copy className="size-4 text-text-secondary" />
                <span>复制</span>
                <Kbd className="ms-auto">Ctrl C</Kbd>
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item id="select" textValue="选择文字">
                <span>选择文字</span>
              </ContextMenu.Item>
            </ContextMenu.Menu>
          </ContextMenu.Popover>
        </ContextMenu>
      </Row>
    </Stage>
  )
}

function Hints() {
  return (
    <Stage>
      <Row label="Tooltip">
        {(['top', 'bottom', 'start', 'end'] as const).map((placement) => (
          <TooltipTrigger key={placement} delay={0}>
            <Button variant="secondary" size="small">
              {placement}
            </Button>
            <Tooltip placement={placement}>新对话</Tooltip>
          </TooltipTrigger>
        ))}
        <TooltipTrigger delay={0}>
          <Button variant="secondary" size="small">
            md · 无箭头
          </Button>
          <Tooltip size="md" showArrow={false}>
            较长的说明会换行，宽度跟内容走，不超过它的上限。
          </Tooltip>
        </TooltipTrigger>
      </Row>
      <Row label="Popover">
        <Popover>
          <Popover.Trigger className="rounded-full p-1 text-status-danger" aria-label="上下文用量出错">
            <TriangleAlert className="size-5" aria-hidden />
          </Popover.Trigger>
          <Popover.Content placement="top" className="max-w-72">
            <Popover.Dialog aria-label="上下文">
              <p className="text-body-2-regular">读取上下文用量失败：连接被拒绝。</p>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </Row>
    </Stage>
  )
}

function Dialogs() {
  const [modal, setModal] = useState<ModalSize | null>(null)
  const [alert, setAlert] = useState(false)
  const [sheet, setSheet] = useState<SheetPlacement | null>(null)
  return (
    <Stage>
      <Row label="Modal">
        {(['sm', 'md', 'lg', 'full', 'cover'] as const).map((size) => (
          <Button key={size} variant="secondary" size="small" onPress={() => setModal(size)}>
            {size}
          </Button>
        ))}
      </Row>
      <Row label="AlertDialog">
        <Button variant="danger" size="small" onPress={() => setAlert(true)}>
          删除对话
        </Button>
      </Row>
      <Row label="Sheet">
        {(['right', 'left', 'bottom', 'top'] as const).map((placement) => (
          <Button key={placement} variant="secondary" size="small" onPress={() => setSheet(placement)}>
            {placement}
          </Button>
        ))}
      </Row>

      <Modal.Backdrop isOpen={modal !== null} onOpenChange={(open) => !open && setModal(null)}>
        <Modal.Container size={modal ?? 'md'} placement="center">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Heading>重命名对话</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField aria-label="标题" defaultValue="英语学习入门指南">
                <Input />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                取消
              </Button>
              <Button slot="close">保存</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={alert} onOpenChange={setAlert}>
        <AlertDialog.Container>
          <AlertDialog.Dialog aria-describedby="pg-alert-body">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>删除这段对话？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body id="pg-alert-body">删除后可以在几秒内撤销。</AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary">
                取消
              </Button>
              <Button slot="close" variant="danger">
                删除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <Sheet isOpen={sheet !== null} placement={sheet ?? 'right'} onOpenChange={(open) => !open && setSheet(null)}>
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog aria-label="Sheet">
              <Sheet.Header>
                <Sheet.Heading>子 agent · 修好偶发失败的测试</Sheet.Heading>
              </Sheet.Header>
              <Sheet.Body className="text-body-regular text-text-secondary">
                从 {sheet} 滑入；底部抽屉可以拖动关闭。
              </Sheet.Body>
              <Sheet.Footer>
                <Button slot="close" variant="secondary">
                  关闭
                </Button>
              </Sheet.Footer>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    </Stage>
  )
}

function Notifications() {
  return (
    <div className="flex flex-col items-center gap-3">
      {(['neutral', 'information', 'success', 'error'] as const).map((status) => (
        <Notification
          key={status}
          status={status}
          title={status}
          description="会话「重构鉴权模块」想运行 cargo test --all"
          timestamp="刚刚"
          dismissible={status !== 'neutral'}
          closeLabel="忽略"
          actions={
            status === 'neutral'
              ? [
                  { label: '查看', onPress: noop, variant: 'secondary' },
                  { label: '允许', onPress: noop },
                ]
              : undefined
          }
        />
      ))}
    </div>
  )
}

function HotkeyProbe() {
  const [log, setLog] = useState<string[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [chosen, setChosen] = useState('（还没有选过）')

  const note = (what: string) => setLog((prev) => [what, ...prev].slice(0, 6))

  useHotkey(
    'mod+k',
    () => {
      note('mod+k')
      setPaletteOpen(true)
    },
    { ignoreInInput: false },
  )
  useHotkey('mod+shift+k', () => note('mod+shift+k'))
  useHotkey('escape', () => note('escape'))

  return (
    <div data-slot="hotkey-probe" className="space-y-3">
      <div data-slot="hotkey-probe-controls" className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onPress={() => setPaletteOpen(true)}>
          打开面板
        </Button>
        <Input
          type="text"
          aria-label="焦点测试用输入框"
          placeholder="在这里打字，再按 mod+k / mod+shift+k"
          className="min-w-64 flex-1"
        />
      </div>
      <p data-slot="hotkey-probe-expectation" className="text-caption-1-regular text-text-secondary">
        预期：<code data-slot="hotkey-probe-code">mod+k</code> 在输入框里也触发，
        <code data-slot="hotkey-probe-code">mod+shift+k</code> 不触发（
        <code data-slot="hotkey-probe-code">ignoreInInput</code> 默认开）， 且{' '}
        <code data-slot="hotkey-probe-code">mod+shift+k</code> 不会连带触发{' '}
        <code data-slot="hotkey-probe-code">mod+k</code>。
      </p>
      <div
        data-slot="hotkey-probe-log"
        className="rounded-lg border border-border-button-default bg-background-primary-default p-3 text-caption-1-regular"
      >
        <div data-slot="hotkey-probe-hits" className="text-text-secondary">
          最近命中：{log.length ? log.join(' · ') : '（无）'}
        </div>
        <div data-slot="hotkey-probe-chosen" className="mt-1">
          面板选中：{chosen}
        </div>
      </div>

      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        conversations={PALETTE_ROWS}
        projects={PALETTE_PROJECTS}
        onSelectConversation={(id) => setChosen(`会话 ${id}`)}
        onSelectProject={(id) => setChosen(`项目 ${id ?? '全部'}`)}
        onOpenSettingsTab={(tab) => setChosen(`设置 ${tab}`)}
        onCreate={() => setChosen('新建对话')}
      />
    </div>
  )
}

export default function Overlays() {
  return (
    <>
      <Section title="Dropdown / ContextMenu">
        <Menus />
      </Section>
      <Section title="Tooltip / Popover">
        <Hints />
      </Section>
      <Section title="Modal / AlertDialog / Sheet">
        <Dialogs />
      </Section>
      <Section title="Notification">
        <Notifications />
      </Section>
      <Section title="快捷键 / 命令面板">
        {/* Two things this is here to answer, neither of which a unit test
            can: whether the WebView hands us Ctrl+K at all (Edge binds it to
            the address bar, and WebView2 has been known to keep bindings the
            app never asked for), and whether the palette still opens while a
            text field has focus. Run this one under `pnpm tauri dev`, not in
            a browser — the browser is not the environment in question. */}
        <HotkeyProbe />
      </Section>
    </>
  )
}
