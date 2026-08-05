// Dev-only probe for the HeroUI v3 migration. Reachable at #playground/heroui.
//
// The question this exists to answer is not "does HeroUI work" — it does, in a
// browser, in someone else's production app. It is whether WebView2 renders it,
// which no amount of reading can settle: this project has already had WebView2
// crash on `content-visibility` and misplace content under `contain`, both of
// which Chromium was perfectly happy with. HeroUI leans on `oklch`,
// `color-mix()`, `:has()`, `@property` and view transitions, so the same class
// of surprise is available to it.
//
// Open it under `pnpm tauri dev`, not in a browser — a browser answers a
// question nobody asked.
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Button as HButton,
  Checkbox as HCheckbox,
  Disclosure as HDisclosure,
  ListBox as HListBox,
  ListBoxItem as HListBoxItem,
  Popover as HPopover,
  ProgressCircle as HProgressCircle,
  Select as HSelect,
  Slider as HSlider,
  Switch as HSwitch,
  Tooltip as HTooltip,
} from '@heroui/react'
import '@heroui/react/styles'

import { Button } from '@/components/ui/button'
import { Bubble, BubbleContent } from '@/components/ui/bubble'

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
]

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
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
      </h2>
      {children}
    </section>
  )
}

export default function HeroUiLab() {
  const [report, setReport] = useState<Report | null>(null)
  const [copied, setCopied] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const perfRef = useRef<HTMLDivElement>(null)

  const collect = useCallback((): Report => {
    const root = getComputedStyle(document.documentElement)

    // Whether a component's own styling actually resolved, as opposed to
    // falling back to something transparent because a colour function failed.
    const rendered: Report['rendered'] = []
    const probeEl = (selector: string, prop: string, label: string) => {
      const el = buttonRef.current?.querySelector(selector)
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
          <p className="text-xs text-muted-foreground">
            必须在 <code>pnpm tauri dev</code> 的窗口里看。浏览器里跑出来的结果不作数。
          </p>
        </header>

        <Section title="探测结果" hint="复制这段发回给我">
          <div className="flex gap-2">
            <Button
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
            </Button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap select-all">
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

            <div className="flex flex-wrap items-center gap-6">
              <HSwitch defaultSelected>
                <HSwitch.Control>
                  <HSwitch.Thumb />
                </HSwitch.Control>
                <HSwitch.Content>开关</HSwitch.Content>
              </HSwitch>
              <HCheckbox defaultSelected>
                <HCheckbox.Control>
                  <HCheckbox.Indicator />
                </HCheckbox.Control>
                <HCheckbox.Content>复选</HCheckbox.Content>
              </HCheckbox>
            </div>

            <HSlider defaultValue={40} className="max-w-xs" aria-label="滑块">
              <HSlider.Track>
                <HSlider.Fill />
                <HSlider.Thumb />
              </HSlider.Track>
            </HSlider>

            <div className="flex flex-wrap items-center gap-3">
              <HTooltip delay={0}>
                <HTooltip.Trigger>
                  <HButton variant="secondary">悬停看 Tooltip</HButton>
                </HTooltip.Trigger>
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

              {/* 集合项必须带 id（不是 key/value），否则选中态和焦点全失效 */}
              <HSelect defaultSelectedKey="opus" aria-label="模型" className="w-44">
                <HSelect.Trigger />
                <HSelect.Popover>
                  <HListBox>
                    <HListBoxItem id="opus">Opus</HListBoxItem>
                    <HListBoxItem id="sonnet">Sonnet</HListBoxItem>
                    <HListBoxItem id="haiku">Haiku</HListBoxItem>
                  </HListBox>
                </HSelect.Popover>
              </HSelect>
            </div>

            {/* 与聊天里的折叠卡片同类，foxlinepro_dash 在这上面踩过虚拟滚动的坑 */}
            <HDisclosure>
              <HDisclosure.Heading>
                <HDisclosure.Trigger>
                  展开看折叠动画
                  <HDisclosure.Indicator />
                </HDisclosure.Trigger>
              </HDisclosure.Heading>
              <HDisclosure.Content>
                <HDisclosure.Body className="text-sm text-muted-foreground">
                  展开时高度过渡是否平滑，有没有闪烁或跳动。
                </HDisclosure.Body>
              </HDisclosure.Content>
            </HDisclosure>
          </div>
        </Section>

        <Section title="现有组件对照" hint="HeroUI 的样式表有没有污染它们">
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Meridian Button</Button>
              <Button size="sm" variant="secondary">Secondary</Button>
              <Button size="sm" variant="ghost">Ghost</Button>
              <Button size="sm" variant="destructive">Destructive</Button>
            </div>
            <Bubble>
              <BubbleContent>气泡的圆角、底色、内边距应当和迁移前一致。</BubbleContent>
            </Bubble>
            <p className="text-xs text-muted-foreground">
              这行是 text-muted-foreground，应当是灰的；如果变成正文色，说明 token 被抢了。
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
                <span key={i} className="probe-item rounded bg-muted px-1 text-xs">{i}</span>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
