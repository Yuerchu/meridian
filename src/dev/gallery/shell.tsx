import type { ReactNode } from 'react'
import { Moon, Sun } from '@keyline-icons/react/two-tone'

import { Button, Tooltip, TooltipTrigger } from '@/components/base'
import { useAppTheme } from '@/lib/theme'
import { cx } from '@/utils/cx'
import { GROUPS, LABS, type GroupId } from './groups'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-slot="gallery-section" className="space-y-3">
      <h2 data-slot="gallery-section-title" className="text-body-semibold text-text-secondary">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A labelled row of variants, for primitives shown side by side. */
export function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div data-slot="gallery-row" className="flex flex-col gap-1.5">
      {label ? <span className="text-caption-1-regular text-text-secondary">{label}</span> : null}
      <div className={cx('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  )
}

/** The surface a primitive is shown on: the card it usually sits in. */
export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="gallery-stage"
      className={cx('flex flex-col gap-4 rounded-2xl bg-background-primary-default p-4 shadow-card', className)}
    >
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
    <TooltipTrigger delay={0}>
      <Button
        iconOnly
        leadingIcon={resolvedTheme === 'dark' ? Sun : Moon}
        size="small"
        aria-label="切换主题"
        variant="secondary"
        onPress={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      />
      <Tooltip placement="bottom">切换主题</Tooltip>
    </TooltipTrigger>
  )
}

/** The frame every gallery page shares: title, theme switch, the group strip. */
export function GalleryFrame({
  current,
  wide = false,
  children,
}: {
  current: GroupId | null
  /** Foundations lays out two theme columns and needs the room. */
  wide?: boolean
  children: ReactNode
}) {
  const group = GROUPS.find((g) => g.id === current)
  return (
    <div data-slot="gallery" className="h-full overflow-y-auto bg-background-full text-text-primary">
      <div data-slot="gallery-body" className={cx('mx-auto space-y-10 px-6 py-10', wide ? 'max-w-6xl' : 'max-w-3xl')}>
        <header data-slot="gallery-header" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 data-slot="gallery-title" className="text-title-3-semibold">
                {group ? group.title : '组件陈列'}
              </h1>
              <p className="text-body-2-regular text-text-secondary">
                {group ? group.description : '业务代码用的同一套组件，dev 构建专用'}
              </p>
            </div>
            <ThemeToggle />
          </div>
          <nav data-slot="gallery-nav" aria-label="分组" className="flex flex-wrap gap-1.5">
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
    <a
      href={hash}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'rounded-full px-3 py-1 text-body-2-medium transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        active
          ? 'bg-background-secondary-hover text-text-primary'
          : 'text-text-secondary hover:bg-background-secondary-default',
      )}
    >
      {label}
    </a>
  )
}

/** `#playground`: every group and every harness, one line each. */
export function GalleryIndex() {
  return (
    <GalleryFrame current={null}>
      <Section title="分组">
        <div className="grid gap-3 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <IndexCard key={g.id} hash={`#playground/${g.id}`} title={g.title} description={g.description} />
          ))}
        </div>
      </Section>
      <Section title="回归工具">
        <div className="grid gap-3 sm:grid-cols-2">
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
    <a
      href={hash}
      className={cx(
        'flex flex-col gap-0.5 rounded-2xl bg-background-primary-default p-4 shadow-card outline-none',
        'transition-colors duration-150 hover:bg-background-primary-hover',
        'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
      )}
    >
      <span className="text-body-semibold">{title}</span>
      <span className="text-caption-1-regular text-text-secondary">{description}</span>
      <code className="mt-1 text-caption-2-regular text-text-secondary">{hash}</code>
    </a>
  )
}
