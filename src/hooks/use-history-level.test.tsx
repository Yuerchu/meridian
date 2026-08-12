import { render, act } from '@testing-library/react'
import { useState } from 'react'

import { attachHistory } from '@/lib/history-bridge'
import { ROOT } from '@/lib/nav'
import { useNavStore } from '@/stores/nav-store'
import { NavProvider, useHistoryLevel, type Nav } from './use-nav'

/**
 * Drives `useHistoryLevel` against a fake history.
 *
 * jsdom's `history.back()` is asynchronous and does not replay our state
 * payloads, so the real thing would need `waitFor` around every assertion and
 * still not exercise the depth handshake. Here `go(-n)` synchronously delivers
 * the popstate the browser would, which is the contract the hook is written
 * against.
 */
function installFakeHistory() {
  const entries: Array<{ __meridianDepth: number } | null> = [null]
  let index = 0

  const fake = {
    pushState(state: { __meridianDepth: number }) {
      entries.splice(index + 1)
      entries.push(state)
      index = entries.length - 1
    },
    go(delta: number) {
      const next = Math.max(0, Math.min(entries.length - 1, index + delta))
      if (next === index) return
      index = next
      // The browser moves the pointer first and announces afterwards; the
      // handler must see the destination, not the origin.
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] }))
    },
  }

  vi.stubGlobal('history', fake)
  return { fake, depthNow: () => entries[index]?.__meridianDepth ?? 0 }
}

const STACK_NAV: Nav = {
  mode: 'stack',
  top: ROOT,
  stack: [ROOT],
  canGoBack: false,
  push: () => {},
  replaceTop: () => {},
  back: () => {},
  popToRoot: () => {},
}

function Level({ open, onClose }: { open: boolean; onClose: () => void }) {
  useHistoryLevel(open, onClose)
  return null
}

function Harness({ initial = false, onClosed }: { initial?: boolean; onClosed?: () => void }) {
  const [open, setOpen] = useState(initial)
  return (
    <NavProvider value={STACK_NAV}>
      <button type="button" data-testid="open" onClick={() => setOpen(true)} />
      <button type="button" data-testid="close" onClick={() => setOpen(false)} />
      <Level open={open} onClose={() => { setOpen(false); onClosed?.() }} />
    </NavProvider>
  )
}

describe('useHistoryLevel', () => {
  let history: ReturnType<typeof installFakeHistory>

  let detach: () => void

  beforeEach(() => {
    useNavStore.setState({ stack: [ROOT], guards: [], depth: 0 })
    history = installFakeHistory()
    // The real bridge, so popstate → readDepth → settleTo is under test too.
    detach = attachHistory()
  })

  afterEach(() => {
    detach()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('claims a level while open and releases it when closed from React', async () => {
    const { getByTestId, unmount } = render(<Harness />)

    await act(async () => { getByTestId('open').click() })
    expect(useNavStore.getState().depth).toBe(1)

    await act(async () => { getByTestId('close').click() })
    expect(useNavStore.getState().depth).toBe(0)

    unmount()
  })

  it('does not re-enter onClose when React closed it', async () => {
    const onClosed = vi.fn()
    const { getByTestId, unmount } = render(<Harness onClosed={onClosed} />)

    await act(async () => { getByTestId('open').click() })
    await act(async () => { getByTestId('close').click() })

    // The guard is gone before goBack lands, so the popstate it causes finds
    // nothing to dismiss.
    expect(onClosed).not.toHaveBeenCalled()
    unmount()
  })

  it('closes through onClose when the back gesture takes the level', async () => {
    const onClosed = vi.fn()
    const { getByTestId, unmount } = render(<Harness onClosed={onClosed} />)

    await act(async () => { getByTestId('open').click() })
    expect(useNavStore.getState().depth).toBe(1)

    // The hardware key: the WebView steps back, then announces it.
    await act(async () => { history.fake.go(-1) })

    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(useNavStore.getState().depth).toBe(0)
    // The entry was consumed by the gesture itself; the effect that now sees
    // `open === false` must not step back a second time.
    expect(history.depthNow()).toBe(0)

    unmount()
  })

  it('releases the level on unmount without dismissing', async () => {
    const onClosed = vi.fn()
    const { getByTestId, unmount } = render(<Harness onClosed={onClosed} />)

    await act(async () => { getByTestId('open').click() })
    expect(useNavStore.getState().depth).toBe(1)

    unmount()

    expect(useNavStore.getState().guards).toHaveLength(0)
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('is inert without a stack, which is how the desktop and the tests run', async () => {
    function Panes() {
      const [open, setOpen] = useState(false)
      useHistoryLevel(open, () => setOpen(false))
      return <button type="button" data-testid="open" onClick={() => setOpen(true)} />
    }
    const { getByTestId, unmount } = render(<Panes />)

    await act(async () => { getByTestId('open').click() })

    expect(useNavStore.getState().depth).toBe(0)
    unmount()
  })
})
