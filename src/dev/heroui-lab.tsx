// Dev-only probe for HeroUI under WebView2. Reachable at #playground/heroui.
//
// It was built to decide whether WebView2 renders HeroUI at all, because no
// amount of reading could settle it: this project had already had WebView2
// crash on `content-visibility` and misplace content under `contain`, both of
// which Chromium was perfectly happy with. The answer came back yes, and the
// migration went on to build on it — every wrapper component is HeroUI now.
//
// What it still earns its keep for is the next WebView2 update: HeroUI leans on
// `oklch`, `color-mix()`, `:has()`, `@property` and view transitions, and this
// is where a regression in any of them shows up as something other than a
// puzzling screenshot.
//
// Read it under `pnpm tauri dev`. A browser only reports on Chromium, which was
// never the doubtful side.
import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowDownToSquare, ArrowUp, Copy, Scissors, SquareDashedText } from '@gravity-ui/icons'

import {
  Button as HButton,
  Checkbox as HCheckbox,
  Disclosure as HDisclosure,
  Input as HInput,
  InputGroup as HInputGroup,
  Kbd as HKbd,
  Label as HLabel,
  ListBox as HListBox,
  Popover as HPopover,
  ProgressCircle as HProgressCircle,
  Select as HSelect,
  Slider as HSlider,
  Switch as HSwitch,
  TextArea as HTextArea,
  TextField as HTextField,
  Tooltip as HTooltip,
} from '@/components/base'

import { ContextMenu as ProContextMenu, Markdown as ProMarkdown, Sidebar as ProSidebar } from '@/components/base'

import { Composer } from '@/components/chat/composer'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { ShikiCode } from '@/components/chat/shiki-code'
import { languageIconUrl } from '@/lib/file-icon'

/** Feature detections, each phrased so `true` means "WebView2 will render it". */
const PROBES: Array<{ name: string; note?: string; test: () => boolean }> = [
  { name: 'oklch()', note: 'Meridian 自己的 token 已在用', test: () => CSS.supports('color', 'oklch(0.5 0.1 200)') },
  {
    name: 'color-mix()',
    note: 'HeroUI 5 个文件用到',
    test: () => CSS.supports('color', 'color-mix(in oklab, red, blue)'),
  },
  { name: ':has()', note: 'HeroUI 19 个文件用到', test: () => CSS.supports('selector(:has(*))') },
  {
    name: '@property',
    note: 'HeroUI 1 个文件用到',
    test: () => typeof CSS !== 'undefined' && 'registerProperty' in CSS,
  },
  { name: 'backdrop-filter', test: () => CSS.supports('backdrop-filter', 'blur(4px)') },
  { name: 'view transitions', note: 'HeroUI 3 个文件用到', test: () => 'startViewTransition' in document },
  {
    name: 'content-visibility',
    note: '⚠️ 本项目曾在此崩溃；HeroUI 自身不用',
    test: () => CSS.supports('content-visibility', 'auto'),
  },
  { name: 'contain', note: '⚠️ 本项目曾在此错位；HeroUI 自身不用', test: () => CSS.supports('contain', 'content') },
  // Pro 用到而 OSS 不用的几个。前两个决定 TextShimmer 能不能上：它的渐变宽度
  // 是 `calc(… * tan(角度))`，颜色是 `oklch(from currentColor …)`。任一不支持，
  // 整条 background 简写就解析失败，而 `-webkit-text-fill-color: transparent`
  // 是独立声明照样生效 —— 结果不是降级，是那段文字直接看不见。
  {
    name: 'oklch(from …) 相对颜色',
    note: 'Pro TextShimmer 用；不支持则文字消失',
    test: () => CSS.supports('color', 'oklch(from red l c h)'),
  },
  {
    name: 'tan() 三角函数',
    note: 'Pro TextShimmer 用；不支持则文字消失',
    test: () => CSS.supports('width', 'calc(1px * tan(15deg))'),
  },
  {
    name: 'display: contents',
    note: 'Pro PromptInput 的 compact/inline 布局',
    test: () => CSS.supports('display', 'contents'),
  },
  { name: 'overflow: clip', note: 'Pro Sidebar / ContextMenu.Menu', test: () => CSS.supports('overflow', 'clip') },
  { name: 'svh 单位', note: 'Pro Sidebar 的 min-height:100svh', test: () => CSS.supports('height', '100svh') },
  { name: 'inert 属性', note: 'Pro Sidebar.Page', test: () => 'inert' in HTMLElement.prototype },
]

