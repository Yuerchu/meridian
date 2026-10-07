import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Bell, Gauge, Settings, Sparkles } from '@keyline-icons/react/two-tone'

import { Button } from '@/components/base'
import {
  BACKDROP_MOTION,
  MODAL_BACKDROP,
  MODAL_BACKDROP_MOTION,
  MODAL_MOTION,
  MODAL_SURFACE,
  OVERLAY_MOTION,
  OVERLAY_SURFACE,
  SHEET_SPRING,
} from '@/components/base/overlay-motion'
import { MeridianMark } from '@/components/ui/meridian-mark'
import { cx } from '@/utils/cx'
import { Section } from './shell'
import { declared, overriddenInDark, resolve, shortName, tokenNames, type Theme } from './tokens'

const THEMES: Theme[] = ['light', 'dark']
const THEME_LABEL: Record<Theme, string> = { light: '亮色', dark: '暗色' }

/** Ink and surface for a theme column, resolved the same way as the swatches. */
function columnStyle(theme: Theme): CSSProperties {
  return {
    background: resolve('--color-background-full', theme).css,
    color: resolve('--color-text-primary', theme).css,
  }
}

function secondaryInk(theme: Theme): CSSProperties {
  return { color: resolve('--color-text-secondary', theme).css }
}

/** What the browser computed for one property of an element, read after paint. */
function useComputed(property: 'backgroundColor' | 'borderRadius' | 'boxShadow', deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState('')
  useLayoutEffect(() => {
    if (ref.current) setValue(getComputedStyle(ref.current)[property])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what the paint depends on
  }, deps)
  return [ref, value] as const
}

function Swatch({ name, theme }: { name: string; theme: Theme }) {
  const { css, chain } = resolve(name, theme)
  const [ref, computed] = useComputed('backgroundColor', [css])
  const via = chain.slice(1).map(shortName).join(' → ')
  return (
    <div data-slot="token-swatch" className="flex min-w-0 items-start gap-2.5">
      <div
        ref={ref}
        className="size-9 shrink-0 rounded-lg"
        style={{ background: css, boxShadow: `inset 0 0 0 1px ${resolve('--color-border-button-default', theme).css}` }}
      />
      <div className="min-w-0 text-caption-1-regular">
        <div className="truncate text-caption-1-medium" title={name}>
          {shortName(name)}
          {theme === 'dark' && overriddenInDark(name) ? ' ·' : ''}
        </div>
        {via ? (
          <div className="truncate" style={secondaryInk(theme)} title={via}>
            {via}
          </div>
        ) : null}
        <div className="truncate tabular-nums" style={secondaryInk(theme)} title={computed}>
          {computed}
        </div>
      </div>
    </div>
  )
}

/** Both themes side by side, each column painted with that theme's own page fill. */
function ThemePair({ children }: { children: (theme: Theme) => ReactNode }) {
  return (
    <div data-slot="theme-pair" className="grid gap-3 lg:grid-cols-2">
      {THEMES.map((theme) => (
        <div
          key={theme}
          data-slot="theme-column"
          data-theme={theme}
          className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-border-button-default"
          style={columnStyle(theme)}
        >
          <span className="text-caption-1-medium" style={secondaryInk(theme)}>
            {THEME_LABEL[theme]}
          </span>
          {children(theme)}
        </div>
      ))}
    </div>
  )
}

function ColorGroup({ title, pattern, note }: { title: string; pattern: RegExp; note?: string }) {
  const names = tokenNames(pattern)
  return (
    <Section title={`${title} · ${names.length}`}>
      {note ? <p className="text-caption-1-regular text-text-secondary">{note}</p> : null}
      <ThemePair>
        {(theme) => (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
            {names.map((name) => (
              <Swatch key={name} name={name} theme={theme} />
            ))}
          </div>
        )}
      </ThemePair>
    </Section>
  )
}

/** Tailwind's own ramp steps; the values are whatever the page resolved. */
const RAMP_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '925', '950']

