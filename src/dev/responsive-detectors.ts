/**
 * What a layout can be caught doing wrong, measured rather than eyeballed.
 *
 * These run against a real document in a real browser — the harness at
 * `#playground/responsive` points them at an iframe it has resized. That is not
 * a preference: `vitest` runs with `css: false` and jsdom does no layout, so
 * every number these read would be zero there. What *is* testable is the
 * arithmetic, which is why the geometry is split out into the exported pure
 * functions below and the DOM walking is kept thin.
 *
 * The reason this file exists at all: the responsive review that produced it
 * found 42 defects, and several had survived for as long as they had because
 * nothing could see them. A breakpoint is invisible to `tsc`, to eslint and to
 * every test in the suite.
 */

export type Severity = 'fail' | 'warn' | 'info'

export interface Finding {
  detector: 'overflow' | 'escape' | 'hit-target' | 'short-viewport' | 'ime'
  severity: Severity
  /** `data-slot` chain, which is what the baseline is keyed on. */
  path: string
  detail: string
  el: Element
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 2.75rem, which is what `touch-hitbox` in `index.css` expands to and what WCAG
 * 2.5.5 asks for.
 *
 * One threshold, not two. Android's own guidance is 48dp and it was tempting to
 * warn between the two — but the utility this codebase actually has targets 44,
 * so a second threshold above it would mark every correct use of it as
 * suspect. A detector that flags the fix is a detector nobody reads.
 */
const TOUCH_TARGET = 44

// ---------------------------------------------------------------------------
// Geometry. Pure, and therefore the part a unit test can hold on to.
// ---------------------------------------------------------------------------

export function intersect(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

export function width(r: Rect): number {
  return Math.max(0, r.right - r.left)
}

export function height(r: Rect): number {
  return Math.max(0, r.bottom - r.top)
}

/**
 * What `touch-hitbox` does, in arithmetic.
 *
 * The utility is `inset: min(0px, calc((100% - 2.75rem) / 2))` on an `::after`,
 * and `inset` percentages resolve per axis against the element's own padding
 * box. So each axis is expanded, centred, to at least 44px, and an axis already
 * at least that big is left alone — `min()` clamps the inset at 0 rather than
 * shrinking anything.
 */
export function expandToTouchTarget(rect: Rect): Rect {
  const growX = Math.max(0, (TOUCH_TARGET - width(rect)) / 2)
  const growY = Math.max(0, (TOUCH_TARGET - height(rect)) / 2)
  return {
    left: rect.left - growX,
    right: rect.right + growX,
    top: rect.top - growY,
    bottom: rect.bottom + growY,
  }
}

/**
 * The hit area that survives its ancestors.
 *
 * This is the half the review could not do by reading code: `touch-hitbox`
 * expands an `::after`, and an ancestor that clips cuts the expansion back off.
 * The composer is exactly that case — `.prompt-input__shell` is
 * `overflow: hidden` and the toolbar sits 12px off its bottom edge, so a 32px
 * control there reaches 43px rather than 44.
 */
export function effectiveHitArea(rect: Rect, expanded: boolean, clippers: Rect[]): Rect {
  let area = expanded ? expandToTouchTarget(rect) : rect
  for (const clip of clippers) area = intersect(area, clip)
  return area
}

/** The smaller side, which is what decides whether a finger can land on it. */
export function hitTargetSize(area: Rect): number {
  return Math.min(width(area), height(area))
}

export function gradeHitTarget(size: number): Severity | null {
  // Rounded first: a control at 43.98 because of a fractional viewport is not a
  // finding, and sub-pixel noise would make the report differ between runs.
  return Math.round(size) < TOUCH_TARGET ? 'fail' : null
}

/**
 * Keeps only the outermost element of each overflowing subtree.
 *
 * Without this every detector reports the offender plus all of its descendants,
 * because a box that is too wide makes every box inside it too wide as well —
 * three real defects arrive as two hundred rows and the report is unreadable.
 */
export function outermostOnly<T extends { el: Element }>(items: T[]): T[] {
  const claimed = items.map((item) => item.el)
  return items.filter((item) => !claimed.some((other) => other !== item.el && other.contains(item.el)))
}

// ---------------------------------------------------------------------------
// DOM walking. Browser only.
// ---------------------------------------------------------------------------

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/** `data-slot` chain, falling back to a tag plus its first classes. */
export function slotPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && parts.length < 4) {
    const slot = node.getAttribute('data-slot')
    if (slot) parts.unshift(slot)
    node = node.parentElement
  }
  if (parts.length === 0) {
    const cls = el.className.toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase()
  }
  return parts.join(' > ')
}

