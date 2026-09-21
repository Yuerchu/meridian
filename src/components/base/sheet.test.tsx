import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { Sheet } from '@/components/base'
import { useHistoryStore } from '@/stores/history-store'
import { attachHistory } from '@/lib/history-bridge'

/**
 * What a sheet promises about the work inside it.
 *
 * Five ways out — the scrim, Escape, the close button, the back gesture, and a
 * downward drag — and four of them are React Aria's or the browser's rather
 * than this app's. A guard written into one of them is a guard the other four
 * walk past, which is why they all funnel into `requestClose` and why each is
 * pinned here separately.
 */
function Panel({ isDirty, onOpenChange }: { isDirty?: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet isOpen onOpenChange={onOpenChange} placement="bottom" isDirty={isDirty}>
      <Sheet.Backdrop>
        <Sheet.Content>
          <Sheet.Dialog aria-label="panel">
            <Sheet.Handle />
            <Sheet.Body>body</Sheet.Body>
            <Sheet.CloseTrigger aria-label="Close panel" />
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}

const discard = () => screen.queryByRole('alertdialog', { name: i18n.t('sheet.discard.title') })
const click = (name: string) => userEvent.click(screen.getByRole('button', { name }))
const handle = () => document.querySelector('[data-slot="sheet-handle"]')!
const layer = () => document.querySelector<HTMLElement>('[data-slot="sheet-drag-layer"]')!

/**
 * One pointer, top to bottom, in `steps` samples `gap` milliseconds apart.
 *
 * `timeStamp` is not a constructor option — a browser stamps it and jsdom
 * stamps its own — so it is defined onto each event. Without that every sample
 * lands in the same fraction of a millisecond and the measured velocity is
 * whatever the machine was doing, which turns a deliberate slow drag into a
 * flick.
 */
function pointer(type: string, target: Element, at: number, props: Record<string, unknown>) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...props })
  Object.defineProperty(event, 'timeStamp', { value: at })
  fireEvent(target, event)
}

function drag(from: number, to: number, { steps = 3, gap = 50 }: { steps?: number; gap?: number } = {}) {
  const target = handle()
  let at = 1000
  pointer('pointerdown', target, at, { clientY: from, pointerId: 1, pointerType: 'touch', button: 0 })
  for (let i = 1; i <= steps; i++) {
    at += gap
    pointer('pointermove', target, at, { clientY: from + ((to - from) * i) / steps, pointerId: 1 })
  }
  pointer('pointerup', target, at, { clientY: to, pointerId: 1 })
}

/** `go(-n)` delivers the popstate synchronously; jsdom's own does neither. */
function installFakeHistory() {
  const entries: Array<{ __meridianDepth: number } | null> = [null]
  let index = 0
  vi.stubGlobal('history', {
    get state() {
      return entries[index]
    },
    pushState(state: { __meridianDepth: number }) {
      entries.splice(index + 1)
      entries.push(state)
      index = entries.length - 1
    },
    go(delta: number) {
      const next = Math.max(0, Math.min(entries.length - 1, index + delta))
      if (next === index) return
      index = next
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] }))
    },
  })
}