/**
 * Every construct where the two renderers could disagree, in one string.
 *
 * The first block is the one that decides the migration: Pro hardcodes its
 * remark plugins to `[remarkGfm, remarkBreaks]` and exposes no way to change
 * them, so a single `\n` becomes a `<br>` there and collapses into one
 * paragraph here. Everything an assistant writes goes through this.
 */
const MARKDOWN_PROBE = `第一行，后面只有一个换行
第二行，紧跟上面
第三行

这里空了一行，是新段落。

- 列表项一
  这一行在列表项里换行
- 列表项二

1. 有序一
2. 有序二

行内 \`code\` 与**加粗**、*斜体*、[链接](https://example.com)。

\`\`\`ts
const answer = 42
console.log(answer)
\`\`\`

无语言围栏：

\`\`\`
plain fence
\`\`\`

| 列 | 值 |
| --- | --- |
| a | 1 |
| b | 2 |

> 引用里也来一段
> 第二行引用

### 三级标题

结尾段落。`

/** Tokens whose name exists on both sides, so whoever wins is worth knowing. */
const CONTESTED_TOKENS = [
  '--background',
  '--foreground',
  '--muted',
  '--accent',
  '--default',
  '--surface',
  '--overlay',
  '--danger',
  '--focus',
  '--radius',
  '--border',
]

interface Report {
  webview: string
  features: Array<{ name: string; supported: boolean; note?: string }>
  tokens: Array<{ name: string; value: string }>
  rendered: Array<{ name: string; prop: string; value: string }>
  hasPerf: string
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section data-slot="lab-section" className="space-y-2">
      <h2 data-slot="lab-section-title" className="text-sm font-semibold">
        {title}
        {hint && (
          <span data-slot="lab-section-hint" className="ml-2 font-normal text-muted">
            {hint}
          </span>
        )}
      </h2>
      {children}
    </section>
  )
}

/**
 * The two assumptions the sidebar rewrite rests on, made visible.
 *
 * `Sidebar.Menu` is a React Aria `Tree`, and a `TreeItem` passes only a fixed
 * set of props down to the DOM. The rewrite needs two things to survive that
 * filter: `onAction`, which is how a row is chosen now that no row is a button,
 * and `data-row-id`, which is how a right-click anywhere in the list is traced
 * back to the row it landed on. Neither is documented as passed through; both
 * read as working right up until they silently are not.
 */
