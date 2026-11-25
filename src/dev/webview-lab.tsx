import './webview-lab.css'
// Dev-only probe of WebView2's CSS support for the Yuerchu UI + React Aria
// layer. Reachable at #playground/webview.
//
// It was built to decide whether WebView2 renders the base layer at all,
// because no amount of reading could settle it: this project had already had
// WebView2 crash on `content-visibility` and misplace content under
// `contain`, both of which Chromium was perfectly happy with. The answer came
// back yes, and the migration went on to build on it.
//
// What it still earns its keep for is the next WebView2 update: the UI
// layer leans on `oklch`, `color-mix()`, `:has()`, `@property` and view
// transitions, and this is where a regression in any of them shows
// up as something other than a puzzling screenshot.
//
// Read it under `pnpm tauri dev`. A browser only reports on Chromium, which was
// never the doubtful side.
import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowInDownDashedPanel, ArrowUp, Copy, CursorText, Plus, Scissors } from '@keyline-icons/react/two-tone'
import {
  Button as PopoverButton,
  Dialog as PopoverDialog,
  DialogTrigger,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
} from 'react-aria-components'

import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Checkbox } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { Kbd } from '@/components/yuerchu-ui/components/kbd/kbd'
import { ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Menu, MenuItem, MenuSeparator } from '@/components/yuerchu-ui/components/menu/menu'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { ProgressCircle } from '@/components/yuerchu-ui/components/progress-circle/progress-circle'
import { Select } from '@/components/yuerchu-ui/components/select/select'
import { Slider } from '@/components/yuerchu-ui/components/slider/slider'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'

import { Composer } from '@/components/chat/composer'
import { FilePreviewContext, type FilePreviewContextValue } from '@/components/chat/file-preview-context'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { ShikiCode } from '@/components/chat/shiki-code'
import { Bubble, BubbleContent } from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
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
  { name: 'svh 单位', note: 'app-shell 外框的 100svh', test: () => CSS.supports('height', '100svh') },
  { name: 'inert 属性', note: 'App Shell 用（chat 常驻但 inert）', test: () => 'inert' in HTMLElement.prototype },
]

/**
 * Every construct where the two renderers could disagree, in one string.
 *
 * The first block is the one worth reading closely: `MarkdownContent` runs its
 * own `[remarkGfm, remarkBreaks]` pipeline, so a single `\n` becomes a `<br>`
 * there, while a plain `.m-markdown` wrapper has no parser of its own and shows
 * the raw string. Everything an assistant writes goes through the former.
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
    <section data-slot="lab-section" className="m-dev-webview-lab__section">
      <h2 data-slot="lab-section-title" className="m-dev-webview-lab__section-title">
        {title}
        {hint && (
          <span data-slot="lab-section-hint" className="m-dev-webview-lab__section-hint">
            {hint}
          </span>
        )}
      </h2>
      {children}
    </section>
  )
}

function PromptInputProbe() {
  const [value, setValue] = useState('')
  const [submits, setSubmits] = useState(0)
  const [stops, setStops] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [steerable, setSteerable] = useState(false)

  return (
    <div data-slot="prompt-input-probe" className="m-dev-webview-lab__prompt-probe">
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
          <span data-slot="prompt-input-probe-slot-start" data-testid="slot-start" className="m-dev-webview-lab__note">
            工具槽
          </span>
        }
        toolbarEnd={
          <>
            <span data-slot="prompt-input-probe-slot-end" data-testid="slot-end" className="m-dev-webview-lab__note">
              右槽
            </span>
            {/* Same shape as the composer's context gauge, which went missing
                after the move. */}
            <DialogTrigger>
              <TooltipTrigger>
                <PopoverButton aria-label="上下文用量" className="m-webview-lab__popover-trigger">
                  <span aria-hidden="true">
                    <ProgressCircle aria-label="上下文用量" value={40} maxValue={100} size="sm" />
                  </span>
                </PopoverButton>
                <Tooltip>上下文用量</Tooltip>
              </TooltipTrigger>
              <Popover offset={8} placement="top">
                <PopoverDialog aria-label="上下文用量">用量面板</PopoverDialog>
              </Popover>
            </DialogTrigger>
          </>
        }
      />
      <p data-slot="prompt-input-probe-counts" className="m-dev-webview-lab__note">
        提交{' '}
        <span data-slot="prompt-input-probe-submit-count" data-testid="submit-count">
          {submits}
        </span>{' '}
        · 停止{' '}
        <span data-slot="prompt-input-probe-stop-count" data-testid="stop-count">
          {stops}
        </span>
        {' · '}
        <Button size="sm" variant="ghost" onPress={() => setStreaming((s) => !s)}>
          {streaming ? '结束流式' : '模拟流式'}
        </Button>
        {' · '}
        <Button size="sm" variant="ghost" onPress={() => setSteerable((s) => !s)}>
          {steerable ? '关掉可插话' : '开可插话'}
        </Button>
      </p>
      <p data-slot="prompt-input-probe-note" className="m-dev-webview-lab__note">
        「可插话」是子 agent 的模式：流式中 Enter 仍然提交，Send 保持 Send，Stop 单独出现在它左边——
        但只在框里有字的时候，框空了 PromptInput 会把 Stop 的行为还给 Send。
      </p>
    </div>
  )
}

