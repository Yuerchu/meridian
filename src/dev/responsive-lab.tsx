import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Tooltip } from '@heroui/react'

import { CASES } from './responsive-cases'
import { runDetectors, type Finding, type Severity } from './responsive-detectors'

/**
 * A width you can point the detectors at.
 *
 * **Why an iframe.** Every responsive decision in this app is keyed to the
 * *viewport* — `useIsMobile` reads `innerWidth`, Tailwind's `md:` is a media
 * query, and Pro hides the sidebar panel at `max-width: 768px`. Nothing else
 * moves those: `transform: scale` is a visual lie, element `zoom` leaves media
 * queries and `innerWidth` disagreeing with each other, and a resizable `div`
 * only reaches the container queries that the settings pane has just started
 * using. A same-origin frame is the one thing that gives a real `innerWidth`, a
 * real media query, a real `100svh` and a real containing block for `fixed`.
 *
 * **What this can and cannot see** is printed on the page rather than only
 * written here, because a harness that overstates its reach is worse than none:
 *
 * - Overflow, escapes past the edge and short-viewport behaviour are measured
 *   for real.
 * - Touch targets are *computed*: `@media (pointer: coarse)` does not apply in a
 *   desktop browser, so the expansion `touch-hitbox` would perform is derived
 *   and intersected with whatever clips it. Green here is not a promise about a
 *   phone.
 * - The keyboard is a mechanism check. `--ime-bottom` is set on the frame's
 *   `<html>`, which is where `use-android-insets` sets it; what Android reports
 *   is not modelled.
 * - 360 and 400 do not exist on this desktop at all — `tauri.conf.json` sets
 *   `minWidth: 640`. Those two columns only mean something for Android.
 */

const WIDTHS: Array<{ px: number; note: string }> = [
  { px: 360, note: 'Android portrait — unreachable on this desktop' },
  { px: 400, note: 'Large Android portrait' },
  { px: 640, note: 'The window minimum (tauri.conf.json)' },
  { px: 768, note: 'Pro drops the sidebar panel at or below here' },
  { px: 900, note: 'Two columns, but the layer is only ~660px' },
  { px: 1000, note: 'Top of the squeeze' },
  { px: 1280, note: 'Ordinary desktop' },
]

const HEIGHTS = [360, 640, 720]

type Coarse = 'off' | 'js'

