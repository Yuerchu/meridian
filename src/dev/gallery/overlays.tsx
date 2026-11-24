import './overlays.css'
import { DialogTrigger, Dialog as PopoverDialog, Button as PopoverButton } from 'react-aria-components'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { useState } from 'react'
import { Hammer, Pen, TriangleAlert } from '@keyline-icons/react/two-tone'

import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { AlertDialog, Dialog, DialogFooter, type DialogProps } from '@/components/yuerchu-ui/components/dialog/dialog'
import { CommandPalette } from '@/components/layout/command-palette'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import {
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  SubmenuTrigger,
} from '@/components/yuerchu-ui/components/menu/menu'
import {
  NotificationCard,
  NotificationStack,
} from '@/components/yuerchu-ui/components/notification-stack/notification-stack'
import { ToastRegion, toast } from '@/components/yuerchu-ui/components/toast/toast'
import { useHotkey } from '@/hooks/use-hotkey'
import { PALETTE_PROJECTS, PALETTE_ROWS } from './fixtures'
import { Row, Section, Stage } from './shell'
import { OverlayParts } from './parts'

function Menus() {
  return (
    <Stage>
      <Row label="Menu（库）">
        <MenuTrigger>
          <Button variant="secondary" size="sm">
            权限 · 手动
          </Button>
          <Menu aria-label="权限">
            <MenuSection header="权限">
              <MenuItem id="ask" icon={<Hammer />} description="每次修改前询问">
                手动
              </MenuItem>
              <MenuItem id="accept" icon={<Pen />}>
                接受编辑
              </MenuItem>
            </MenuSection>
            <MenuSection header="对话">
              <SubmenuTrigger>
                <MenuItem id="effort">思考强度</MenuItem>
                <Menu aria-label="思考强度">
                  <MenuItem id="low">低</MenuItem>
                  <MenuItem id="medium">中</MenuItem>
                  <MenuItem id="high">高</MenuItem>
                </Menu>
              </SubmenuTrigger>
              <MenuItem id="rename" shortcut="F2">
                重命名
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" tone="danger">
                删除
              </MenuItem>
              <MenuItem id="disabled" isDisabled description="正在运行">
                不可用
              </MenuItem>
            </MenuSection>
          </Menu>
        </MenuTrigger>
      </Row>
    </Stage>
  )
}

/** The library's own overlays: a drawer, a pending-notification stack, a toast. */
function LibraryOverlays() {
  const [drawer, setDrawer] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <Stage>
      <Row label="Drawer">
        <Button variant="secondary" onPress={() => setDrawer(true)}>
          打开抽屉
        </Button>
        <Drawer
          isOpen={drawer}
          onOpenChange={setDrawer}
          heading="后台命令输出"
          description="npm run dev"
          footer={
            <Button variant="secondary" onPress={() => setDrawer(false)}>
              关闭
            </Button>
          }
        >
          <p className="m-overlays__popover-body">编译完成，监听 5173 端口。</p>
        </Drawer>
      </Row>
      <Row label="NotificationStack / Toast">
        <Button variant="secondary" onPress={() => setPending((v) => !v)}>
          {pending ? '收起待处理' : '弹出待处理'}
        </Button>
        <Button variant="secondary" onPress={() => toast({ title: '已复制到剪贴板' })}>
          弹一条 Toast
        </Button>
        {pending && (
          <NotificationStack aria-label="待处理演示">
            <NotificationCard
              key="demo"
              heading="鉴权改走 middleware"
              description="run_command 想运行 cargo test --all"
              dismissLabel="忽略"
              onDismiss={() => setPending(false)}
              actions={
                <Button size="sm" variant="primary" onPress={() => setPending(false)}>
                  允许
                </Button>
              }
            />
          </NotificationStack>
        )}
        <ToastRegion />
      </Row>
    </Stage>
  )
}