function isRendered(el: Element, win: Window): boolean {
  const style = win.getComputedStyle(el)
  if (style.visibility !== 'visible' || style.display === 'none') return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  return !el.closest('[hidden],[inert],[data-state="closed"]')
}

/**
 * What clips `el`'s descendants, as the padding boxes they clip to.
 *
 * `self` adds the element's own box when it clips. That matters for the hit
 * target and nothing else: `touch-hitbox` expands an `::after`, which is the
 * element's own child as far as `overflow` is concerned — and the registry's
 * `Button` is `overflow-hidden`, so walking from the parent missed the one
 * clipper that cut every expanded button back to its drawn size.
 */
export function clippersOf(el: Element, win: Window, self = false): Rect[] {
  const out: Rect[] = []
  let node = self ? el : el.parentElement
  while (node) {
    const style = win.getComputedStyle(node)
    const clips = [style.overflowX, style.overflowY].some((v) => v !== 'visible')
    if (clips) {
      const r = rectOf(node)
      // The scrollport is the padding box, so the borders come off.
      // A computed border width is always a px length; `|| 0` only guards a detached node, and nothing here is saved.
      /* eslint-disable meridian-ui/no-parse-or-default */
      const bl = parseFloat(style.borderLeftWidth) || 0
      const br = parseFloat(style.borderRightWidth) || 0
      const bt = parseFloat(style.borderTopWidth) || 0
      const bb = parseFloat(style.borderBottomWidth) || 0
      /* eslint-enable meridian-ui/no-parse-or-default */
      out.push({ left: r.left + bl, top: r.top + bt, right: r.right - br, bottom: r.bottom - bb })
    }
    node = node.parentElement
  }
  out.push({ left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight })
  return out
}

/**
 * Content wider than its box.
 *
 * Split three ways by what the box does about it, because only one of the three
 * is a defect: clipped means the content is *gone*, scrollable is a deliberate
 * answer (the code fences and the composer toolbar both rely on it), and
 * anything ellipsised is not overflowing at all in the sense that matters —
 * `truncate` produces `scrollWidth > clientWidth` by construction, and this
 * codebase truncates in dozens of places. Without that exclusion the detector
 * reports a hundred non-defects and gets ignored.
 */
export function detectOverflow(doc: Document, win: Window): Finding[] {
  const found: Finding[] = []
  for (const el of doc.body.querySelectorAll<HTMLElement>('*')) {
    if (!isRendered(el, win)) continue
    const over = el.scrollWidth - el.clientWidth
    if (over <= 1) continue
    const style = win.getComputedStyle(el)
    if (style.display === 'inline') continue
    if (style.textOverflow === 'ellipsis') continue

    const overflowX = style.overflowX
    if (overflowX === 'hidden' || overflowX === 'clip') {
      found.push({
        detector: 'overflow',
        severity: 'fail',
        path: slotPath(el),
        detail: `${over}px of content clipped away (overflow-x: ${overflowX})`,
        el,
      })
    } else if (overflowX === 'auto' || overflowX === 'scroll') {
      found.push({
        detector: 'overflow',
        severity: 'info',
        path: slotPath(el),
        detail: `${over}px scrollable sideways`,
        el,
      })
    }
  }
  return outermostOnly(found)
}

/**
 * Drawn outside the viewport, with nothing between it and the edge.
 *
 * Walks from `body` rather than from the case under test, because the popovers
 * this is most likely to catch are portalled — the composer's `+` menu is 464px
 * of fixed width and lives at the end of `body`, nowhere near the composer.
 *
 * **A wide box inside a scroller is not an escape**, and reading it as one made
 * the first version of this useless: a markdown table correctly wrapped in
 * `overflow-x-auto` reported its own `<table>` as 68px past the edge, and a code
 * fence reported 338px. Both are reachable — that is what the scroller is for.
 * So the rectangle is intersected with every clipping ancestor first, and only
 * what survives that is compared against the viewport.
 */
