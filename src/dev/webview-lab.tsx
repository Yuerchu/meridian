// Dev-only probe of WebView2's CSS support for the boardui + React Aria base
// layer. Reachable at #playground/webview.
//
// It was built to decide whether WebView2 renders the base layer at all,
// because no amount of reading could settle it: this project had already had
// WebView2 crash on `content-visibility` and misplace content under
// `contain`, both of which Chromium was perfectly happy with. The answer came
// back yes, and the migration went on to build on it.
//
// What it still earns its keep for is the next WebView2 update: the base
// layer leans on `oklch`, `color-mix()`, `:has()`, `@property` and view
// transitions, and this is where a regression in any of them shows
// up as something other than a puzzling screenshot.
//
// Read it under `pnpm tauri dev`. A browser only reports on Chromium, which was
// never the doubtful side.
import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowInDownDashedPanel, ArrowUp, Copy, CursorText, Plus, Scissors } from '@keyline-icons/react/two-tone'

import {
  Button,
  Checkbox,
  ContextMenu,
  Disclosure,
  Input,
  InputGroup,
  Kbd,
  Label,
  Markdown,
  Popover,
  ProgressCircle,
  Select,
  SelectItem,
  Sidebar,
  Slider,
  Switch,
  TextArea,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'

import { Composer } from '@/components/chat/composer'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { FilePreviewContext, type FilePreviewContextValue } from '@/components/chat/file-preview-context'
import { ShikiCode } from '@/components/chat/shiki-code'
import { languageIconUrl } from '@/lib/file-icon'

/** Feature detections, each phrased so `true` means "WebView2 will render it". */
const PROBES: Array<{ name: string; note?: string; test: () => boolean }> = [
  { name: 'oklch()', note: 'Meridian 自己的 token 已在用', test: () => CSS.supports('color', 'oklch(0.5 0.1 200)') },
  {
    name: 'color-mix()',
    note: '基础组件与全局样式用到',
    test: () => CSS.supports('color', 'color-mix(in oklab, red, blue)'),
  },
  { name: ':has()', note: '本项目多处用到', test: () => CSS.supports('selector(:has(*))') },
  {
    name: '@property',
    note: '本项目用到',
    test: () => typeof CSS !== 'undefined' && 'registerProperty' in CSS,
  },
  { name: 'backdrop-filter', test: () => CSS.supports('backdrop-filter', 'blur(4px)') },
  { name: 'view transitions', note: '本项目用到', test: () => 'startViewTransition' in document },
  {
    name: 'content-visibility',
    note: '⚠️ 本项目曾在此崩溃',
    test: () => CSS.supports('content-visibility', 'auto'),
  },
  { name: 'contain', note: '⚠️ 本项目曾在此错位', test: () => CSS.supports('contain', 'content') },
  {
    name: 'display: contents',
    note: 'Sidebar.Mobile / HoverCard 用',
    test: () => CSS.supports('display', 'contents'),
  },
  { name: 'overflow: clip', test: () => CSS.supports('overflow', 'clip') },
  { name: 'svh 单位', note: 'app-shell 外框的 h-svh', test: () => CSS.supports('height', '100svh') },
  { name: 'inert 属性', note: 'App Shell 用（chat 常驻但 inert）', test: () => 'inert' in HTMLElement.prototype },
]

/**
 * Every construct where the two renderers could disagree, in one string.
 *
 * The first block is the one worth reading closely: `MarkdownContent` runs its
 * own `[remarkGfm, remarkBreaks]` pipeline, so a single `\n` becomes a `<br>`
 * there, while the base layer's `Markdown` is just a styled wrapper with no
 * parser of its own and shows the raw string. Everything an assistant writes
 * goes through the former.
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

/**
 * File references inside running prose, the way an assistant writes them: an
 * inline-code candidate, an explicit link and a bare path, each mid-sentence
 * so the line box around it can be measured against its neighbours.
 */
const FILE_REFERENCE_PROBE = `先读 \`AGENTS.md\` 再改代码，这一行和上下两行的行高应当一样。
显式链接 [app-shell.tsx](src/components/layout/app-shell.tsx:379) 也在段落中间。
裸路径 src/components/base/resizable.tsx 同样如此，最后一行没有引用。`

/** Every probe answers "exists" so candidates turn into links; opening does nothing. */
const PROBE_FILE_PREVIEW: FilePreviewContextValue = {
  openPreview: () => undefined,
  probeReference: () => Promise.resolve(true),
}

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
      <h2 data-slot="lab-section-title" className="text-body-semibold">
        {title}
        {hint && (
          <span data-slot="lab-section-hint" className="ml-2 text-body-regular text-text-secondary">
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
        <Sidebar.Provider open collapsible="none" onOpenChange={() => {}}>
          <Sidebar>
            <Sidebar.Content>
              <Sidebar.Group>
                <Sidebar.GroupLabel>行</Sidebar.GroupLabel>
                {/* Root 必须包住自己的 Trigger：Trigger 从 Root 的 context 里拿
                    handleOpen，而 context 的默认值是空函数——Root 挪到别处去，
                    菜单安静地永远打不开，tsc 和 build 都看不见。

                    命中行记在 onPointerDown / onContextMenuCapture 上，而不是
                    等 onOpenChange 里再读 state：同一个事件里状态还没更新，
                    等着读只会拿到上一次的值。 */}
                <ContextMenu open={hit !== null} onOpenChange={(open) => setHit(open ? hitRef.current : null)}>
                  <ContextMenu.Trigger
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
                    <Sidebar.Menu aria-label="行">
                      {rows.map((id) => (
                        <Sidebar.MenuItem
                          key={id}
                          id={id}
                          data-row-id={id}
                          textValue={id}
                          onAction={() => setActed(id)}
                        >
                          <Sidebar.MenuLabel>{id}</Sidebar.MenuLabel>
                        </Sidebar.MenuItem>
                      ))}
                    </Sidebar.Menu>
                  </ContextMenu.Trigger>
                  <ContextMenu.Popover>
                    <ContextMenu.Menu aria-label="行操作">
                      <ContextMenu.Item id="act" textValue={`对 ${hit} 做点什么`} onAction={() => {}}>
                        <Label>对 {hit} 做点什么</Label>
                      </ContextMenu.Item>
                    </ContextMenu.Menu>
                  </ContextMenu.Popover>
                </ContextMenu>
              </Sidebar.Group>
            </Sidebar.Content>
          </Sidebar>
          <Sidebar.Main>
            <span data-slot="sidebar-probe-main" />
          </Sidebar.Main>
        </Sidebar.Provider>
      </div>
      <div data-slot="sidebar-probe-actions" className="flex flex-wrap gap-2">
        <Button
          size="small"
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
        </Button>
      </div>
      <p className="font-mono text-caption-1-regular" data-slot="probe-readout">
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
          <span
            data-slot="prompt-input-probe-slot-start"
            data-testid="slot-start"
            className="text-caption-1-regular text-text-secondary"
          >
            工具槽
          </span>
        }
        toolbarEnd={
          <>
            <span
              data-slot="prompt-input-probe-slot-end"
              data-testid="slot-end"
              className="text-caption-1-regular text-text-secondary"
            >
              右槽
            </span>
            {/* Same shape as the composer's context gauge, which went missing
                after the move. */}
            <Popover>
              <TooltipTrigger delay={0}>
                <Popover.Trigger aria-label="上下文用量" className="inline-flex items-center rounded-full outline-none">
                  <ProgressCircle
                    aria-hidden
                    value={40}
                    maxValue={100}
                    className="[--progress-circle-stroke:var(--color-text-secondary)]"
                  >
                    <ProgressCircle.Track className="size-4.5">
                      <ProgressCircle.TrackCircle />
                      <ProgressCircle.FillCircle />
                    </ProgressCircle.Track>
                  </ProgressCircle>
                </Popover.Trigger>
                <Tooltip>上下文用量</Tooltip>
              </TooltipTrigger>
              <Popover.Content placement="top" className="p-3 text-caption-1-regular">
                用量面板
              </Popover.Content>
            </Popover>
          </>
        }
      />
      <p data-slot="prompt-input-probe-counts" className="text-caption-1-regular text-text-secondary">
        提交{' '}
        <span data-slot="prompt-input-probe-submit-count" data-testid="submit-count">
          {submits}
        </span>{' '}
        · 停止{' '}
        <span data-slot="prompt-input-probe-stop-count" data-testid="stop-count">
          {stops}
        </span>
        {' · '}
        <Button size="small" variant="ghost" onPress={() => setStreaming((s) => !s)}>
          {streaming ? '结束流式' : '模拟流式'}
        </Button>
        {' · '}
        <Button size="small" variant="ghost" onPress={() => setSteerable((s) => !s)}>
          {steerable ? '关掉可插话' : '开可插话'}
        </Button>
      </p>
      <p data-slot="prompt-input-probe-note" className="text-caption-1-regular text-text-secondary">
        「可插话」是子 agent 的模式：流式中 Enter 仍然提交，Send 保持 Send，Stop 单独出现在它左边——
        但只在框里有字的时候，框空了 PromptInput 会把 Stop 的行为还给 Send。
      </p>
    </div>
  )
}

