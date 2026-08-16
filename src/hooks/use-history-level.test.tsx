import { render, act } from '@testing-library/react'
import { useState } from 'react'

import { attachHistory } from '@/lib/history-bridge'
import { useHistoryStore } from '@/stores/history-store'
import { useHistoryLevel } from './use-history-level'

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

function Level({ open, onClose }: { open: boolean; onClose: () => void }) {
  useHistoryLevel(open, onClose)
  return null
}

function Harness({ initial = false, onClosed }: { initial?: boolean; onClosed?: () => void }) {
  const [open, setOpen] = useState(initial)
  return (
    <>
      <button type="button" data-testid="open" onClick={() => setOpen(true)} />
      <button type="button" data-testid="close" onClick={() => setOpen(false)} />
      <Level open={open} onClose={() => { setOpen(false); onClosed?.() }} />
    </>
  )
}

const depth = () => useHistoryStore.getState().levels.length

describe('useHistoryLevel', () => {
  let history: ReturnType<typeof installFakeHistory>

  let detach: () => void

  beforeEach(() => {
    // What `useBackGesture` does on a device that has a back gesture. Without
    // it every level below is a no-op, which is the last case in this file.
    useHistoryStore.setState({ enabled: true, levels: [] })
    history = installFakeHistory()
    // The real bridge, so popstate → readDepth → settleTo is under test too.
    detach = attachHistory()
  })

  afterEach(() => {
    detach()
    useHistoryStore.setState({ enabled: false, levels: [] })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('claims a level while open and releases it when closed from React', async () => {
    const { getByTestId, unmount } = render(<Harness />)

    await act(async () => { getByTestId('open').click() })
    expect(depth()).toBe(1)

    await act(async () => { getByTestId('close').click() })
    expect(depth()).toBe(0)

    unmount()
  })

  it('does not re-enter onClose when React closed it', async () => {
    const onClosed = vi.fn()
    const { getByTestId, unmount } = render(<Harness onClosed={onClosed} />)

    await act(async () => { getByTestId('open').click() })
    await act(async () => { getByTestId('close').click() })

    // The level is gone before goBack lands, so the popstate it causes finds
    // nothing to dismiss.
    expect(onClosed).not.toHaveBeenCalled()
    unmount()
  })

  it('closes through onClose when the back gesture takes the level', async () => {
    const onClosed = vi.fn()
    const { getByTestId, unmount } = render(<Harness onClosed={onClosed} />)

    await act(async () => { getByTestId('open').click() })
    expect(depth()).toBe(1)

    // The hardware key: the WebView steps back, then announces it.
    await act(async () => { history.fake.go(-1) })

    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(depth()).toBe(0)
    // The entry was consumed by the gesture itself; the effect that now sees
    // `open === false` must not step back a second time.
    expect(history.depthNow()).toBe(0)

    unmount()
  })

  it('uses the latest close callback without pushing another history level', async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender, unmount } = render(<Level open onClose={first} />)
    expect(depth()).toBe(1)

    rerender(<Level open onClose={latest} />)
    expect(depth()).toBe(1)

    await act(async () => { history.fake.go(-1) })

    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('releases the level on unmount without dismissing', async () => {
    const onClosed = vi.fn()
    const { getByTestId, unmount } = render(<Harness onClosed={onClosed} />)

    await act(async () => { getByTestId('open').click() })
    expect(depth()).toBe(1)

    unmount()

    expect(useHistoryStore.getState().levels).toHaveLength(0)
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('unwinds nested levels innermost first, in one popstate', async () => {
    const order: string[] = []
    function Nested() {
      const [outer, setOuter] = useState(false)
      const [inner, setInner] = useState(false)
      useHistoryLevel(outer, () => { order.push('outer'); setOuter(false) })
      useHistoryLevel(inner, () => { order.push('inner'); setInner(false) })
      return (
        <>
          <button type="button" data-testid="outer" onClick={() => setOuter(true)} />
          <button type="button" data-testid="inner" onClick={() => setInner(true)} />
        </>
      )
    }
    const { getByTestId, unmount } = render(<Nested />)

    await act(async () => { getByTestId('outer').click() })
    await act(async () => { getByTestId('inner').click() })
    expect(depth()).toBe(2)

    // One gesture, two entries: `go(-2)` is a single popstate carrying an
    // absolute depth, which is why `settleTo` reads a target rather than a step.
    await act(async () => { history.fake.go(-2) })

    expect(order).toEqual(['inner', 'outer'])
    expect(depth()).toBe(0)
    unmount()
  })

  it('is inert where the gesture is not ours, which is every desktop and every test', async () => {
    useHistoryStore.setState({ enabled: false, levels: [] })

    function Panes() {
      const [open, setOpen] = useState(false)
      useHistoryLevel(open, () => setOpen(false))
      return <button type="button" data-testid="open" onClick={() => setOpen(true)} />
    }
    const { getByTestId, unmount } = render(<Panes />)

    await act(async () => { getByTestId('open').click() })

    expect(depth()).toBe(0)
    unmount()
  })
})