export function detectEscape(doc: Document, win: Window): Finding[] {
  const found: Finding[] = []
  for (const el of doc.body.querySelectorAll<HTMLElement>('*')) {
    if (!isRendered(el, win)) continue
    const r = rectOf(el)
    // The viewport is the last entry in `clippersOf`, so drop it: comparing
    // against it here is the question being asked, not part of the setup.
    const clippers = clippersOf(el, win).slice(0, -1)
    const visible = clippers.reduce(intersect, r)
    if (width(visible) === 0 || height(visible) === 0) continue

    const overRight = visible.right - win.innerWidth
    const overLeft = -visible.left
    if (overRight <= 1 && overLeft <= 1) continue
    found.push({
      detector: 'escape',
      severity: 'fail',
      path: slotPath(el),
      detail:
        overRight > 1
          ? `${Math.round(overRight)}px past the right edge`
          : `${Math.round(overLeft)}px past the left edge`,
      el,
    })
  }
  return outermostOnly(found)
}

/**
 * Whether the loaded `touch-hitbox` rule makes its element `overflow: visible`
 * under a coarse pointer.
 *
 * Read off the stylesheets because the computed style cannot say: the rule sits
 * in `@media (any-pointer: coarse)`, which does not match on the desktop this
 * harness runs on. Walks nested rules too — Tailwind may emit the media query
 * inside the class rule rather than around it. Must be `!important`: without it
 * a component's own `overflow-hidden` can land later in the utilities layer and
 * win, which is the defect this exists to notice.
 */
export function hitboxLiftsOwnClip(doc: Document): boolean {
  const walk = (rules: CSSRuleList, coarse: boolean, hitbox: boolean): boolean => {
    for (const rule of Array.from(rules)) {
      let c = coarse
      let h = hitbox
      if ('media' in rule && (rule as CSSMediaRule).media) {
        c = c || /any-pointer:\s*coarse/.test((rule as CSSMediaRule).media.mediaText)
      }
      if ('selectorText' in rule) h = h || /(^|[^\w-])\.touch-hitbox(?![\w-])/.test((rule as CSSStyleRule).selectorText)
      const style = (rule as CSSStyleRule).style as CSSStyleDeclaration | undefined
      if (c && h && style) {
        const x = style.getPropertyValue('overflow-x') || style.getPropertyValue('overflow')
        const important =
          style.getPropertyPriority('overflow-x') === 'important' ||
          style.getPropertyPriority('overflow') === 'important'
        if (x.trim().startsWith('visible') && important) return true
      }
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested && walk(nested, c, h)) return true
    }
    return false
  }
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin
    }
    if (walk(rules, false, false)) return true
  }
  return false
}

/**
 * Things meant to be pressed.
 *
 * Deliberately without a bare `[tabindex]`: being focusable is not the same as
 * being a target. Shiki emits `<pre tabindex="0">` so the keyboard can scroll a
 * code block, and measuring that as a 37px button was a finding about nothing.
 * Anything in this codebase that really is pressable is a native control or
 * carries a role — eslint enforces the first half of that.
 */
const INTERACTIVE =
  'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="option"]'

/**
 * Anything a finger has to land on, and whether it could.
 *
 * The expansion is derived rather than observed: `@media (pointer: coarse)` does
 * not apply in a desktop browser, so the harness cannot measure the result — it
 * reads whether the element opts in and computes what the rule would produce.
 *
 * The cost of that is real and worth stating: if `touch-hitbox` were renamed or
 * its rule broken, every call site would keep its class and this would keep
 * reporting them as fine. The utility's own arithmetic is pinned by
 * `responsive-detectors.test.ts` instead, which is the closest thing to a check
 * that survives having no coarse pointer to test with.
 */