function Hints() {
  return (
    <Stage>
      <Row label="Tooltip">
        {(['top', 'bottom', 'start', 'end'] as const).map((placement) => (
          <TooltipTrigger key={placement}>
            <Button variant="secondary" size="sm">
              {placement}
            </Button>
            <Tooltip placement={placement}>新对话</Tooltip>
          </TooltipTrigger>
        ))}
        <TooltipTrigger>
          <Button variant="secondary" size="sm">
            md · 无箭头
          </Button>
          <Tooltip>较长的说明会换行，宽度跟内容走，不超过它的上限。</Tooltip>
        </TooltipTrigger>
      </Row>
      <Row label="Popover">
        <DialogTrigger>
          <PopoverButton className="m-overlays__error-trigger" aria-label="上下文用量出错">
            <TriangleAlert className="m-overlays__error-icon" aria-hidden />
          </PopoverButton>
          <Popover offset={8} placement="top" className="m-overlays__popover">
            <PopoverDialog aria-label="上下文">
              <p className="m-overlays__popover-body">读取上下文用量失败：连接被拒绝。</p>
            </PopoverDialog>
          </Popover>
        </DialogTrigger>
      </Row>
    </Stage>
  )
}

function Dialogs() {
  const [modal, setModal] = useState<NonNullable<DialogProps['size']> | null>(null)
  const [alert, setAlert] = useState(false)
  return (
    <Stage>
      <Row label="Dialog">
        {(['sm', 'md', 'lg', 'xl', 'full'] as const).map((size) => (
          <Button key={size} variant="secondary" size="sm" onPress={() => setModal(size)}>
            {size}
          </Button>
        ))}
      </Row>
      <Row label="AlertDialog">
        <Button variant="destructive" size="sm" onPress={() => setAlert(true)}>
          删除对话
        </Button>
      </Row>

      <Dialog
        isOpen={modal !== null}
        onOpenChange={(open) => !open && setModal(null)}
        size={modal ?? 'md'}
        heading="重命名对话"
      >
        <TextField aria-label="标题" defaultValue="英语学习入门指南" />
        <DialogFooter>
          <Button slot="close" variant="secondary">
            取消
          </Button>
          <Button slot="close">保存</Button>
        </DialogFooter>
      </Dialog>

      <AlertDialog
        isOpen={alert}
        onOpenChange={setAlert}
        heading="删除这段对话？"
        description="删除后可以在几秒内撤销。"
        confirmLabel="删除"
        tone="danger"
      />
    </Stage>
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
    <div data-slot="hotkey-probe" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        data-slot="hotkey-probe-controls"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}
      >
        <Button variant="secondary" onPress={() => setPaletteOpen(true)}>
          打开面板
        </Button>
        <TextField aria-label="焦点测试用输入框" placeholder="在这里打字，再按 mod+k / mod+shift+k" />
      </div>
      <p data-slot="hotkey-probe-expectation" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
        预期：<code data-slot="hotkey-probe-code">mod+k</code> 在输入框里也触发，
        <code data-slot="hotkey-probe-code">mod+shift+k</code> 不触发（
        <code data-slot="hotkey-probe-code">ignoreInInput</code> 默认开）， 且{' '}
        <code data-slot="hotkey-probe-code">mod+shift+k</code> 不会连带触发{' '}
        <code data-slot="hotkey-probe-code">mod+k</code>。
      </p>
      <div
        data-slot="hotkey-probe-log"
        style={{
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
        }}
      >
        <div data-slot="hotkey-probe-hits" style={{ color: 'var(--fg-muted)' }}>
          最近命中：{log.length ? log.join(' · ') : '（无）'}
        </div>
        <div data-slot="hotkey-probe-chosen" style={{ marginTop: 'var(--space-1)' }}>
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
      <Section title="Menu（库）">
        <Menus />
      </Section>
      <Section title="Drawer / NotificationStack / Toast（库）">
        <LibraryOverlays />
      </Section>
      <Section title="Tooltip / Popover">
        <Hints />
      </Section>
      <Section title="Dialog / AlertDialog">
        <Dialogs />
      </Section>
      <Section title="快捷键 / 命令面板">
        <HotkeyProbe />
      </Section>
      <OverlayParts />
    </>
  )
}
