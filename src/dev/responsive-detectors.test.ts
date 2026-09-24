import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  detectHitTargets,
  effectiveHitArea,
  expandToTouchTarget,
  gradeHitTarget,
  hitboxLiftsOwnClip,
  hitTargetSize,
  intersect,
  outermostOnly,
  type Rect,
} from './responsive-detectors'

/**
 * The arithmetic only.
 *
 * Everything else in that file reads a real layout, and this suite runs under
 * `css: false` in jsdom, where every rectangle is zero. What is worth pinning
 * here is exactly the part that was hard to get right by reading: the expansion
 * `touch-hitbox` performs, the intersection with whatever clips it, and the
 * de-duplication that decides whether a report is readable or three hundred
 * rows of the same defect.
 */

const box = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })

describe('expandToTouchTarget', () => {
  it('grows a small control to 44px around its centre', () => {
    const grown = expandToTouchTarget(box(100, 100, 124, 124)) // 24px square
    expect(grown).toEqual(box(90, 90, 134, 134))
    expect(hitTargetSize(grown)).toBe(44)
  })

  it('leaves something already large enough alone', () => {
    const rect = box(0, 0, 60, 50)
    expect(expandToTouchTarget(rect)).toEqual(rect)
  })

  it('expands each axis on its own', () => {
    // 100 wide, 20 tall: only the height needs help.
    const grown = expandToTouchTarget(box(0, 0, 100, 20))
    expect(grown).toEqual(box(0, -12, 100, 32))
  })
})

describe('effectiveHitArea', () => {
  it('is the drawn box when the element does not opt in', () => {
    const rect = box(0, 0, 24, 24)
    expect(effectiveHitArea(rect, false, [])).toEqual(rect)
  })

  /**
   * The context gauge, to scale — the case the review could not settle by
   * reading code alone. The dial is 18px so it reaches for 13px a side, while
   * `.prompt-input__shell` clips and the toolbar sits 12px off its bottom edge.
   * One pixel short, and only on that one axis.
   */
  it('loses a pixel to the composer shell, which is exactly how far it falls short', () => {
    const dial = box(100, 100, 118, 118) // 18px
    const shell = box(0, 0, 400, 130) // 12px below the dial
    const area = effectiveHitArea(dial, true, [shell])
    expect(hitTargetSize(area)).toBe(43)
    expect(gradeHitTarget(hitTargetSize(area))).toBe('fail')
  })

  it('reaches the full target where the same control has room', () => {
    const area = effectiveHitArea(box(100, 100, 118, 118), true, [box(0, 0, 400, 400)])
    expect(hitTargetSize(area)).toBe(44)
    expect(gradeHitTarget(hitTargetSize(area))).toBeNull()
  })

  // A 32px button only reaches for 6px a side, so the same 12px of clearance
  // that starves the dial above is plenty here. Worth stating, because it is why
  // "is it inside the composer" is not on its own the question.
  it('is unharmed when the expansion fits inside the clearance', () => {
    const area = effectiveHitArea(box(100, 100, 132, 132), true, [box(0, 0, 400, 144)])
    expect(hitTargetSize(area)).toBe(44)
  })

  it('takes the tightest of several clippers', () => {
    const area = effectiveHitArea(box(100, 100, 124, 124), true, [box(0, 0, 400, 400), box(95, 95, 130, 130)])
    // 24px expanded to 44 spans 90..134; the inner clipper cuts it to 95..130.
    expect(area).toEqual(box(95, 95, 130, 130))
  })
})

describe('gradeHitTarget', () => {
  it('fails below 44 and passes at it, which is what the utility targets', () => {
    expect(gradeHitTarget(24)).toBe('fail')
    expect(gradeHitTarget(43)).toBe('fail')
    expect(gradeHitTarget(44)).toBeNull()
    expect(gradeHitTarget(60)).toBeNull()
  })

  // A fractional viewport puts controls on half-pixels, and a report that
  // changed between two runs of the same page would not be worth reading.
  it('rounds, so sub-pixel layout noise is not a finding', () => {
    expect(gradeHitTarget(43.6)).toBeNull()
    expect(gradeHitTarget(43.4)).toBe('fail')
  })
})

describe('intersect', () => {
  it('collapses to zero when two boxes miss each other', () => {
    const gap = intersect(box(0, 0, 10, 10), box(20, 20, 30, 30))
    expect(hitTargetSize(gap)).toBe(0)
  })
})

describe('outermostOnly', () => {
  it('keeps the ancestor and drops what it contains', () => {
    const parent = document.createElement('div')
    const child = document.createElement('span')
    const grandchild = document.createElement('em')
    parent.appendChild(child)
    child.appendChild(grandchild)

    const kept = outermostOnly([{ el: grandchild }, { el: parent }, { el: child }])
    expect(kept).toEqual([{ el: parent }])
  })

  it('keeps siblings, which are separate defects', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    expect(outermostOnly([{ el: a }, { el: b }])).toHaveLength(2)
  })
})

/**
 * The registry `Button` is `overflow-hidden`, and `touch-hitbox`'s expansion is
 * that button's own `::after` — so the button clipped its own hit area back to
 * the drawn size, and the detector, which only walked ancestors, called it fine.
 */
describe('a touch-hitbox control that clips itself', () => {
  function mountButton(css: string | null): HTMLButtonElement {
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-test-hitbox]').forEach((s) => s.remove())
    if (css !== null) {
      const style = document.createElement('style')
      style.setAttribute('data-test-hitbox', '')
      style.textContent = css
      document.head.appendChild(style)
    }
    const button = document.createElement('button')
    button.className = 'touch-hitbox overflow-hidden'
    // jsdom does not expand the shorthand into the longhands it computes.
    button.style.overflowX = 'hidden'
    button.style.overflowY = 'hidden'
    button.style.borderWidth = '0px'
    button.getBoundingClientRect = () =>
      ({ left: 100, top: 100, right: 124, bottom: 124, width: 24, height: 24 }) as DOMRect
    document.body.appendChild(button)
    return button
  }

  it('is reported as clipped when the utility leaves its own overflow alone', () => {
    const button = mountButton(null)
    const found = detectHitTargets(document, window)
    expect(found.map((f) => f.el)).toEqual([button])
    expect(found[0].detail).toMatch(/^24px once expanded/)
  })

  it('reaches the full target once the utility lifts the clip', () => {
    mountButton('@media (any-pointer: coarse) { .touch-hitbox { position: relative; overflow: visible !important; } }')
    expect(hitboxLiftsOwnClip(document)).toBe(true)
    expect(detectHitTargets(document, window)).toEqual([])
  })

  it('does not count a lift that an equally specific overflow-hidden can override', () => {
    mountButton('@media (any-pointer: coarse) { .touch-hitbox { overflow: visible; } }')
    expect(hitboxLiftsOwnClip(document)).toBe(false)
  })

  /** The half jsdom cannot compile: the rule in the stylesheet itself. */
  it('is what the touch-hitbox utility in index.css declares', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    const start = css.indexOf('@utility touch-hitbox {')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('\n}\n', start))
    expect(block).toMatch(/@media \(any-pointer: coarse\) \{[^}]*overflow: visible !important;/)
  })
})