interface FrameParams {
  caseId: string
  coarse: Coarse
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * Runs once, at module load, before anything renders.
 *
 * Deleting the Tauri bridge is not tidiness: a case that reaches for `invoke` on
 * mount should fail loudly here rather than sit pending, because a case that
 * quietly never resolves looks exactly like a case with nothing wrong.
 */
function prepareFrame(params: FrameParams) {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__

  if (params.coarse !== 'js') return
  const native = window.matchMedia.bind(window)
  const FORCED = /\((?:any-)?pointer\s*:\s*coarse\)|\(hover\s*:\s*none\)/
  window.matchMedia = (query: string) => {
    const mql = native(query)
    if (!FORCED.test(query)) return mql
    // A Proxy rather than an object literal: `useTheme` and others call
    // `addEventListener` on what comes back, and an unbound method taken off a
    // real MediaQueryList throws `Illegal invocation`.
    return new Proxy(mql, {
      get(target, key) {
        if (key === 'matches') return true
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}

export function ResponsiveFrame() {
  const params = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    return { caseId: q.get('responsiveCase') ?? '', coarse: (q.get('coarse') ?? 'off') as Coarse }
  }, [])

  const prepared = useRef(false)
  if (!prepared.current) {
    prepared.current = true
    prepareFrame(params)
  }

  const active = CASES.find((c) => c.id === params.caseId)
  if (!active) return <div className="p-4 text-sm text-danger">No such case: {params.caseId}</div>
  return (
    <div data-responsive-probe="content" className="h-svh overflow-y-auto bg-background text-foreground">
      {active.render()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The parent
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = { fail: 0, warn: 1, info: 2 }

const SEVERITY_CLASS: Record<Severity, string> = {
  fail: 'text-danger',
  warn: 'text-warning',
  info: 'text-muted',
}

export default function ResponsiveLab() {
  const [caseId, setCaseId] = useState(CASES[0].id)
  const [coarse, setCoarse] = useState<Coarse>('off')
  const [width, setWidth] = useState(390)
  const [height, setHeight] = useState(720)
  const [ime, setIme] = useState(0)
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [reading, setReading] = useState<{ inner: number; client: number } | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  const src = `${window.location.pathname}?responsiveCase=${caseId}&coarse=${coarse}#playground/responsive`

  // Written straight onto the frame's `<html>`, which is the element and the
  // property `use-android-insets` writes to — so this is the same shape as the
  // real thing rather than an approximation of it.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    doc.documentElement.style.setProperty('--ime-bottom', `${ime}px`)
  }, [ime, width, height, caseId, coarse])

  const measure = useCallback(() => {
    const frame = frameRef.current
    const win = frame?.contentWindow
    const doc = frame?.contentDocument
    if (!win || !doc) return
    setFindings(runDetectors(doc, win, ime))
    setReading({ inner: win.innerWidth, client: doc.documentElement.clientWidth })
  }, [ime])

  const sweep = useCallback(async () => {
    const collected: Finding[] = []
    for (const w of WIDTHS) {
      setWidth(w.px)
      // Two frames for layout, then a macrotask for React's own response to the
      // resize event — `useIsMobile` subscribes to a media query, and its state
      // update lands after the frame the browser laid out in.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 0))
      const frame = frameRef.current
      const win = frame?.contentWindow
      const doc = frame?.contentDocument
      if (!win || !doc) continue
      for (const f of runDetectors(doc, win, ime)) {
        collected.push({ ...f, detail: `${w.px}px — ${f.detail}` })
      }
    }
    setFindings(collected)
  }, [ime])

  const sorted = useMemo(
    () => (findings ? [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) : null),
    [findings],
  )
  const active = CASES.find((c) => c.id === caseId)

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-4 py-2">
        <h1 className="text-sm font-medium">Responsive harness</h1>
        <p className="mt-1 text-xs text-muted">
          Overflow, escapes and short viewports are measured. Touch targets are <em>computed</em> — coarse-pointer CSS
          does not apply in a desktop browser, so green is not a promise about a phone. The keyboard row checks the
          mechanism, not Android&rsquo;s numbers. 360 and 400 are unreachable here (<code>minWidth: 640</code>) and only
          mean something on a device.
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-r border-border p-3 text-xs">
          <Field label="Case">
            <div className="space-y-1">
              {CASES.map((c) => (
                <Button
                  key={c.id}
                  variant={c.id === caseId ? 'secondary' : 'ghost'}
                  onClick={() => setCaseId(c.id)}
                  className="h-auto w-full justify-start rounded-md px-2 py-1 text-xs font-normal"
                >
                  {c.label}
                </Button>
              ))}
            </div>
            {active && <p className="mt-1 text-muted">{active.watchFor}</p>}
          </Field>

          <Field label="Width">
            <div className="flex flex-wrap gap-1">
              {WIDTHS.map((w) => (
                <Chip key={w.px} active={w.px === width} onClick={() => setWidth(w.px)} hint={w.note}>
                  {w.px}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Height">
            <div className="flex flex-wrap gap-1">
              {HEIGHTS.map((h) => (
                <Chip key={h} active={h === height} onClick={() => setHeight(h)}>
                  {h}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Pointer">
            <div className="flex gap-1">
              <Chip active={coarse === 'off'} onClick={() => setCoarse('off')}>
                fine
              </Chip>
              <Chip active={coarse === 'js'} onClick={() => setCoarse('js')}>
                coarse (JS only)
              </Chip>
            </div>
            <p className="mt-1 text-muted">
              Moves <code>isCoarsePointer()</code>. CSS <code>@media (pointer: coarse)</code> is untouched — that is why
              hit areas are computed rather than measured.
            </p>
          </Field>

          <Field label="Keyboard inset">
            <div className="flex gap-1">
              {[0, 240, 320].map((v) => (
                <Chip key={v} active={v === ime} onClick={() => setIme(v)}>
                  {v}
                </Chip>
              ))}
            </div>
          </Field>

          <div className="flex gap-2">
            <Button size="sm" onClick={measure}>
              Measure
            </Button>
            <Button size="sm" variant="outline" onClick={sweep}>
              Sweep widths
            </Button>
          </div>

          {reading && (
            <p className="text-muted">
              innerWidth {reading.inner} · clientWidth {reading.client}
              {reading.inner !== reading.client && ` (${reading.inner - reading.client}px of scrollbar)`}
            </p>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto bg-surface-secondary p-4">
          <iframe
            ref={frameRef}
            key={src}
            src={src}
            title="Responsive frame"
            style={{ width, height }}
            className="border border-border bg-background"
          />

          {sorted && (
            <div className="mt-4 space-y-1 text-xs">
              <p className="font-medium">{sorted.length === 0 ? 'Nothing found.' : `${sorted.length} finding(s)`}</p>
              {sorted.map((f, i) => (
                <p key={i} className={SEVERITY_CLASS[f.severity]}>
                  <span className="font-mono">{f.severity}</span> · {f.detector} · {f.path} — {f.detail}
                </p>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-medium">{label}</p>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean
  onClick: () => void
  /** What the width means. A tooltip, not a `title` — see the eslint rule. */
  hint?: string
  children: React.ReactNode
}) {
  const button = (
    <Button
      variant={active ? 'primary' : 'ghost'}
      onClick={onClick}
      className="h-auto rounded-md px-2 py-1 text-xs font-normal tabular-nums"
    >
      {children}
    </Button>
  )
  if (!hint) return button
  return (
    <Tooltip delay={0}>
      {button}
      <Tooltip.Content placement="bottom">{hint}</Tooltip.Content>
    </Tooltip>
  )
}
