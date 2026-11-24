import './shell.css'
import type { ReactNode } from 'react'
import { Moon, Sun } from '@keyline-icons/react/two-tone'

import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { useAppTheme } from '@/lib/theme'
import { GROUPS, LABS, type GroupId } from './groups'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-slot="gallery-section" className="m-dev-gallery__section">
      <h2 data-slot="gallery-section-title" className="m-dev-gallery__section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A labelled row of variants, for primitives shown side by side. */
export function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div data-slot="gallery-row" className="m-dev-gallery__row">
      {label ? <span className="m-dev-gallery__row-label">{label}</span> : null}
      <div className={className ? `m-dev-gallery__row-items ${className}` : 'm-dev-gallery__row-items'}>{children}</div>
    </div>
  )
}

/** The surface a primitive is shown on: the card it usually sits in. */
export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="gallery-stage" className={className ? `m-dev-gallery__stage ${className}` : 'm-dev-gallery__stage'}>
      {children}
    </div>
  )
}

function ThemeToggle() {
  // Through `setTheme` rather than toggling the class directly: the hook keeps
  // its own record of what it wrote, and a class it did not write is a class it
  // will not remove.
  const { resolvedTheme, setTheme } = useAppTheme()
  return (
    <TooltipTrigger>
      <Button
        icon={resolvedTheme === 'dark' ? <Sun /> : <Moon />}
        size="sm"
        aria-label="切换主题"
        variant="secondary"
        onPress={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      />
      <Tooltip placement="bottom">切换主题</Tooltip>
    </TooltipTrigger>
  )
}

/** The frame every gallery page shares: title, theme switch, the group strip. */
export function GalleryFrame({ current, children }: { current: GroupId | null; children: ReactNode }) {
  const group = GROUPS.find((g) => g.id === current)
  return (
    <div data-slot="gallery" className="m-dev-gallery">
      <div data-slot="gallery-body" className="m-dev-gallery__body">
        <header data-slot="gallery-header" className="m-dev-gallery__header">
          <div className="m-dev-gallery__header-top">
            <div className="m-dev-gallery__header-text">
              <h1 data-slot="gallery-title" className="m-dev-gallery__title">
                {group ? group.title : '组件陈列'}
              </h1>
              <p className="m-dev-gallery__subtitle">
                {group ? group.description : '业务代码用的同一套组件，dev 构建专用'}
              </p>
            </div>
            <ThemeToggle />
          </div>
          <nav data-slot="gallery-nav" aria-label="分组" className="m-dev-gallery__nav">
            <GroupLink hash="#playground" label="总览" active={current === null} />
            {GROUPS.map((g) => (
              <GroupLink key={g.id} hash={`#playground/${g.id}`} label={g.title} active={g.id === current} />
            ))}
          </nav>
        </header>
        {children}
      </div>
    </div>
  )
}

function GroupLink({ hash, label, active }: { hash: string; label: string; active: boolean }) {
  return (
    <a href={hash} aria-current={active ? 'page' : undefined} className="m-dev-gallery__group-link">
      {label}
    </a>
  )
}

/** `#playground`: every group and every harness, one line each. */
export function GalleryIndex() {
  return (
    <GalleryFrame current={null}>
      <Section title="分组">
        <div className="m-dev-gallery__index-grid">
          {GROUPS.map((g) => (
            <IndexCard key={g.id} hash={`#playground/${g.id}`} title={g.title} description={g.description} />
          ))}
        </div>
      </Section>
      <Section title="回归工具">
        <div className="m-dev-gallery__index-grid">
          {LABS.map((lab) => (
            <IndexCard key={lab.hash} hash={lab.hash} title={lab.title} description={lab.description} />
          ))}
        </div>
      </Section>
    </GalleryFrame>
  )
}

function IndexCard({ hash, title, description }: { hash: string; title: string; description: string }) {
  return (
    <a href={hash} className="m-dev-gallery__index-card">
      <span className="m-dev-gallery__index-title">{title}</span>
      <span className="m-dev-gallery__index-desc">{description}</span>
      <code className="m-dev-gallery__index-hash">{hash}</code>
    </a>
  )
}
