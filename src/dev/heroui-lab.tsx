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

import { ArrowDownToSquare, Copy, Scissors, SquareDashedText } from '@gravity-ui/icons'

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
} from '@heroui/react'

// Subpath, never the barrel: the barrel reaches recharts, tiptap and maplibre,
// none of which are installed — importing it fails the build outright.
import { ContextMenu as ProContextMenu } from '@heroui-pro/react/context-menu'
import { Markdown as ProMarkdown } from '@heroui-pro/react/markdown'
import { PromptInput as ProPromptInput } from '@heroui-pro/react/prompt-input'

import { isSubmitKey } from '@/hooks/use-coarse-pointer'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { ShikiCode } from '@/components/chat/shiki-code'
import { languageIconUrl } from '@/lib/file-icon'

/** Feature detections, each phrased so `true` means "WebView2 will render it". */
const PROBES: Array<{ name: string; note?: string; test: () => boolean }> = [
  { name: 'oklch()', note: 'Meridian 自己的 token 已在用', test: () => CSS.supports('color', 'oklch(0.5 0.1 200)') },
  { name: 'color-mix()', note: 'HeroUI 5 个文件用到', test: () => CSS.supports('color', 'color-mix(in oklab, red, blue)') },
  { name: ':has()', note: 'HeroUI 19 个文件用到', test: () => CSS.supports('selector(:has(*))') },
  { name: '@property', note: 'HeroUI 1 个文件用到', test: () => typeof CSS !== 'undefined' && 'registerProperty' in CSS },
  { name: 'backdrop-filter', test: () => CSS.supports('backdrop-filter', 'blur(4px)') },
  { name: 'view transitions', note: 'HeroUI 3 个文件用到', test: () => 'startViewTransition' in document },
  { name: 'content-visibility', note: '⚠️ 本项目曾在此崩溃；HeroUI 自身不用', test: () => CSS.supports('content-visibility', 'auto') },
  { name: 'contain', note: '⚠️ 本项目曾在此错位；HeroUI 自身不用', test: () => CSS.supports('contain', 'content') },
  // Pro 用到而 OSS 不用的几个。前两个决定 TextShimmer 能不能上：它的渐变宽度
  // 是 `calc(… * tan(角度))`，颜色是 `oklch(from currentColor …)`。任一不支持，
  // 整条 background 简写就解析失败，而 `-webkit-text-fill-color: transparent`
  // 是独立声明照样生效 —— 结果不是降级，是那段文字直接看不见。
  { name: 'oklch(from …) 相对颜色', note: 'Pro TextShimmer 用；不支持则文字消失', test: () => CSS.supports('color', 'oklch(from red l c h)') },
  { name: 'tan() 三角函数', note: 'Pro TextShimmer 用；不支持则文字消失', test: () => CSS.supports('width', 'calc(1px * tan(15deg))') },
  { name: 'display: contents', note: 'Pro PromptInput 的 compact/inline 布局', test: () => CSS.supports('display', 'contents') },
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
  '--background', '--foreground', '--muted', '--accent', '--default',
  '--surface', '--overlay', '--danger', '--focus', '--radius', '--border',
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
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        {title}
        {hint && <span className="ml-2 font-normal text-muted">{hint}</span>}
      </h2>
      {children}
    </section>
  )
}