function SidebarProbe() {
  const [acted, setActed] = useState<string | null>(null)
  const [attrs, setAttrs] = useState<string[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The same shape `app-sidebar` uses: the id is written to a ref during the
  // event so that `onOpenChange` — which runs before any state from the same
  // event is visible — can refuse a click that landed between rows.
  const hitRef = useRef<string | null>(null)
  const [hit, setHit] = useState<string | null>(null)

  const rows = ['alpha', 'beta', 'gamma']

  return (
    <div data-slot="sidebar-probe" className="space-y-2">
      <div
        data-slot="sidebar-probe-frame"
        ref={rootRef}
        className="h-64 overflow-hidden rounded-lg border [&_.sidebar]:h-full [&_.sidebar\_\_provider]:h-full"
      >
        <ProSidebar.Provider open collapsible="none" onOpenChange={() => {}}>
          <ProSidebar>
            <ProSidebar.Content>
              <ProSidebar.Group>
                <ProSidebar.GroupLabel>行</ProSidebar.GroupLabel>
                {/* Root 必须包住自己的 Trigger：Trigger 从 Root 的 context 里拿
                    handleOpen，而 context 的默认值是空函数——Root 挪到别处去，
                    菜单安静地永远打不开，tsc 和 build 都看不见。

                    命中行记在 onPointerDown / onContextMenuCapture 上，不能用
                    onContextMenu：Pro 的 Trigger 把传入的 props 铺在自己的处理器
                    *之后*，同名的冒泡处理器会把开菜单的那个整个顶掉。 */}
                <ProContextMenu open={hit !== null} onOpenChange={(open) => setHit(open ? hitRef.current : null)}>
                  <ProContextMenu.Trigger
                    className="block"
                    data-slot="probe-trigger"
                    onPointerDown={(e: React.PointerEvent) => {
                      hitRef.current =
                        (e.target as HTMLElement).closest('[data-row-id]')?.getAttribute('data-row-id') ?? null
                    }}
                    onContextMenuCapture={(e: React.MouseEvent) => {
                      hitRef.current =
                        (e.target as HTMLElement).closest('[data-row-id]')?.getAttribute('data-row-id') ?? null
                    }}
                  >
                    <ProSidebar.Menu aria-label="行">
                      {rows.map((id) => (
                        <ProSidebar.MenuItem
                          key={id}
                          id={id}
                          data-row-id={id}
                          textValue={id}
                          onAction={() => setActed(id)}
                        >
                          <ProSidebar.MenuLabel>{id}</ProSidebar.MenuLabel>
                        </ProSidebar.MenuItem>
                      ))}
                    </ProSidebar.Menu>
                  </ProContextMenu.Trigger>
                  <ProContextMenu.Popover>
                    <ProContextMenu.Menu aria-label="行操作">
                      <ProContextMenu.Item id="act" textValue={`对 ${hit} 做点什么`} onAction={() => {}}>
                        <HLabel>对 {hit} 做点什么</HLabel>
                      </ProContextMenu.Item>
                    </ProContextMenu.Menu>
                  </ProContextMenu.Popover>
                </ProContextMenu>
              </ProSidebar.Group>
            </ProSidebar.Content>
          </ProSidebar>
          <ProSidebar.Main>
            <span data-slot="sidebar-probe-main" />
          </ProSidebar.Main>
        </ProSidebar.Provider>
      </div>
      <div data-slot="sidebar-probe-actions" className="flex flex-wrap gap-2">
        <HButton
          size="sm"
          variant="secondary"
          onPress={() =>
            setAttrs(
              Array.from(rootRef.current?.querySelectorAll('[data-row-id]') ?? []).map(
                (el) => el.getAttribute('data-row-id') ?? '?',
              ),
            )
          }
        >
          读 data-row-id
        </HButton>
      </div>
      <p className="font-mono text-xs" data-slot="probe-readout">
        onAction: {acted ?? '(未点)'} ／ 菜单开在: {hit ?? '(关着)'} ／ DOM 上的 row id:{' '}
        {attrs ? (attrs.length ? attrs.join(',') : '一个都没有') : '(未读)'}
      </p>
    </div>
  )
}

function PromptInputProbe() {
  const [value, setValue] = useState('')
  const [submits, setSubmits] = useState(0)
  const [stops, setStops] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [steerable, setSteerable] = useState(false)

  return (
    <div data-slot="prompt-input-probe" className="space-y-2">
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => {
          setSubmits((n) => n + 1)
          setValue('')
        }}
        onStop={() => {
          setStops((n) => n + 1)
          setStreaming(false)
        }}
        streaming={streaming}
        steerable={steerable}
        ariaLabel="探测输入框"
        placeholder="打几个字，试 Enter / Shift+Enter / 组词中的 Enter"
        toolbarStart={
          <span data-slot="prompt-input-probe-slot-start" data-testid="slot-start" className="text-xs text-muted">
            工具槽
          </span>
        }
        toolbarEnd={
          <>
            <span data-slot="prompt-input-probe-slot-end" data-testid="slot-end" className="text-xs text-muted">
              右槽
            </span>
            {/* Same shape as the composer's context gauge, which went missing
                after the move. */}
            <HPopover>
              <HTooltip delay={0}>
                <HPopover.Trigger
                  aria-label="上下文用量"
                  className="inline-flex items-center rounded-full outline-none"
                >
                  <HProgressCircle
                    aria-hidden
                    value={40}
                    maxValue={100}
                    className="[--progress-circle-stroke:var(--muted)]"
                  >
                    <HProgressCircle.Track className="size-4.5">
                      <HProgressCircle.TrackCircle />
                      <HProgressCircle.FillCircle />
                    </HProgressCircle.Track>
                  </HProgressCircle>
                </HPopover.Trigger>
                <HTooltip.Content>上下文用量</HTooltip.Content>
              </HTooltip>
              <HPopover.Content placement="top" className="p-3 text-xs">
                用量面板
              </HPopover.Content>
            </HPopover>
          </>
        }
      />
      <p data-slot="prompt-input-probe-counts" className="text-xs text-muted">
        提交{' '}
        <span data-slot="prompt-input-probe-submit-count" data-testid="submit-count">
          {submits}
        </span>{' '}
        · 停止{' '}
        <span data-slot="prompt-input-probe-stop-count" data-testid="stop-count">
          {stops}
        </span>
        {' · '}
        <HButton size="sm" variant="ghost" onPress={() => setStreaming((s) => !s)}>
          {streaming ? '结束流式' : '模拟流式'}
        </HButton>
        {' · '}
        <HButton size="sm" variant="ghost" onPress={() => setSteerable((s) => !s)}>
          {steerable ? '关掉可插话' : '开可插话'}
        </HButton>
      </p>
      <p data-slot="prompt-input-probe-note" className="text-xs text-muted">
        「可插话」是子 agent 的模式：流式中 Enter 仍然提交，Send 保持 Send，Stop 单独出现在它左边——
        但只在框里有字的时候，框空了 Pro 会把 Stop 的行为还给 Send。
      </p>
    </div>
  )
}