export default function WebViewLab() {
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
    probeEl('[data-slot="button"]', 'background-color', 'Button')
    probeEl('[data-slot="button"]', 'border-radius', 'Button')
    probeEl('[data-slot="switch-control"]', 'background-color', 'Switch 轨道')
    probeEl('[data-slot="progress-circle"]', 'color', 'ProgressCircle')

    // `:has()` is the one feature used heavily enough for selector matching cost
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
    // One frame in, so the base layer's stylesheet has been applied before
    // anything is measured.
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
    <div data-slot="webview-lab" className="h-full overflow-y-auto bg-background-full text-text-primary">
      <div data-slot="webview-lab-body" className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <header data-slot="webview-lab-header" className="space-y-1">
          <h1 data-slot="webview-lab-title" className="text-title-3-semibold">
            boardui + React Aria 基础层在 WebView2 的落地探测
          </h1>
          <p data-slot="webview-lab-intro" className="text-caption-1-regular text-text-secondary">
            必须在 <code data-slot="webview-lab-intro-code">pnpm tauri dev</code>{' '}
            的窗口里看。浏览器里跑出来的结果不作数。
          </p>
        </header>

        <Section title="探测结果" hint="复制这段发回给我">
          <div data-slot="webview-lab-report-actions" className="flex gap-2">
            <Button
              size="small"
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
            </Button>
          </div>
          <pre
            data-slot="webview-lab-report"
            className="max-h-96 overflow-auto rounded-lg border bg-background-secondary-default/30 p-3 font-mono text-caption-1-regular whitespace-pre-wrap select-all"
          >
            {asText}
          </pre>
        </Section>

        <Section title="基础组件实拍" hint="看有没有错位、缺色、缺边框">
          <div data-slot="webview-lab-components" ref={buttonRef} className="space-y-4 rounded-lg border p-4">
            <div data-slot="webview-lab-buttons" className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button isDisabled>Disabled</Button>
              <ProgressCircle isIndeterminate aria-label="加载中" />
            </div>

            {/* Control 嵌在 Content 里面，不是它的兄弟：Content 是那个可点击的
                <label>，Control 挪到外面就再也点不动了 */}
            <div data-slot="webview-lab-toggles" className="flex flex-wrap items-center gap-6">
              <Switch defaultSelected>开关</Switch>
              <Checkbox defaultSelected>复选</Checkbox>
            </div>

            <div data-slot="webview-lab-inputs" className="max-w-sm space-y-2">
              <Input placeholder="Input：单行输入" />
              <TextArea placeholder="TextArea：多行输入" rows={2} />
            </div>

            {/* Button's sizes are Tailwind utility classes merged through
                `cx()` (tailwind-merge) — this checks that a caller's own
                className genuinely outranks the built-in `h-*`/`size-*` rather
                than losing the merge. Everything the composer builds on top of
                Button sizes itself this way. */}
            <div
              data-slot="webview-lab-size-probe"
              data-probe="size-override"
              className="flex flex-wrap items-center gap-3"
            >
              <Button className="h-6 px-1.5">h-6</Button>
              <Button className="size-6 p-0">size-6</Button>
              {/* eslint-disable-next-line no-restricted-syntax -- probe: measures whether utilities beat .button */}
              <Button className="h-auto p-1">h-auto p-1</Button>
              {}
              <Button iconOnly leadingIcon={Plus} aria-label="size-8" className="size-8" />
            </div>

            <Slider defaultValue={40} className="max-w-xs" aria-label="滑块" />

            <div data-slot="webview-lab-overlays" className="flex flex-wrap items-center gap-3">
              <TooltipTrigger delay={0}>
                <Button variant="secondary">悬停看 Tooltip</Button>
                <Tooltip>浮层定位对不对</Tooltip>
              </TooltipTrigger>

              <Popover>
                <Popover.Trigger>
                  <Button variant="secondary">点开 Popover</Button>
                </Popover.Trigger>
                <Popover.Content className="p-3 text-body-regular">这里应该有边框和阴影</Popover.Content>
              </Popover>

              {/* Trigger 得自己放 Value 和 Indicator，否则是个空框；集合项必须带
                  id（不是 key/value），非纯文本内容还要补 textValue */}
              <Select defaultSelectedKey="opus" aria-label="模型" className="w-44">
                <SelectItem id="opus" textValue="Opus">
                  Opus
                </SelectItem>
                <SelectItem id="sonnet" textValue="Sonnet">
                  Sonnet
                </SelectItem>
                <SelectItem id="haiku" textValue="Haiku">
                  Haiku
                </SelectItem>
              </Select>
            </div>

            {/* 与聊天里的折叠卡片同类，之前在虚拟滚动上踩过坑 */}
            <Disclosure>
              <Disclosure.Heading>
                <Disclosure.Trigger className="flex w-full items-center gap-2">
                  展开看折叠动画
                  <Disclosure.Indicator />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body className="text-body-regular text-text-secondary">
                  展开时高度过渡是否平滑，有没有闪烁或跳动。
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          </div>
        </Section>

        {/* Whether PromptInput can be given an IME guard at all.

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

        {/* The code block's header slot carries no language label of its own —
            `markdown-content.tsx`'s `CodeBlock` just puts a `<span>` in it.
            Since the icon pack is already here for the file tree, the label can
            carry the language's file icon instead of spelling out "TYPESCRIPT".
            `languageIconUrl` maps a fence label onto the file it would live in. */}
        <Section title="CodeBlock + 语言图标" hint="每种语言的图标都要认得出来，认不出的回落成通用文件图标">
          <div data-slot="webview-lab-code-blocks" className="space-y-3">
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
                <div data-slot="webview-lab-code-block" key={lang} className="code-block rounded-xl">
                  <div data-slot="webview-lab-code-block-header" className="code-block__header">
                    {icon && (
                      <img data-slot="webview-lab-code-block-icon" src={icon} alt="" aria-hidden className="size-4" />
                    )}
                    <span
                      data-slot="webview-lab-code-block-lang"
                      className="text-caption-1-regular text-text-secondary"
                    >
                      {lang}
                    </span>
                  </div>
                  <ShikiCode code={code} language={lang} />
                </div>
              )
            })}
          </div>
        </Section>

        {/* `MarkdownContent` memoises per block, so a streaming token stops
            re-parsing the entire answer, and runs its own remark pipeline —
            `[remarkGfm, remarkBreaks]` — which turns a lone `\n` into a `<br>`.
            The base layer's `Markdown` does neither: it is a styled wrapper
            with no parser of its own, so it shows the raw string. Both get the
            same string; read the first three lines of each. */}
        <Section title="Markdown 文件引用" hint="引用所在行与上下行的高度应一致">
          <FilePreviewContext value={PROBE_FILE_PREVIEW}>
            <div data-slot="webview-lab-file-reference" className="rounded-lg border p-3">
              <MarkdownContent content={FILE_REFERENCE_PROBE} />
            </div>
          </FilePreviewContext>
        </Section>

        <Section title="Markdown 两边对照" hint="重点看开头三行：右边会不会断成三行">
          <div data-slot="webview-lab-markdown-compare" className="grid grid-cols-2 gap-4">
            <div data-slot="webview-lab-markdown-ours" className="min-w-0 space-y-2">
              <h3 data-slot="webview-lab-markdown-heading" className="text-caption-1-medium text-text-secondary">
                现在（react-markdown + remark-gfm）
              </h3>
              <div data-slot="webview-lab-markdown-frame" className="rounded-lg border p-3">
                <MarkdownContent content={MARKDOWN_PROBE} />
              </div>
            </div>
            <div data-slot="webview-lab-markdown-plain" className="min-w-0 space-y-2">
              <h3 data-slot="webview-lab-markdown-heading" className="text-caption-1-medium text-text-secondary">
                base 层的 Markdown（无解析，仅样式）
              </h3>
              <div data-slot="webview-lab-markdown-frame" className="rounded-lg border p-3">
                <Markdown>{MARKDOWN_PROBE}</Markdown>
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

            It is also the minimal reproduction for two things React Aria's
            Popover does that the app lives with, both measured here:

            1. Any scroll closes it. It listens for `scroll` on `window` in the
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
          <p data-slot="webview-lab-sidebar-note" className="text-caption-1-regular text-text-secondary">
            三个读数都要有值。任何一个空，侧栏的选中或右键菜单就是坏的——而坏法是安静的，不报错也不掉类型。
          </p>
        </Section>

        <Section title="Composer 同构复现" hint="右键输入框；滚动一下看菜单是否消失">
          <div data-slot="webview-lab-composer" ref={proRef} className="rounded-lg border">
            <div data-slot="webview-lab-composer-padding" className="px-4 pb-4 pt-2">
              <div data-slot="webview-lab-composer-width" className="mx-auto max-w-2xl">
                <ContextMenu>
                  {/* ContextMenu.Trigger 不带 render prop 时渲染成一个普通 div，
                      默认就是 block；`w-full` 是为了让它撑满输入框的宽度。 */}
                  <ContextMenu.Trigger className="block w-full">
                    <TextField aria-label="发送消息">
                      <InputGroup className="flex flex-col gap-2 rounded-2xl py-2">
                        <div data-slot="webview-lab-composer-textarea" className="relative w-full">
                          <InputGroup.TextArea
                            rows={1}
                            placeholder="发送消息…"
                            className="min-h-6 max-h-[200px] w-full flex-none resize-none px-3.5 py-0"
                          />
                        </div>
                        <InputGroup.Suffix className="w-full items-center gap-1 border-0 px-3 py-0">
                          <TooltipTrigger delay={0}>
                            <Button iconOnly leadingIcon={Plus} size="small" variant="neutral" aria-label="加号" />
                            <Tooltip>加号</Tooltip>
                          </TooltipTrigger>
                          <span data-slot="webview-lab-composer-spacer" className="flex-1" />
                          <TooltipTrigger delay={0}>
                            <Button
                              iconOnly
                              leadingIcon={ArrowUp}
                              size="small"
                              aria-label="发送"
                              className="rounded-full"
                            />
                            <Tooltip>发送</Tooltip>
                          </TooltipTrigger>
                        </InputGroup.Suffix>
                      </InputGroup>
                    </TextField>
                  </ContextMenu.Trigger>
                  <ContextMenu.Popover>
                    <ContextMenu.Menu aria-label="发送消息">
                      <ContextMenu.Item id="cut" textValue="剪切">
                        <Scissors className="size-4 text-text-secondary" />
                        <Label>剪切</Label>
                        <Kbd className="ms-auto">Ctrl+X</Kbd>
                      </ContextMenu.Item>
                      <ContextMenu.Item id="copy" textValue="复制">
                        <Copy className="size-4 text-text-secondary" />
                        <Label>复制</Label>
                        <Kbd className="ms-auto">Ctrl+C</Kbd>
                      </ContextMenu.Item>
                      <ContextMenu.Item id="paste" textValue="粘贴">
                        <ArrowInDownDashedPanel className="size-4 text-text-secondary" />
                        <Label>粘贴</Label>
                        <Kbd className="ms-auto">Ctrl+V</Kbd>
                      </ContextMenu.Item>
                      <ContextMenu.Separator />
                      <ContextMenu.Item id="select-all" textValue="全选">
                        <CursorText className="size-4 text-text-secondary" />
                        <Label>全选</Label>
                        <Kbd className="ms-auto">Ctrl+A</Kbd>
                      </ContextMenu.Item>
                    </ContextMenu.Menu>
                  </ContextMenu.Popover>
                </ContextMenu>
              </div>
            </div>
          </div>
          <p data-slot="webview-lab-composer-note" className="text-caption-1-regular text-text-secondary">
            输入框必须满宽。把窗口拉矮再在靠底部处右键，看菜单是翻到上方去，还是原地压扁出滚动条。
          </p>
        </Section>

        {/* 这里原本是「现有组件对照」：一排 Meridian 的 Button 挨着上面旧组件库的
            Button，用来看旧库的样式表有没有污染我们的包装。包装已经全部删掉，
            两边的 Button 是同一个组件，那个对照也就照不出任何东西了。留下的是
            组件库不提供、因而仍由本项目自己拼的组合件——只有它们还会自己读
            token，也只有它们能显示出主题层被抢的后果。 */}
        <Section title="本项目自有组合件" hint="仍自己读 token 的那部分">
          <div data-slot="webview-lab-composites" className="space-y-3 rounded-lg border p-4">
            <Bubble>
              <BubbleContent>气泡的圆角、底色、内边距应当和迁移前一致。</BubbleContent>
            </Bubble>
            <p data-slot="webview-lab-composites-note" className="text-caption-1-regular text-text-secondary">
              这行是 text-muted，应当是灰的；如果变成正文色，说明 --muted 被抢了。
            </p>
          </div>
        </Section>

        <Section title=":has() 压测" hint="200 个节点，看上面的耗时读数">
          <div data-slot="webview-lab-perf" ref={perfRef} className="max-h-32 overflow-auto rounded-lg border p-2">
            <style data-slot="webview-lab-perf-style">{`
              .probe-host:has(.probe-item:hover) .probe-item { opacity: 0.9; }
              .probe-host.probe-flip .probe-item:has(+ .probe-item) { outline: 1px solid transparent; }
            `}</style>
            <div data-slot="webview-lab-perf-host" className="probe-host flex flex-wrap gap-1">
              {Array.from({ length: 200 }, (_, i) => (
                <span
                  key={i}
                  data-slot="webview-lab-perf-item"
                  className="probe-item rounded-md bg-background-secondary-default px-1 text-caption-1-regular"
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
