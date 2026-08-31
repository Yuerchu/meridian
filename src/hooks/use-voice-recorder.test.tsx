import { act, render } from '@testing-library/react'

import { useVoiceRecorder } from './use-voice-recorder'

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve({ status: 'ok' as const, text: 'hello' })),
  cancel: vi.fn(() => Promise.resolve()),
  prewarm: vi.fn(() => Promise.resolve()),
  releasePrewarm: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/api', () => ({
  api: {
    voiceStartRecording: mocks.start,
    voiceStopAndTranscribe: mocks.stop,
    voiceCancelRecording: mocks.cancel,
    voicePrewarm: mocks.prewarm,
    voiceReleasePrewarm: mocks.releasePrewarm,
  },
}))

type Recorder = ReturnType<typeof useVoiceRecorder>

function mount() {
  const ref: { current: Recorder | null } = { current: null }
  const onSend = vi.fn()
  const onNotice = vi.fn()

  function Probe() {
    ref.current = useVoiceRecorder({ onSend, onNotice })
    return null
  }

  render(<Probe />)
  return { ref, onNotice, onSend }
}

describe('useVoiceRecorder keyboard controls', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses Enter or Space as start/stop toggle recording', async () => {
    const { ref, onSend } = mount()

    await act(async () => ref.current!.handleKeyboardPress())
    expect(ref.current!.state).toBe('recording-toggle')
    expect(mocks.start).toHaveBeenCalledTimes(1)

    await act(async () => ref.current!.handleKeyboardPress())
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(ref.current!.state).toBe('idle')
  })

  it('does not open a second microphone while the first one is starting', async () => {
    let resolveStart!: () => void
    mocks.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve
        }),
    )
    const { ref } = mount()

    let first!: Promise<void>
    act(() => {
      first = ref.current!.handleKeyboardPress()
    })
    expect(ref.current!.state).toBe('starting')

    let second!: Promise<void>
    act(() => {
      second = ref.current!.handleKeyboardPress()
    })
    expect(mocks.start).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveStart()
      await Promise.all([first, second])
    })
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })
})