export function detectHitTargets(doc: Document, win: Window): Finding[] {
  const found: Finding[] = []
  const liftsOwnClip = hitboxLiftsOwnClip(doc)
  for (const el of doc.body.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    if (!isRendered(el, win)) continue
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue
    const own = win.getComputedStyle(el)
    if (own.pointerEvents === 'none') continue
    // A scroll container carrying `tabindex` is focusable so the keyboard can
    // scroll it, not because anything is meant to be pressed. `ShikiCode` is
    // one, and measuring it as a 37px button was noise that said nothing.
    const scrolls = [own.overflowX, own.overflowY].some((v) => v === 'auto' || v === 'scroll')
    if (scrolls && el.tagName !== 'BUTTON' && el.tagName !== 'A' && !el.getAttribute('role')) continue

    // The class alone, deliberately. Reading `::after` back was the first
    // attempt and it cannot work here: the utility is inside
    // `@media (pointer: coarse)`, which never matches in a desktop browser, so
    // the pseudo-element reports nothing on the very machine this runs on. That
    // made every correctly-fixed control report as "expanded to exactly its own
    // size, something must be clipping it" — a confident sentence about the
    // wrong thing. What is computed here is what the rule *would* produce.
    const declared = el.classList.contains('touch-hitbox')
    const raw = rectOf(el)
    // The element's own overflow counts only when the utility does not lift
    // it — which, like the expansion, has to be read off the rule rather than
    // off the computed style, since the rule is behind a coarse-pointer query.
    const area = effectiveHitArea(raw, declared, clippersOf(el, win, declared && !liftsOwnClip))
    const size = hitTargetSize(area)
    const grade = gradeHitTarget(size)
    if (!grade) continue

    const drawn = hitTargetSize(raw)
    found.push({
      detector: 'hit-target',
      severity: grade,
      path: slotPath(el),
      detail: declared
        ? `${Math.round(size)}px once expanded (${Math.round(drawn)}px drawn) — an ancestor clips the rest`
        : `${Math.round(drawn)}px, and it does not carry touch-hitbox`,
      el,
    })
  }
  return found
}

/** Floating things taller than the viewport with no way to scroll them. */
export function detectShortViewport(doc: Document, win: Window): Finding[] {
  const found: Finding[] = []
  const candidates = doc.body.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], *')
  for (const el of candidates) {
    if (!isRendered(el, win)) continue
    const style = win.getComputedStyle(el)
    if (style.position !== 'fixed') continue
    const r = rectOf(el)
    if (r.bottom <= win.innerHeight + 1 && r.top >= -1) continue

    let scrollable = false
    let node: Element | null = el
    while (node) {
      const s = win.getComputedStyle(node)
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        scrollable = true
        break
      }
      node = node.parentElement
    }
    if (el.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]')) scrollable = true

    found.push({
      detector: 'short-viewport',
      severity: scrollable ? 'info' : 'fail',
      path: slotPath(el),
      detail: scrollable
        ? `taller than the viewport, but scrolls`
        : `${Math.round(height(r))}px tall against a ${win.innerHeight}px viewport, and nothing scrolls`,
      el,
    })
  }
  return outermostOnly(found)
}

/**
 * Covered by the software keyboard.
 *
 * Verifies the mechanism, not Android's numbers: the harness sets `--ime-bottom`
 * on the frame's `<html>`, which is the same property and the same element
 * `use-android-insets` writes to. What it catches is a floating element that
 * never reads it — `app-shell` pads the shell, and anything portalled out of the
 * shell is on its own.
 */
export function detectImeOcclusion(doc: Document, win: Window, imeBottom: number): Finding[] {
  if (imeBottom <= 0) return []
  const safeBottom = win.innerHeight - imeBottom
  const found: Finding[] = []
  for (const el of doc.body.querySelectorAll<HTMLElement>('*')) {
    if (!isRendered(el, win)) continue
    if (win.getComputedStyle(el).position !== 'fixed') continue
    const r = rectOf(el)
    if (r.bottom <= safeBottom + 1) continue
    found.push({
      detector: 'ime',
      severity: 'fail',
      path: slotPath(el),
      detail: `reaches ${Math.round(r.bottom)}px, ${Math.round(r.bottom - safeBottom)}px into the keyboard`,
      el,
    })
  }
  return outermostOnly(found)
}

export function runDetectors(doc: Document, win: Window, imeBottom: number): Finding[] {
  return [
    ...detectOverflow(doc, win),
    ...detectEscape(doc, win),
    ...detectHitTargets(doc, win),
    ...detectShortViewport(doc, win),
    ...detectImeOcclusion(doc, win, imeBottom),
  ]
}