function PromptInputProbe() {
  const [value, setValue] = useState('')
  const [submits, setSubmits] = useState(0)

  return (
    <div className="space-y-2">
      <ProPromptInput
        value={value}
        onValueChange={setValue}
        onSubmit={() => { setSubmits((n) => n + 1); setValue('') }}
      >
        <ProPromptInput.Shell>
          <ProPromptInput.Content>
            <ProPromptInput.TextArea
              placeholder="打几个字，试 Enter / Shift+Enter / 组词中的 Enter"
              // Capture, not bubble: the built-in handler runs first and has
              // already submitted by the time a bubble handler would see it.
              onKeyDownCapture={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                if (!isSubmitKey(e)) e.stopPropagation()
              }}
            />
          </ProPromptInput.Content>
          <ProPromptInput.Toolbar>
            <ProPromptInput.ToolbarEnd>
              <ProPromptInput.Send />
            </ProPromptInput.ToolbarEnd>
          </ProPromptInput.Toolbar>
        </ProPromptInput.Shell>
      </ProPromptInput>
      <p data-slot="probe-submits" className="text-xs text-muted">
        提交次数：<span data-testid="submit-count">{submits}</span> · 当前值长度：{value.length}
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
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold">HeroUI v3 在 WebView2 的落地探测</h1>
          <p className="text-xs text-muted">
            必须在 <code>pnpm tauri dev</code> 的窗口里看。浏览器里跑出来的结果不作数。
          </p>
        </header>

        <Section title="探测结果" hint="复制这段发回给我">
          <div className="flex gap-2">
            <HButton
              size="sm"
              onClick={() => {
                setReport(collect())
                navigator.clipboard?.writeText(asText).then(
                  () => { setCopied(true); setTimeout(() => setCopied(false), 1500) },
                  () => { /* 剪贴板不可用时下面的文本可以手选 */ },
                )
              }}
            >
              {copied ? '已复制' : '重新采集并复制'}
            </HButton>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-default/30 p-3 font-mono text-xs whitespace-pre-wrap select-all">
            {asText}
          </pre>
        </Section>

        <Section title="HeroUI 组件实拍" hint="看有没有错位、缺色、缺边框">
          <div ref={buttonRef} className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <HButton>Primary</HButton>
              <HButton variant="secondary">Secondary</HButton>
              <HButton variant="ghost">Ghost</HButton>
              <HButton isDisabled>Disabled</HButton>
              <HProgressCircle isIndeterminate aria-label="加载中" />
            </div>

            {/* Control 嵌在 Content 里面，不是它的兄弟：Content 是那个可点击的
                <label>，Control 挪到外面就再也点不动了 */}
            <div className="flex flex-wrap items-center gap-6">
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

            <div className="max-w-sm space-y-2">
              <HInput fullWidth placeholder="Input：单行输入" />
              <HTextArea fullWidth placeholder="TextArea：多行输入" rows={2} />
            </div>

            {/* HeroUI declares `.button`'s height as a plain rule, not inside a
                utility layer — so a Tailwind size class on the same element may
                or may not outrank it. Everything the composer builds on top of
                Button sizes itself this way. */}
            <div data-probe="size-override" className="flex flex-wrap items-center gap-3">
              <HButton className="h-6 px-1.5">h-6</HButton>
              <HButton className="size-6 p-0">size-6</HButton>
              <HButton className="h-auto p-1">h-auto p-1</HButton>
              <HButton isIconOnly className="size-8">size-8</HButton>
            </div>

            <HSlider defaultValue={40} className="max-w-xs" aria-label="滑块">
              <HSlider.Track>
                <HSlider.Fill />
                <HSlider.Thumb />
              </HSlider.Track>
            </HSlider>

            <div className="flex flex-wrap items-center gap-3">
              <HTooltip delay={0}>
                <HButton variant="secondary">悬停看 Tooltip</HButton>
                <HTooltip.Content>浮层定位对不对</HTooltip.Content>
              </HTooltip>

              <HPopover>
                <HPopover.Trigger>
                  <HButton variant="secondary">点开 Popover</HButton>
                </HPopover.Trigger>
                <HPopover.Content className="p-3 text-sm">
                  这里应该有边框和阴影
                </HPopover.Content>
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
          <div className="space-y-3">
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
                <div key={lang} className="code-block rounded-xl">
                  <div className="code-block__header">
                    {icon && <img src={icon} alt="" aria-hidden className="size-4" />}
                    <span className="text-xs text-muted">{lang}</span>
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
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0 space-y-2">
              <h3 className="text-xs font-medium text-muted">现在（react-markdown + remark-gfm）</h3>
              <div className="rounded-lg border p-3">
                <MarkdownContent content={MARKDOWN_PROBE} />
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-xs font-medium text-muted">Pro（+ remark-breaks，改不掉）</h3>
              <div className="rounded-lg border p-3">
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

            It is also the minimal reproduction for two defects that kept Pro's
            ContextMenu out of the composer, both measured here:

            1. Any scroll closes it. Pro listens for `scroll` on `window` in the
               capture phase and closes unless the scrolled element is inside the
               popover. Scrolling an unrelated container 120px kills the menu —
               and during streaming this transcript scrolls continuously, so the
               menu would be unusable for as long as an answer is being written.
               Not interceptable from outside: scroll does not bubble, and a
               capture listener on window is the first to see it.
            2. First open measures the panel before the portal has laid it out,
               so `max-height` comes back 36px for a 173px menu in a 300px-tall
               window, and it pins itself below the cursor instead of flipping.
               Any later reposition re-solves correctly (`placement: top`, full
               height) — so this one a resize event could paper over.

            Keep this around: it is what verifies the fix if either lands
            upstream. */}
        <Section title="Composer 同构复现" hint="右键输入框；滚动一下看菜单是否消失">
          <div ref={proRef} className="rounded-lg border">
            <div className="px-4 pb-4 pt-2">
              <div className="mx-auto max-w-2xl">
                <ProContextMenu>
                  {/* `block w-full` 不是装饰：Pro 给 .context-menu__trigger 定的是
                      inline-block，包住撑满宽度的输入框时会把它塌成内容宽。这两个
                      类能不能压过它，取决于 index.css 里的 layer() 写没写对——上面
                      报告里那条 display 读数测的就是这件事。 */}
                  <ProContextMenu.Trigger className="block w-full">
                    <HTextField fullWidth aria-label="发送消息">
                      <HInputGroup fullWidth className="flex flex-col gap-2 rounded-2xl py-2">
                        <div className="relative w-full">
                          <HInputGroup.TextArea
                            rows={1}
                            placeholder="发送消息…"
                            className="min-h-6 max-h-[200px] w-full flex-none resize-none px-3.5 py-0"
                          />
                        </div>
                        <HInputGroup.Suffix className="w-full items-center gap-1 border-0 px-3 py-0">
                          <HButton isIconOnly size="sm" variant="ghost" aria-label="加号" className="rounded-lg">+</HButton>
                          <span className="flex-1" />
                          <HButton isIconOnly size="sm" aria-label="发送" className="rounded-full">↑</HButton>
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
          <p className="text-xs text-muted">
            输入框必须满宽。把窗口拉矮再在靠底部处右键，看菜单是翻到上方去，还是原地压扁出滚动条。
          </p>
        </Section>

        {/* 这里原本是「现有组件对照」：一排 Meridian 的 Button 挨着上面 HeroUI 的
            Button，用来看 HeroUI 的样式表有没有污染我们的包装。包装已经全部删掉，
            两边的 Button 是同一个组件，那个对照也就照不出任何东西了。留下的是
            HeroUI 不提供、因而仍由本项目自己拼的组合件——只有它们还会自己读
            token，也只有它们能显示出主题层被抢的后果。 */}
        <Section title="本项目自有组合件" hint="仍自己读 token 的那部分">
          <div className="space-y-3 rounded-lg border p-4">
            <Bubble>
              <BubbleContent>气泡的圆角、底色、内边距应当和迁移前一致。</BubbleContent>
            </Bubble>
            <p className="text-xs text-muted">
              这行是 text-muted，应当是灰的；如果变成正文色，说明 --muted 被抢了。
            </p>
          </div>
        </Section>

        <Section title=":has() 压测" hint="200 个节点，看上面的耗时读数">
          <div ref={perfRef} className="max-h-32 overflow-auto rounded-lg border p-2">
            <style>{`
              .probe-host:has(.probe-item:hover) .probe-item { opacity: 0.9; }
              .probe-host.probe-flip .probe-item:has(+ .probe-item) { outline: 1px solid transparent; }
            `}</style>
            <div className="probe-host flex flex-wrap gap-1">
              {Array.from({ length: 200 }, (_, i) => (
                <span key={i} className="probe-item rounded bg-default px-1 text-xs">{i}</span>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
