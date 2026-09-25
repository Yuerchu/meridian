import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { VoiceNotice } from '@/hooks/use-voice-recorder'
import { InputBar } from './input-bar'

const mocks = vi.hoisted(() => ({
  onNotice: null as ((notice: VoiceNotice, detail?: string) => void) | null,
}))

vi.mock('@/api', () => ({ api: {} }))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('@/hooks/use-voice-recorder', () => ({
  useVoiceRecorder: (options: { onNotice: (notice: VoiceNotice, detail?: string) => void }) => {
    mocks.onNotice = options.onNotice
    return {
      state: 'idle',
      elapsed: 0,
      handlePointerDown: vi.fn(),
      handlePointerUp: vi.fn(),
      handlePointerCancel: vi.fn(),
      handlePointerEnter: vi.fn(),
      handlePointerLeave: vi.fn(),
      handleKeyboardPress: vi.fn(),
    }
  },
}))
vi.mock('@/hooks/use-android-voice-recorder', () => ({
  useAndroidVoiceRecorder: () => ({ attachField: vi.fn(), isActive: false, cancel: vi.fn() }),
}))
vi.mock('./emoji-picker', () => ({ EmojiPicker: () => null }))
vi.mock('./composer-menu', () => ({ ComposerMenu: () => null }))

function renderBar() {
  return render(
    <InputBar
      conversationId={null}
      value=""
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      assistants={[]}
      providers={[]}
      currentAssistantId={null}
      currentModelId={null}
      currentProviderId={null}
      onSelectAssistant={vi.fn()}
      onSelectModel={vi.fn()}
      thinkingLevel="default"
      onSelectThinkingLevel={vi.fn()}
      fastMode={false}
      onToggleFast={vi.fn()}
      mode="work"
      onSelectMode={vi.fn()}
      acceptEdits={false}
      onToggleAcceptEdits={vi.fn()}
    />,
  )
}

/**
 * The composer's own notice line cleared itself after three seconds, which is
 * right for "too short" and is the "flash" for a failure: a recording that
 * could not start said why for three seconds and was gone.
 */
describe('composer notices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.onNotice = null
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a recording failure, with its reason, until it is dismissed', async () => {
    renderBar()
    act(() => mocks.onNotice?.('error', 'the microphone is in use by another application'))
    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('the microphone is in use by another application')

    await userEvent.click(within(alert).getByRole('button', { name: i18n.t('common.dismiss') }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still lets a hint go by itself', () => {
    renderBar()
    act(() => mocks.onNotice?.('too_short'))
    expect(screen.getByText(i18n.t('chat.voice.too_short'))).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3_500)
    })
    expect(screen.queryByText(i18n.t('chat.voice.too_short'))).toBeNull()
  })
})