describe('Sheet', () => {
  /**
   * The gesture a bottom sheet is expected to answer, and the one that has to
   * not fire by accident: a short pull is a mis-touch, and springing back is
   * the whole of what tells the reader so.
   */
  it('closes when the handle is pulled past the threshold', () => {
    const onOpenChange = vi.fn()
    render(<Panel onOpenChange={onOpenChange} />)
    // Slowly, so it is the distance that dismisses rather than a flick.
    drag(100, 300, { gap: 400 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // The offset stays: the exit keyframe carries on from where the finger
    // left it rather than snapping the panel home and then sliding it out.
    expect(layer().style.transform).toBe('translateY(200px)')
  })

  it('springs back from a short pull without closing', () => {
    const onOpenChange = vi.fn()
    render(<Panel onOpenChange={onOpenChange} />)
    drag(100, 160, { gap: 400 })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(layer().style.transform).toBe('')
    expect(layer()).not.toHaveAttribute('data-dragging')
  })

  it('ignores an upward pull and a cancelled gesture', () => {
    const onOpenChange = vi.fn()
    render(<Panel onOpenChange={onOpenChange} />)
    drag(300, 100)
    expect(onOpenChange).not.toHaveBeenCalled()

    // What Android sends when the WebView takes the gesture for a scroll.
    pointer('pointerdown', handle(), 2000, { clientY: 100, pointerId: 2, pointerType: 'touch', button: 0 })
    pointer('pointermove', handle(), 2100, { clientY: 400, pointerId: 2 })
    pointer('pointercancel', handle(), 2200, { clientY: 400, pointerId: 2 })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(layer().style.transform).toBe('')
  })

  it('flicks away on speed alone, well short of the threshold', () => {
    const onOpenChange = vi.fn()
    render(<Panel onOpenChange={onOpenChange} />)
    // 60px in 12ms: nowhere near 120, and unmistakably a throw.
    drag(100, 160, { steps: 3, gap: 4 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks before a drag loses unsaved work, and springs back meanwhile', () => {
    const onOpenChange = vi.fn()
    render(<Panel isDirty onOpenChange={onOpenChange} />)
    drag(100, 300, { gap: 400 })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(discard()).not.toBeNull()
    // Refused, so the panel returns to rest rather than sitting half off-screen
    // behind the question.
    expect(layer().style.transform).toBe('')
  })

  it('leaves the handle inert on every other edge', () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet isOpen onOpenChange={onOpenChange} placement="right">
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog aria-label="panel">
              <Sheet.Handle />
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>,
    )
    drag(100, 400, { gap: 400 })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(layer().style.transform).toBe('')
  })

  it('closes from the scrim, Escape and the close button when there is nothing to lose', async () => {
    const onOpenChange = vi.fn()
    const { unmount } = render(<Panel onOpenChange={onOpenChange} />)
    await click('Close panel')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(discard()).toBeNull()
    unmount()

    onOpenChange.mockClear()
    render(<Panel onOpenChange={onOpenChange} />)
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks before the close button loses unsaved work', async () => {
    const onOpenChange = vi.fn()
    render(<Panel isDirty onOpenChange={onOpenChange} />)

    await click('Close panel')
    expect(discard()).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()

    // Cancelling leaves the sheet exactly as it was — still open, still holding
    // whatever was typed.
    await click(i18n.t('common.cancel'))
    expect(discard()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'panel' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await click('Close panel')
    await click(i18n.t('sheet.discard.confirm'))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks before Escape loses unsaved work', async () => {
    const onOpenChange = vi.fn()
    render(<Panel isDirty onOpenChange={onOpenChange} />)
    await userEvent.keyboard('{Escape}')
    expect(discard()).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  /**
   * The back gesture is the one path that does not go through React Aria, and
   * the one where a refusal costs something: `settleTo` retires the level
   * *before* calling `dismiss`, so a sheet that says no is left open holding no
   * history entry, and the next press would leave the app entirely.
   */
  it('gives its history level back when a refused close is cancelled', async () => {
    installFakeHistory()
    useHistoryStore.setState({ enabled: true, levels: [] })
    const detach = attachHistory()
    try {
      const onOpenChange = vi.fn()
      render(<Panel isDirty onOpenChange={onOpenChange} />)
      await act(async () => {})
      expect(useHistoryStore.getState().levels).toHaveLength(1)

      await act(async () => {
        window.history.go(-1)
      })
      expect(discard()).not.toBeNull()
      expect(onOpenChange).not.toHaveBeenCalled()

      await click(i18n.t('common.cancel'))
      await act(async () => {})
      expect(screen.getByRole('dialog', { name: 'panel' })).toBeInTheDocument()
      expect(useHistoryStore.getState().levels).toHaveLength(1)
    } finally {
      detach()
      useHistoryStore.setState({ enabled: false, levels: [] })
      vi.unstubAllGlobals()
    }
  })

  it('answers the back gesture directly when there is nothing to lose', async () => {
    installFakeHistory()
    useHistoryStore.setState({ enabled: true, levels: [] })
    const detach = attachHistory()
    try {
      const onOpenChange = vi.fn()
      render(<Panel onOpenChange={onOpenChange} />)
      await act(async () => {})
      await act(async () => {
        window.history.go(-1)
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    } finally {
      detach()
      useHistoryStore.setState({ enabled: false, levels: [] })
      vi.unstubAllGlobals()
    }
  })
})
