import { render, screen, act } from '@testing-library/react'
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