function Ramp({ family }: { family: 'neutral' | 'accent' }) {
  const names: string[] = []
  for (const step of RAMP_STEPS) {
    const name = `--color-${family}-${step}`
    if (family === 'neutral' || declared(name, 'light')) names.push(name)
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
      {names.map((name) => (
        <RampStep key={name} name={name} />
      ))}
    </div>
  )
}

function RampStep({ name }: { name: string }) {
  const [ref, computed] = useComputed('backgroundColor', [name])
  const own = declared(name, 'light')
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={ref}
        className="h-12 rounded-lg ring-1 ring-border-button-default ring-inset"
        style={{ background: `var(${name})` }}
      />
      <span className="text-caption-1-medium">
        {name.split('-').pop()}
        {own ? ' ·' : ''}
      </span>
      <span className="truncate text-caption-2-regular text-text-secondary" title={computed}>
        {computed || '未生成'}
      </span>
    </div>
  )
}

const TYPE_WEIGHTS = ['regular', 'medium', 'semibold', 'bold']

function TypeScale() {
  const scales = tokenNames(/^--text-[a-z0-9-]+-regular$/).map((name) => name.replace(/^--text-|-regular$/g, ''))
  return (
    <div className="flex flex-col divide-y divide-separator-border">
      {scales.map((scale) => {
        const size = declared(`--text-${scale}-regular`, 'light')?.value
        const lineHeight = declared(`--text-${scale}-regular--line-height`, 'light')?.value
        return (
          <div key={scale} data-slot="type-row" className="flex flex-col gap-1 py-3">
            <span className="text-caption-1-regular text-text-secondary">
              text-{scale}-* · {size} / {lineHeight}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 overflow-hidden">
              {TYPE_WEIGHTS.map((weight) => {
                const name = `--text-${scale}-${weight}`
                if (!declared(name, 'light')) return null
                return (
                  <span
                    key={weight}
                    className="truncate"
                    style={{
                      fontSize: resolve(name, 'light').css,
                      lineHeight: resolve(`${name}--line-height`, 'light').css,
                      letterSpacing: resolve(`${name}--letter-spacing`, 'light').css,
                      fontWeight: resolve(`${name}--font-weight`, 'light').css,
                    }}
                  >
                    {weight} 子午线 Aa
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The ladder by utility name; the pixel value is measured off the element. */
const RADII = [
  'rounded-xs',
  'rounded-sm',
  'rounded-md',
  'rounded-lg',
  'rounded-2lg',
  'rounded-xl',
  'rounded-2xl',
  'rounded-2-5xl',
  'rounded-3xl',
  'rounded-full',
]

function RadiusStep({ utility }: { utility: string }) {
  const [ref, computed] = useComputed('borderRadius', [utility])
  return (
    <div className="flex flex-col items-start gap-1">
      <div ref={ref} className={cx('size-16 bg-background-tertiary-default', utility)} />
      <span className="text-caption-1-medium">{utility.replace('rounded-', '')}</span>
      <span className="text-caption-2-regular text-text-secondary tabular-nums">{computed}</span>
    </div>
  )
}

function ShadowBox({ name, theme }: { name: string; theme: Theme }) {
  const { css } = resolve(name, theme)
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-2xl"
        style={{ boxShadow: css, background: resolve('--color-background-primary-default', theme).css }}
      />
      <span className="text-caption-1-medium">
        {shortName(name)}
        {theme === 'dark' && overriddenInDark(name) ? ' ·' : ''}
      </span>
    </div>
  )
}

function GradientBox({ name, theme }: { name: string; theme: Theme }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-10 rounded-2lg" style={{ backgroundImage: resolve(name, theme).css }} />
      <span className="truncate text-caption-1-medium">{shortName(name).replace('gradient-', '')}</span>
    </div>
  )
}

/** The overlay recipes as the components import them. */
const MOTION_RECIPES: [string, string][] = [
  ['OVERLAY_MOTION · 菜单 / 弹出层', OVERLAY_MOTION],
  ['OVERLAY_SURFACE', OVERLAY_SURFACE],
  ['MODAL_MOTION', MODAL_MOTION],
  ['MODAL_SURFACE', MODAL_SURFACE],
  ['MODAL_BACKDROP', MODAL_BACKDROP],
  ['MODAL_BACKDROP_MOTION', MODAL_BACKDROP_MOTION],
  ['BACKDROP_MOTION', BACKDROP_MOTION],
  ['SHEET_SPRING', SHEET_SPRING],
]

function MotionTokens() {
  const names = tokenNames(/^--(ease-|animate-)|-transition-ms$/)
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-1.5 text-caption-1-regular">
        {names.map((name) => (
          <div key={name} className="contents">
            <dt className="text-caption-1-medium">{shortName(name)}</dt>
            <dd className="font-mono break-all text-text-secondary">{declared(name, 'light')?.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid gap-2 text-caption-1-regular">
        {MOTION_RECIPES.map(([label, recipe]) => (
          <div key={label}>
            <dt className="text-caption-1-medium">{label}</dt>
            <dd className="font-mono break-all text-text-secondary">{recipe}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Brand() {
  const [take, setTake] = useState(0)
  return (
    <div className="flex flex-wrap items-center gap-6">
      <MeridianMark key={take} intro={take > 0} className="size-16" />
      <Button variant="secondary" size="small" onPress={() => setTake((n) => n + 1)}>
        重放开场
      </Button>
      <div className="flex items-end gap-4 text-foreground-icon-secondary">
        {(
          [
            ['size-3.5', '14 待办 / 箭头'],
            ['size-4', '16 工具块 / 标签页'],
            ['size-[18px]', '18 小按钮'],
            ['size-5', '20 按钮 / 行'],
          ] as const
        ).map(([size, label], i) => {
          const Icon = [Gauge, Sparkles, Bell, Settings][i]
          return (
            <span key={size} className="flex flex-col items-center gap-1">
              <Icon className={size} aria-hidden />
              <span className="text-caption-2-regular text-text-secondary">{label}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function Foundations() {
  return (
    <>
      <p className="text-body-2-regular text-text-secondary">
        每个值都是运行时从 <code>theme.css</code> / <code>meridian.css</code> / <code>typography.css</code> /
        <code>globals.css</code> 的声明解析出来的，这一页不保存任何数值。名字后的 · 表示该主题有自己的声明。
      </p>
      <Section title="主色板 · 两套主题共用">
        <Ramp family="neutral" />
        <Ramp family="accent" />
      </Section>
      <ColorGroup title="文字" pattern={/^--color-text-/} />
      <ColorGroup title="填充" pattern={/^--color-background-(full|primary|secondary|tertiary|quaternary)/} />
      <ColorGroup title="边线" pattern={/^--color-(border-(button|error|checkbox|focus)|separator)-/} />
      <ColorGroup title="图标" pattern={/^--color-foreground-/} />
      <ColorGroup title="状态" pattern={/^--color-status-(success|warning|danger|info)/} />
      <ColorGroup title="标签色" pattern={/^--color-status-(lime|yellow|rose|cyan|orange|blue|purple)-/} />
      <ColorGroup title="气泡" pattern={/^--color-bubble-/} />
      <ColorGroup title="图表" pattern={/^--color-chart-/} />
      <Section title="字号阶梯">
        <TypeScale />
      </Section>
      <Section title="圆角">
        <div className="flex flex-wrap gap-5">
          {RADII.map((utility) => (
            <RadiusStep key={utility} utility={utility} />
          ))}
        </div>
      </Section>
      <Section title="阴影">
        <ThemePair>
          {(theme) => (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-5">
              {tokenNames(/^--shadow-/).map((name) => (
                <ShadowBox key={name} name={name} theme={theme} />
              ))}
            </div>
          )}
        </ThemePair>
      </Section>
      <Section title="渐变">
        <ThemePair>
          {(theme) => (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
              {tokenNames(/^--gradient-/).map((name) => (
                <GradientBox key={name} name={name} theme={theme} />
              ))}
            </div>
          )}
        </ThemePair>
      </Section>
      <Section title="动效">
        <MotionTokens />
      </Section>
      <Section title="品牌与图标">
        <Brand />
      </Section>
    </>
  )
}
