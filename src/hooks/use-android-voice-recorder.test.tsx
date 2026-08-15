import { act, render } from '@testing-library/react'

import { useAndroidVoiceRecorder } from './use-android-voice-recorder'

vi.mock('@/api', () => ({
  api: {
    voicePrewarm: vi.fn(() => Promise.resolve()),
    voiceTranscribePcm: vi.fn(() => Promise.resolve({ status: 'ok', text: 'hello' })),
  },
}))

const capture = { beginCollecting: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
/** Resolved by hand, so a test can decide whether the device opened in time. */
let openResolve: ((h: typeof capture) => void) | null = null
vi.mock('@/lib/web-audio-capture', () => ({
  encodePcm16Base64: () => '',
  openCapture: vi.fn(() => new Promise((resolve) => { openResolve = resolve as never })),
}))

type Api = ReturnType<typeof useAndroidVoiceRecorder>

function mount(onTap = vi.fn(), onSend = vi.fn(), onNotice = vi.fn()) {
  const ref: { current: Api | null } = { current: null }
  function Probe() {
    ref.current = useAndroidVoiceRecorder({ onSend, onNotice, onTap })
    return null
  }
  render(<Probe />)
  return { ref, onTap, onSend, onNotice }
}

/** `setPointerCapture` does not exist in jsdom, and the hook calls it. */
const press = (api: Api, y = 0) => api.handlePointerDown({
  currentTarget: { setPointerCapture: () => {} },
  pointerId: 1,
  clientY: y,
} as unknown as React.PointerEvent)

describe('useAndroidVoiceRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    openResolve = null
    capture.beginCollecting.mockClear()
    capture.cancel.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  /**
   * The one that took Android typing away. `stateRef` is written from an effect,
   * so it trails the render — and opening the microphone, which the press also
   * kicks off, is what delays that render. A tap could therefore reach
   * `pointerup` with the state still reading `idle`, where the old guard
   * returned early: no cancel, no `onTap`, and a hold timer left armed that
   * started recording 300ms after the finger had gone.
   */
  it('hands a tap to the keyboard even when the state has not caught up', () => {
    const { ref, onTap } = mount()
    act(() => { press(ref.current!) })
    // Deliberately *not* flushing effects here: this is the state the race puts
    // the hook in.
    act(() => { ref.current!.handlePointerUp() })

    expect(onTap).toHaveBeenCalledTimes(1)

    // And the armed timer must not resurrect the press.
    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('idle')
    expect(ref.current!.isActive).toBe(false)
  })

  /**
   * The overlay is drawn for every state but `idle` and covers half the screen.
   * Announcing the press on the way down meant every reach for the keyboard
   * flashed "Preparing…" first.
   */
  it('says nothing until the press has lasted long enough to be a hold', async () => {
    const { ref } = mount()
    act(() => { press(ref.current!) })
    expect(ref.current!.isActive).toBe(false)

    await act(async () => { openResolve!(capture) })
    // The device is open, but the finger has not been down long enough.
    expect(ref.current!.isActive).toBe(false)
    expect(capture.beginCollecting).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('recording-hold')
  })

  /** The other order: held past the threshold before the device finished
   *  opening, which on the same phone has taken anywhere up to 2.6s. */
  it('waits on a slow microphone without losing the hold', async () => {
    const { ref } = mount()
    act(() => { press(ref.current!) })
    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('starting')

    await act(async () => { openResolve!(capture) })
    expect(ref.current!.state).toBe('recording-hold')
    expect(capture.beginCollecting).toHaveBeenCalled()
  })

  it('starts recording once the press outlasts the threshold', async () => {
    const { ref, onTap } = mount()
    act(() => { press(ref.current!) })
    await act(async () => { openResolve!(capture) })
    act(() => { vi.advanceTimersByTime(400) })

    expect(ref.current!.state).toBe('recording-hold')
    expect(onTap).not.toHaveBeenCalled()
    expect(capture.beginCollecting).toHaveBeenCalled()
  })

  /** Sliding up past the threshold arms the cancel; releasing there sends nothing. */
  it('throws the recording away when released after sliding up', async () => {
    const { ref, onSend } = mount()
    act(() => { press(ref.current!, 500) })
    await act(async () => { openResolve!(capture) })
    act(() => { vi.advanceTimersByTime(400) })
    act(() => { ref.current!.handlePointerMove({ clientY: 400 } as React.PointerEvent) })
    expect(ref.current!.state).toBe('cancelling')

    act(() => { ref.current!.handlePointerUp() })
    expect(ref.current!.state).toBe('idle')
    expect(onSend).not.toHaveBeenCalled()
    expect(capture.cancel).toHaveBeenCalled()
  })

  /** A second pointerdown with no release between must not open a second device. */
  it('ignores a press that arrives while one is already down', () => {
    const { ref } = mount()
    act(() => { press(ref.current!) })
    const first = openResolve
    act(() => { press(ref.current!) })
    expect(openResolve).toBe(first)
  })
})
