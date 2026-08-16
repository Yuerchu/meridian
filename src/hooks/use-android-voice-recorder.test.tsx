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

function mount(onSend = vi.fn(), onNotice = vi.fn()) {
  const ref: { current: Api | null } = { current: null }
  function Probe() {
    ref.current = useAndroidVoiceRecorder({ onSend, onNotice, enabled: true })
    return null
  }
  render(<Probe />)
  return { ref, onSend, onNotice }
}

/** jsdom has no `TouchEvent` constructor; the hook only reads `touches`. */
function touch(el: HTMLElement, type: string, y = 0) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', {
    value: type === 'touchend' ? [] : [{ clientY: y }],
  })
  el.dispatchEvent(e)
  return e
}

function field(api: Api) {
  const el = document.createElement('textarea')
  document.body.append(el)
  api.attachField(el)
  return el
}

describe('useAndroidVoiceRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    openResolve = null
    capture.beginCollecting.mockClear()
    capture.cancel.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  /**
   * The one that took Android typing away, and the reason the gesture is on the
   * field rather than over it.
   *
   * A tap's default action is dispatched after the handlers for the touch that
   * produced it, so anything the release does to focus is overwritten by where
   * the tap lands. The field's own tap is therefore the only thing that reliably
   * raises the keyboard — which means a short press must leave the touch alone.
   */
  it('leaves a short press to the platform, so the keyboard still opens', () => {
    const { ref } = mount()
    const el = field(ref.current!)

    act(() => { touch(el, 'touchstart') })
    let end!: Event
    act(() => { end = touch(el, 'touchend') })

    expect(end.defaultPrevented).toBe(false)
    expect(ref.current!.state).toBe('idle')
  })

  /** The other half: once it is a recording the touch must not also become a
   *  tap, or the field takes focus and the IME opens over the overlay. */
  it('cancels the touch of a press that became a recording', async () => {
    const { ref } = mount()
    const el = field(ref.current!)

    act(() => { touch(el, 'touchstart') })
    await act(async () => { openResolve!(capture) })
    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('recording-hold')

    let end!: Event
    act(() => { end = touch(el, 'touchend') })
    expect(end.defaultPrevented).toBe(true)
  })

  /** A finger on its way past the composer is not a press. */
  it('gives the gesture back when the finger travels before the hold commits', () => {
    const { ref } = mount()
    const el = field(ref.current!)

    act(() => { touch(el, 'touchstart', 100) })
    act(() => { touch(el, 'touchmove', 130) })
    // The armed timer must not promote a press that was abandoned.
    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('idle')
    expect(capture.beginCollecting).not.toHaveBeenCalled()
  })

  /**
   * `stateRef` is written from an effect, so it trails the render — and opening
   * the microphone, which the press also kicks off, is what delays that render.
   * A release could therefore arrive with the state still reading `idle`, where
   * the old guard returned early: no cancel, and a hold timer left armed that
   * started recording 300ms after the finger had gone.
   */
  it('does not resurrect a press that is already over', () => {
    const { ref } = mount()
    const el = field(ref.current!)
    act(() => { touch(el, 'touchstart') })
    // Deliberately *not* flushing effects here: this is the state the race puts
    // the hook in.
    act(() => { touch(el, 'touchend') })

    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('idle')
    expect(ref.current!.isActive).toBe(false)
    expect(capture.beginCollecting).not.toHaveBeenCalled()
  })

  /**
   * The overlay is drawn for every state but `idle` and covers half the screen.
   * Announcing the press on the way down meant every reach for the keyboard
   * flashed "Preparing…" first.
   */
  it('says nothing until the press has lasted long enough to be a hold', async () => {
    const { ref } = mount()
    const el = field(ref.current!)
    act(() => { touch(el, 'touchstart') })
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
    const el = field(ref.current!)
    act(() => { touch(el, 'touchstart') })
    act(() => { vi.advanceTimersByTime(400) })
    expect(ref.current!.state).toBe('starting')

    await act(async () => { openResolve!(capture) })
    expect(ref.current!.state).toBe('recording-hold')
    expect(capture.beginCollecting).toHaveBeenCalled()
  })

  /** Sliding up past the threshold arms the cancel; releasing there sends nothing. */
  it('throws the recording away when released after sliding up', async () => {
    const { ref, onSend } = mount()
    const el = field(ref.current!)
    act(() => { touch(el, 'touchstart', 500) })
    await act(async () => { openResolve!(capture) })
    act(() => { vi.advanceTimersByTime(400) })
    act(() => { touch(el, 'touchmove', 400) })
    expect(ref.current!.state).toBe('cancelling')

    act(() => { touch(el, 'touchend') })
    expect(ref.current!.state).toBe('idle')
    expect(onSend).not.toHaveBeenCalled()
    expect(capture.cancel).toHaveBeenCalled()
  })

  /** Rebinding must not leave the old listeners behind: two live bindings would
   *  open two devices for one finger. */
  it('drops the previous binding when the field is replaced', () => {
    const { ref } = mount()
    const first = field(ref.current!)
    field(ref.current!)

    act(() => { touch(first, 'touchstart') })
    expect(openResolve).toBe(null)
  })

  /** The gesture stands down as soon as there is text: then the field has
   *  something to select, and a hold belongs to the platform again. */
  it('ignores a hold while disabled', () => {
    const ref: { current: Api | null } = { current: null }
    function Probe() {
      ref.current = useAndroidVoiceRecorder({
        onSend: vi.fn(), onNotice: vi.fn(), enabled: false,
      })
      return null
    }
    render(<Probe />)
    const el = field(ref.current!)

    let end!: Event
    act(() => { touch(el, 'touchstart') })
    act(() => { vi.advanceTimersByTime(400) })
    act(() => { end = touch(el, 'touchend') })

    expect(ref.current!.state).toBe('idle')
    expect(openResolve).toBe(null)
    expect(end.defaultPrevented).toBe(false)
  })
})