export default function HeroUiLab() {
  const [report, setReport] = useState<Report | null>(null)
  const [copied, setCopied] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const perfRef = useRef<HTMLDivElement>(null)
  const proRef = useRef<HTMLDivElement>(null)

  const collect = useCallback((): Report => {
    const root = getComputedStyle(document.documentElement)

    // Whether a component's own styling actually resolved, as opposed to
    // falling back to something transparent because a colour function failed.
    const rendered: Report['rendered'] = []
    const probeEl = (
      selector: string,
      prop: string,
      label: string,
      root: React.RefObject<HTMLDivElement | null> = buttonRef,
    ) => {
      const el = root.current?.querySelector(selector)
      if (!el) {
        rendered.push({ name: label, prop, value: '<not found>' })
        return
      }
      rendered.push({ name: label, prop, value: getComputedStyle(el).getPropertyValue(prop).trim() })
    }
    probeEl('[data-slot="button"]', 'background-color', 'HeroUI Button')
    probeEl('[data-slot="button"]', 'border-radius', 'HeroUI Button')
    probeEl('[data-slot="switch-control"]', 'background-color', 'HeroUI Switch 轨道')
    probeEl('[data-slot="progress-circle"]', 'color', 'HeroUI ProgressCircle')
    // The one measurement that says whether `@import … layer(components)` in
    // index.css took. Pro ships its per-component CSS unlayered, and an
    // unlayered rule outranks every layered one — so `.context-menu__trigger`'s
    // own `display: inline-block` would beat the `block w-full` below and
    // collapse the composer to its content width. `block` here means the layer
    // assignment is holding; `inline-block` means it is not.
    probeEl('.context-menu__trigger', 'display', 'Pro ContextMenu.Trigger（应为 block）', proRef)

    // `:has()` is the one HeroUI uses heavily enough for selector matching cost
    // to be worth measuring rather than assumed.
    let hasPerf = 'n/a'
    const perfHost = perfRef.current
    if (perfHost) {
      const start = performance.now()
      perfHost.classList.toggle('probe-flip')
      void perfHost.offsetHeight
      perfHost.classList.toggle('probe-flip')
      void perfHost.offsetHeight
      hasPerf = `${(performance.now() - start).toFixed(1)}ms / 200 节点两次强制重排`
    }

    return {
      webview: navigator.userAgent,
      features: PROBES.map((p) => ({ name: p.name, supported: p.test(), note: p.note })),
      tokens: CONTESTED_TOKENS.map((name) => ({ name, value: root.getPropertyValue(name).trim() || '<未定义>' })),
      rendered,
      hasPerf,
    }
  }, [])

  useEffect(() => {
    // One frame in, so HeroUI's stylesheet has been applied before anything is
    // measured.
    const frame = requestAnimationFrame(() => setReport(collect()))
    return () => cancelAnimationFrame(frame)
  }, [collect])

  const asText = report
    ? [
        `WebView: ${report.webview}`,
        '',
        '## CSS 特性',
        ...report.features.map((f) => `${f.supported ? 'OK  ' : 'FAIL'} ${f.name}${f.note ? `  (${f.note})` : ''}`),
        '',
        '## Token 实际生效值（谁赢了）',
        ...report.tokens.map((t) => `${t.name} = ${t.value}`),
        '',
        '## 组件计算样式（<not found> 或空值 = 没渲染出来）',
        ...report.rendered.map((r) => `${r.name} ${r.prop} = ${r.value}`),
        '',
        `## :has() 开销  ${report.hasPerf}`,
      ].join('\n')
    : '采集中…'

  return (
    <div data-slot="heroui-lab" className="h-full overflow-y-auto bg-background text-foreground">
      <div data-slot="heroui-lab-body" className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <header data-slot="heroui-lab-header" className="space-y-1">
          <h1 data-slot="heroui-lab-title" className="text-lg font-semibold">
            HeroUI v3 在 WebView2 的落地探测
          </h1>
          <p data-slot="heroui-lab-intro" className="text-xs text-muted">
            必须在 <code data-slot="heroui-lab-intro-code">pnpm tauri dev</code>{' '}
            的窗口里看。浏览器里跑出来的结果不作数。
          </p>
        </header>

        <Section title="探测结果" hint="复制这段发回给我">
          <div data-slot="heroui-lab-report-actions" className="flex gap-2">
            <HButton
              size="sm"
              onPress={() => {
                setReport(collect())
                navigator.clipboard?.writeText(asText).then(
                  () => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  },
                  () => {
                    /* 剪贴板不可用时下面的文本可以手选 */
                  },
                )
              }}
            >
              {copied ? '已复制' : '重新采集并复制'}
            </HButton>
          </div>
          <pre
            data-slot="heroui-lab-report"
            className="max-h-96 overflow-auto rounded-lg border bg-default/30 p-3 font-mono text-xs whitespace-pre-wrap select-all"
          >
            {asText}
          </pre>
        </Section>

        <Section title="HeroUI 组件实拍" hint="看有没有错位、缺色、缺边框">
          <div data-slot="heroui-lab-components" ref={buttonRef} className="space-y-4 rounded-lg border p-4">
            <div data-slot="heroui-lab-buttons" className="flex flex-wrap items-center gap-3">
              <HButton>Primary</HButton>
              <HButton variant="secondary">Secondary</HButton>
              <HButton variant="ghost">Ghost</HButton>
              <HButton isDisabled>Disabled</HButton>
              <HProgressCircle isIndeterminate aria-label="加载中" />
            </div>

            {/* Control 嵌在 Content 里面，不是它的兄弟：Content 是那个可点击的
                <label>，Control 挪到外面就再也点不动了 */}
            <div data-slot="heroui-lab-toggles" className="flex flex-wrap items-center gap-6">
              <HSwitch defaultSelected>
                <HSwitch.Content>
                  <HSwitch.Control>
                    <HSwitch.Thumb />
                  </HSwitch.Control>
                  开关
                </HSwitch.Content>
              </HSwitch>
              <HCheckbox defaultSelected>
                <HCheckbox.Content>
                  <HCheckbox.Control>
                    <HCheckbox.Indicator />
                  </HCheckbox.Control>
                  复选
                </HCheckbox.Content>
              </HCheckbox>
            </div>

            <div data-slot="heroui-lab-inputs" className="max-w-sm space-y-2">
              <HInput fullWidth placeholder="Input：单行输入" />
              <HTextArea fullWidth placeholder="TextArea：多行输入" rows={2} />
            </div>

            {/* HeroUI declares `.button`'s height as a plain rule, not inside a
                utility layer — so a Tailwind size class on the same element may
                or may not outrank it. Everything the composer builds on top of
                Button sizes itself this way. */}
            <div
              data-slot="heroui-lab-size-probe"
              data-probe="size-override"
              className="flex flex-wrap items-center gap-3"
            >
              <HButton className="h-6 px-1.5">h-6</HButton>
              <HButton className="size-6 p-0">size-6</HButton>
              {/* eslint-disable-next-line no-restricted-syntax -- probe: measures whether utilities beat .button */}
              <HButton className="h-auto p-1">h-auto p-1</HButton>
              {/* eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- probe: measures whether utilities beat .button */}
              <HButton isIconOnly className="size-8">
                size-8
              </HButton>
            </div>

            <HSlider defaultValue={40} className="max-w-xs" aria-label="滑块">
              <HSlider.Track>
                <HSlider.Fill />
                <HSlider.Thumb />
              </HSlider.Track>
            </HSlider>

            <div data-slot="heroui-lab-overlays" className="flex flex-wrap items-center gap-3">
              <HTooltip delay={0}>
                <HButton variant="secondary">悬停看 Tooltip</HButton>
                <HTooltip.Content>浮层定位对不对</HTooltip.Content>
              </HTooltip>

              <HPopover>
                <HPopover.Trigger>
                  <HButton variant="secondary">点开 Popover</HButton>
                </HPopover.Trigger>
                <HPopover.Content className="p-3 text-sm">这里应该有边框和阴影</HPopover.Content>
              </HPopover>

              {/* Trigger 得自己放 Value 和 Indicator，否则是个空框；集合项必须带
                  id（不是 key/value），非纯文本内容还要补 textValue */}
              <HSelect defaultValue="opus" aria-label="模型" className="w-44">
                <HSelect.Trigger>
                  <HSelect.Value />
                  <HSelect.Indicator />
                </HSelect.Trigger>
                <HSelect.Popover>
                  <HListBox>
                    <HListBox.Item id="opus" textValue="Opus">
                      Opus
                      <HListBox.ItemIndicator />
                    </HListBox.Item>
                    <HListBox.Item id="sonnet" textValue="Sonnet">
                      Sonnet
                      <HListBox.ItemIndicator />
                    </HListBox.Item>
                    <HListBox.Item id="haiku" textValue="Haiku">
                      Haiku
                      <HListBox.ItemIndicator />
                    </HListBox.Item>
                  </HListBox>
                </HSelect.Popover>
              </HSelect>
            </div>

            {/* 与聊天里的折叠卡片同类，foxlinepro_dash 在这上面踩过虚拟滚动的坑 */}
            <HDisclosure>
              <HDisclosure.Heading>
                {/* flex 是必须自己加的：HeroUI 把 .disclosure__trigger 定成
                    inline-block，却给 indicator 用了 ms-auto / shrink-0 这些只在
                    flex 容器里成立的类，再叠上 Tailwind preflight 的
                    `svg { display: block }`，箭头就掉到标题下一行去了 */}
                <HDisclosure.Trigger className="flex w-full items-center gap-2">
                  展开看折叠动画
                  <HDisclosure.Indicator />
                </HDisclosure.Trigger>
              </HDisclosure.Heading>
              <HDisclosure.Content>
                <HDisclosure.Body className="text-sm text-muted">
                  展开时高度过渡是否平滑，有没有闪烁或跳动。
                </HDisclosure.Body>
              </HDisclosure.Content>
            </HDisclosure>
          </div>
        </Section>

        {/* Whether Pro's PromptInput can be given an IME guard at all.

            Its TextArea submits from a built-in `onKeyDown` that fires *before*
            any handler passed in — by then it has already called
            `preventDefault` and `onSubmit`. So the guard has to run in the
            capture phase and stop the event there, which only works if React
            treats a capture-phase `stopPropagation` as ending the dispatch for
            the same element's bubble handler too. That is the assumption this
            probe exists to check; if it does not hold, a Chinese candidate
            string would submit itself halfway through being typed.

            Counter goes up only when a submit actually happened. */}
        <Section title="PromptInput 的输入法守卫" hint="Enter 该发送；组词中的 Enter 不该发送">
          <PromptInputProbe />
        </Section>

        {/* Pro's CodeBlock ships a header slot but no language label of its own —
            the docs just put a `<span>` in it. Since the icon pack is already
            here for the file tree, the label can carry the language's file icon
            instead of spelling out "TYPESCRIPT". `languageIconUrl` maps a fence
            label onto the file it would live in. */}
        <Section title="CodeBlock + 语言图标" hint="每种语言的图标都要认得出来，认不出的回落成通用文件图标">
          <div data-slot="heroui-lab-code-blocks" className="space-y-3">
            {[
              { lang: 'typescript', code: 'const answer: number = 42\nconsole.log(answer)' },
              { lang: 'python', code: 'def greet(name: str) -> str:\n    return f"Hello, {name}"' },
              { lang: 'rust', code: 'fn main() {\n    println!("hi");\n}' },
              { lang: 'bash', code: 'pnpm tauri dev --port 5173' },
              { lang: 'json', code: '{ "ok": true, "count": 2 }' },
              { lang: 'dockerfile', code: 'FROM node:20\nWORKDIR /app' },
              { lang: 'plaintext', code: '没有语言标记的围栏' },
            ].map(({ lang, code }) => {
              const icon = languageIconUrl(lang)
              return (
                <div data-slot="heroui-lab-code-block" key={lang} className="code-block rounded-xl">
                  <div data-slot="heroui-lab-code-block-header" className="code-block__header">
                    {icon && (
                      <img data-slot="heroui-lab-code-block-icon" src={icon} alt="" aria-hidden className="size-4" />
                    )}
                    <span data-slot="heroui-lab-code-block-lang" className="text-xs text-muted">
                      {lang}
                    </span>
                  </div>
                  <ShikiCode code={code} language={lang} />
                </div>
              )
            })}
          </div>
        </Section>

        {/* The gate for the whole Markdown migration. Pro's renderer is worth
            having — it memoises per block, so a streaming token stops re-parsing
            the entire answer — but it fixes its remark plugins at
            `[remarkGfm, remarkBreaks]` with no prop to change them. `remark-breaks`
            turns a lone `\n` into a `<br>`, which is a real rendering change for
            every answer ever written. Both renderers get the same string; read
            the first three lines of each. */}
        <Section title="Markdown 两边对照" hint="重点看开头三行：右边会不会断成三行">
          <div data-slot="heroui-lab-markdown-compare" className="grid grid-cols-2 gap-4">
            <div data-slot="heroui-lab-markdown-ours" className="min-w-0 space-y-2">
              <h3 data-slot="heroui-lab-markdown-heading" className="text-xs font-medium text-muted">
                现在（react-markdown + remark-gfm）
              </h3>
              <div data-slot="heroui-lab-markdown-frame" className="rounded-lg border p-3">
                <MarkdownContent content={MARKDOWN_PROBE} />
              </div>
            </div>
            <div data-slot="heroui-lab-markdown-pro" className="min-w-0 space-y-2">
              <h3 data-slot="heroui-lab-markdown-heading" className="text-xs font-medium text-muted">
                Pro（+ remark-breaks，改不掉）
              </h3>
              <div data-slot="heroui-lab-markdown-frame" className="rounded-lg border p-3">
                <ProMarkdown>{MARKDOWN_PROBE}</ProMarkdown>
              </div>
            </div>
          </div>
        </Section>

        {/* Same tree as the real composer — `chat/input-bar.tsx` — minus everything
            that needs Tauri: same wrappers, same `TextField > InputGroup` with the
            column layout. Reproduced here because the chat screen cannot run in a
            browser at all (every IPC call throws), and without it the only way to
            check a composer change was to ask someone to right-click in a dev
            window and describe what happened.

            It is also the minimal reproduction for two things Pro's ContextMenu
            does that the app lives with, both measured here:

            1. Any scroll closes it. Pro listens for `scroll` on `window` in the
               capture phase and closes unless the scrolled element is inside the
               popover. Scrolling an unrelated container 120px kills the menu.
               Not interceptable from outside: scroll does not bubble, and a
               capture listener on window is the first to see it. Accepted,
               because the only thing that scrolls under an open menu without a
               hand on it is the transcript following a stream — and a reader
               who has scrolled up to an older message is `idle`, where nothing
               moves. What it costs is a right-click on the sidebar while a
               stream is being followed, which reopens with a second click.
            2. First open measures the panel before the portal has laid it out,
               so `max-height` comes back 36px for a 173px menu in a 300px-tall
               window, and it pins itself below the cursor instead of flipping.
               Any later reposition re-solves correctly (`placement: top`, full
               height) — so this one a resize event could paper over.

            Keep this around: it is what says whether either has changed
            upstream. */}
        <Section title="Sidebar 的 Tree 能不能带私货" hint="点一行、右键一行，再按「读 data-row-id」">
          <SidebarProbe />
          <p data-slot="heroui-lab-sidebar-note" className="text-xs text-muted">
            三个读数都要有值。任何一个空，侧栏的选中或右键菜单就是坏的——而坏法是安静的，不报错也不掉类型。
          </p>
        </Section>

        <Section title="Composer 同构复现" hint="右键输入框；滚动一下看菜单是否消失">
          <div data-slot="heroui-lab-composer" ref={proRef} className="rounded-lg border">
            <div data-slot="heroui-lab-composer-padding" className="px-4 pb-4 pt-2">
              <div data-slot="heroui-lab-composer-width" className="mx-auto max-w-2xl">
                <ProContextMenu>
                  {/* `block w-full` 不是装饰：Pro 给 .context-menu__trigger 定的是
                      inline-block，包住撑满宽度的输入框时会把它塌成内容宽。这两个
                      类能不能压过它，取决于 index.css 里的 layer() 写没写对——上面
                      报告里那条 display 读数测的就是这件事。 */}
                  <ProContextMenu.Trigger className="block w-full">
                    <HTextField fullWidth aria-label="发送消息">
                      <HInputGroup fullWidth className="flex flex-col gap-2 rounded-2xl py-2">
                        <div data-slot="heroui-lab-composer-textarea" className="relative w-full">
                          <HInputGroup.TextArea
                            rows={1}
                            placeholder="发送消息…"
                            className="min-h-6 max-h-[200px] w-full flex-none resize-none px-3.5 py-0"
                          />
                        </div>
                        <HInputGroup.Suffix className="w-full items-center gap-1 border-0 px-3 py-0">
                          <HTooltip delay={0}>
                            <HButton isIconOnly size="sm" variant="ghost" aria-label="加号" className="rounded-lg">
                              +
                            </HButton>
                            <HTooltip.Content>加号</HTooltip.Content>
                          </HTooltip>
                          <span data-slot="heroui-lab-composer-spacer" className="flex-1" />
                          <HTooltip delay={0}>
                            <HButton isIconOnly size="sm" aria-label="发送" className="rounded-full">
                              <ArrowUp />
                            </HButton>
                            <HTooltip.Content>发送</HTooltip.Content>
                          </HTooltip>
                        </HInputGroup.Suffix>
                      </HInputGroup>
                    </HTextField>
                  </ProContextMenu.Trigger>
                  <ProContextMenu.Popover>
                    <ProContextMenu.Menu aria-label="发送消息">
                      <ProContextMenu.Item id="cut" textValue="剪切">
                        <Scissors className="size-4 text-muted" />
                        <HLabel>剪切</HLabel>
                        <HKbd className="ms-auto" slot="keyboard" variant="light">
                          <HKbd.Content>Ctrl+X</HKbd.Content>
                        </HKbd>
                      </ProContextMenu.Item>
                      <ProContextMenu.Item id="copy" textValue="复制">
                        <Copy className="size-4 text-muted" />
                        <HLabel>复制</HLabel>
                        <HKbd className="ms-auto" slot="keyboard" variant="light">
                          <HKbd.Content>Ctrl+C</HKbd.Content>
                        </HKbd>
                      </ProContextMenu.Item>
                      <ProContextMenu.Item id="paste" textValue="粘贴">
                        <ArrowDownToSquare className="size-4 text-muted" />
                        <HLabel>粘贴</HLabel>
                        <HKbd className="ms-auto" slot="keyboard" variant="light">
                          <HKbd.Content>Ctrl+V</HKbd.Content>
                        </HKbd>
                      </ProContextMenu.Item>
                      <ProContextMenu.Separator />
                      <ProContextMenu.Item id="select-all" textValue="全选">
                        <SquareDashedText className="size-4 text-muted" />
                        <HLabel>全选</HLabel>
                        <HKbd className="ms-auto" slot="keyboard" variant="light">
                          <HKbd.Content>Ctrl+A</HKbd.Content>
                        </HKbd>
                      </ProContextMenu.Item>
                    </ProContextMenu.Menu>
                  </ProContextMenu.Popover>
                </ProContextMenu>
              </div>
            </div>
          </div>
          <p data-slot="heroui-lab-composer-note" className="text-xs text-muted">
            输入框必须满宽。把窗口拉矮再在靠底部处右键，看菜单是翻到上方去，还是原地压扁出滚动条。
          </p>
        </Section>

        {/* 这里原本是「现有组件对照」：一排 Meridian 的 Button 挨着上面 HeroUI 的
            Button，用来看 HeroUI 的样式表有没有污染我们的包装。包装已经全部删掉，
            两边的 Button 是同一个组件，那个对照也就照不出任何东西了。留下的是
            HeroUI 不提供、因而仍由本项目自己拼的组合件——只有它们还会自己读
            token，也只有它们能显示出主题层被抢的后果。 */}
        <Section title="本项目自有组合件" hint="仍自己读 token 的那部分">
          <div data-slot="heroui-lab-composites" className="space-y-3 rounded-lg border p-4">
            <Bubble>
              <BubbleContent>气泡的圆角、底色、内边距应当和迁移前一致。</BubbleContent>
            </Bubble>
            <p data-slot="heroui-lab-composites-note" className="text-xs text-muted">
              这行是 text-muted，应当是灰的；如果变成正文色，说明 --muted 被抢了。
            </p>
          </div>
        </Section>

        <Section title=":has() 压测" hint="200 个节点，看上面的耗时读数">
          <div data-slot="heroui-lab-perf" ref={perfRef} className="max-h-32 overflow-auto rounded-lg border p-2">
            <style data-slot="heroui-lab-perf-style">{`
              .probe-host:has(.probe-item:hover) .probe-item { opacity: 0.9; }
              .probe-host.probe-flip .probe-item:has(+ .probe-item) { outline: 1px solid transparent; }
            `}</style>
            <div data-slot="heroui-lab-perf-host" className="probe-host flex flex-wrap gap-1">
              {Array.from({ length: 200 }, (_, i) => (
                <span
                  key={i}
                  data-slot="heroui-lab-perf-item"
                  className="probe-item rounded-md bg-default px-1 text-xs"
                >
                  {i}
                </span>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