function ComposerContextProbe() {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    event.preventDefault()
    setAnchor({ x: event.clientX, y: event.clientY })
  }, [])

  return (
    <>
      <div className="m-dev-webview-lab__composer-target" onContextMenu={handleContextMenu}>
        {/* The composer probe, rewritten with pointer-anchored Popover + Menu. */}
        <AriaTextField aria-label="发送消息">
          <div className="m-dev-webview-lab__composer-shell">
            <div data-slot="webview-lab-composer-textarea" className="m-dev-webview-lab__composer-textarea-wrap">
              <AriaTextArea rows={1} placeholder="发送消息…" className="m-dev-webview-lab__composer-textarea" />
            </div>
            <div className="m-dev-webview-lab__composer-toolbar">
              <TooltipTrigger>
                <Button icon={<Plus />} size="sm" variant="ghost" aria-label="加号" />
                <Tooltip>加号</Tooltip>
              </TooltipTrigger>
              <span data-slot="webview-lab-composer-spacer" className="m-dev-webview-lab__composer-spacer" />
              <TooltipTrigger>
                <span className="m-dev-webview-lab__send-wrap">
                  <Button icon={<ArrowUp />} size="sm" aria-label="发送" />
                </span>
                <Tooltip>发送</Tooltip>
              </TooltipTrigger>
            </div>
          </div>
        </AriaTextField>
      </div>
      <span
        ref={anchorRef}
        aria-hidden
        className="m-dev-webview-lab__context-anchor"
        style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
      />
      <Popover
        triggerRef={anchorRef}
        isOpen={anchor !== null}
        onOpenChange={(open) => {
          if (!open) setAnchor(null)
        }}
        placement="bottom start"
        offset={0}
      >
        <Menu variant="inline" aria-label="发送消息" onAction={() => setAnchor(null)}>
          <MenuItem id="cut" icon={<Scissors aria-hidden />} trailing={<Kbd>Ctrl+X</Kbd>} textValue="剪切">
            剪切
          </MenuItem>
          <MenuItem id="copy" icon={<Copy aria-hidden />} trailing={<Kbd>Ctrl+C</Kbd>} textValue="复制">
            复制
          </MenuItem>
          <MenuItem
            id="paste"
            icon={<ArrowInDownDashedPanel aria-hidden />}
            trailing={<Kbd>Ctrl+V</Kbd>}
            textValue="粘贴"
          >
            粘贴
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="select-all" icon={<CursorText aria-hidden />} trailing={<Kbd>Ctrl+A</Kbd>} textValue="全选">
            全选
          </MenuItem>
        </Menu>
      </Popover>
    </>
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
      target: React.RefObject<HTMLDivElement | null> = buttonRef,
    ) => {
      const el = target.current?.querySelector(selector)
      if (!el) {
        rendered.push({ name: label, prop, value: '<not found>' })
        return
      }
      rendered.push({ name: label, prop, value: getComputedStyle(el).getPropertyValue(prop).trim() })
    }
    probeEl('.ui-button', 'background-color', 'Button')
    probeEl('.ui-button', 'border-radius', 'Button')
    probeEl('.ui-switch__track', 'background-color', 'Switch 轨道')
    probeEl('.ui-progress-circle__fill', 'stroke', 'ProgressCircle')

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
    // One frame in, so the UI layer's stylesheet has been applied before
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
    <div data-slot="webview-lab" className="m-dev-webview-lab">
      <div data-slot="webview-lab-body" className="m-dev-webview-lab__body">
        <header data-slot="webview-lab-header" className="m-dev-webview-lab__header">
          <h1 data-slot="webview-lab-title" className="m-dev-webview-lab__title">
            Yuerchu UI + React Aria 基础层在 WebView2 的落地探测
          </h1>
          <p data-slot="webview-lab-intro" className="m-dev-webview-lab__intro">
            必须在 <code data-slot="webview-lab-intro-code">pnpm tauri dev</code>{' '}
            的窗口里看。浏览器里跑出来的结果不作数。
          </p>
        </header>

        <Section title="探测结果" hint="复制这段发回给我">
          <div data-slot="webview-lab-report-actions" className="m-dev-webview-lab__report-actions">
            <Button
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
            </Button>
          </div>
          <pre data-slot="webview-lab-report" className="m-dev-webview-lab__report">
            {asText}
          </pre>
        </Section>

        <Section title="基础组件实拍" hint="看有没有错位、缺色、缺边框">
          <div data-slot="webview-lab-components" ref={buttonRef} className="m-dev-webview-lab__panel">
            <div data-slot="webview-lab-buttons" className="m-dev-webview-lab__row">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button isDisabled>Disabled</Button>
              <ProgressCircle isIndeterminate aria-label="加载中" />
            </div>

            {/* Control 嵌在 Content 里面，不是它的兄弟：Content 是那个可点击的
                <label>，Control 挪到外面就再也点不动了 */}
            <div data-slot="webview-lab-toggles" className="m-dev-webview-lab__toggles">
              <Switch defaultSelected>开关</Switch>
              <Checkbox defaultSelected>复选</Checkbox>
            </div>

            <div data-slot="webview-lab-inputs" className="m-dev-webview-lab__inputs">
              <TextField aria-label="单行输入" placeholder="Input：单行输入" />
              <TextArea aria-label="多行输入" placeholder="TextArea：多行输入" rows={2} />
            </div>

            {/* Button customization is via `--ui-button-*` tokens rather than
                a second class on the component. */}
            <div data-slot="webview-lab-size-probe" data-probe="size-override" className="m-dev-webview-lab__row">
              <span className="m-dev-webview-lab__button-compact">
                <Button>compact 24px</Button>
              </span>
              <span className="m-dev-webview-lab__button-pill">
                <Button icon={<Plus />} aria-label="pill" size="sm" />
              </span>
              <Button size="sm">sm</Button>
              <Button size="lg">lg</Button>
            </div>

            <Slider defaultValue={40} aria-label="滑块" showValue="thumb" />

            <div data-slot="webview-lab-overlays" className="m-dev-webview-lab__row">
              <TooltipTrigger>
                <Button variant="secondary">悬停看 Tooltip</Button>
                <Tooltip>浮层定位对不对</Tooltip>
              </TooltipTrigger>

              <DialogTrigger>
                <PopoverButton>
                  <Button variant="secondary">点开 Popover</Button>
                </PopoverButton>
                <Popover offset={8}>
                  <PopoverDialog aria-label="弹层样式">这里应该有边框和阴影</PopoverDialog>
                </Popover>
              </DialogTrigger>

              {/* Trigger 得自己放 Value 和 Indicator，否则是个空框；集合项必须带
                  id（不是 key/value），非纯文本内容还要补 textValue */}
              <Select defaultSelectedKey="opus" aria-label="模型">
                <ListBoxItem id="opus" textValue="Opus">
                  Opus
                </ListBoxItem>
                <ListBoxItem id="sonnet" textValue="Sonnet">
                  Sonnet
                </ListBoxItem>
                <ListBoxItem id="haiku" textValue="Haiku">
                  Haiku
                </ListBoxItem>
              </Select>
            </div>
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
          <div data-slot="webview-lab-code-blocks" className="m-dev-webview-lab__code-blocks">
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
                <div data-slot="webview-lab-code-block" key={lang} className="code-block m-dev-webview-lab__code-block">
                  <div data-slot="webview-lab-code-block-header" className="code-block__header">
                    {icon && (
                      <img
                        data-slot="webview-lab-code-block-icon"
                        src={icon}
                        alt=""
                        aria-hidden
                        className="m-dev-webview-lab__code-block-icon"
                      />
                    )}
                    <span data-slot="webview-lab-code-block-lang" className="m-dev-webview-lab__code-block-lang">
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
            A plain `.m-markdown` wrapper does neither: it shows the raw string.
            Both get the same string; read the first three lines of each. */}
        <Section title="Markdown 文件引用" hint="引用所在行与上下行的高度应一致">
          <FilePreviewContext value={PROBE_FILE_PREVIEW}>
            <div data-slot="webview-lab-file-reference" className="m-dev-webview-lab__frame">
              <MarkdownContent content={FILE_REFERENCE_PROBE} />
            </div>
          </FilePreviewContext>
        </Section>

        <Section title="Markdown 两边对照" hint="重点看开头三行：右边会不会断成三行">
          <div data-slot="webview-lab-markdown-compare" className="m-dev-webview-lab__markdown-compare">
            <div data-slot="webview-lab-markdown-ours" className="m-dev-webview-lab__markdown-col">
              <h3 data-slot="webview-lab-markdown-heading" className="m-dev-webview-lab__markdown-heading">
                现在（react-markdown + remark-gfm）
              </h3>
              <div data-slot="webview-lab-markdown-frame" className="m-dev-webview-lab__frame">
                <MarkdownContent content={MARKDOWN_PROBE} />
              </div>
            </div>
            <div data-slot="webview-lab-markdown-plain" className="m-dev-webview-lab__markdown-col">
              <h3 data-slot="webview-lab-markdown-heading" className="m-dev-webview-lab__markdown-heading">
                纯 .m-markdown 容器（无解析，仅样式）
              </h3>
              <div data-slot="webview-lab-markdown-frame" className="m-dev-webview-lab__frame">
                <div data-slot="markdown" className="m-markdown">
                  {MARKDOWN_PROBE}
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Same tree as the real composer — `chat/input-bar.tsx` — minus everything
            that needs Tauri: the same field wrapper with a bare textarea inside,
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
        <Section title="Composer 同构复现" hint="右键输入框；滚动一下看菜单是否消失">
          <div data-slot="webview-lab-composer" ref={proRef} className="m-dev-webview-lab__composer-box">
            <div data-slot="webview-lab-composer-padding" className="m-dev-webview-lab__composer-padding">
              <div data-slot="webview-lab-composer-width" className="m-dev-webview-lab__composer-width">
                <ComposerContextProbe />
              </div>
            </div>
          </div>
          <p data-slot="webview-lab-composer-note" className="m-dev-webview-lab__note">
            输入框必须满宽。把窗口拉矮再在靠底部处右键，看菜单是翻到上方去，还是原地压扁出滚动条。
          </p>
        </Section>

        {/* 这里原本是「现有组件对照」：一排 Meridian 的 Button 挨着上面旧组件库的
            Button，用来看旧库的样式表有没有污染我们的包装。包装已经全部删掉，
            两边的 Button 是同一个组件，那个对照也就照不出任何东西了。留下的是
            组件库不提供、因而仍由本项目自己拼的组合件——只有它们还会自己读
            token，也只有它们能显示出主题层被抢的后果。 */}
        <Section title="本项目自有组合件" hint="仍自己读 token 的那部分">
          <div data-slot="webview-lab-composites" className="m-dev-webview-lab__composites">
            <Bubble>
              <BubbleContent>气泡的圆角、底色、内边距应当和迁移前一致。</BubbleContent>
            </Bubble>
            <p data-slot="webview-lab-composites-note" className="m-dev-webview-lab__note">
              这行是 --text-secondary，应当是灰的；如果变成正文色，说明 token 被抢了。
            </p>
          </div>
        </Section>

        <Section title=":has() 压测" hint="200 个节点，看上面的耗时读数">
          <div data-slot="webview-lab-perf" ref={perfRef} className="m-dev-webview-lab__perf">
            <div data-slot="webview-lab-perf-host" className="probe-host">
              {Array.from({ length: 200 }, (_, i) => (
                <span key={i} data-slot="webview-lab-perf-item" className="probe-item">
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
