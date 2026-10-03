import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { VoiceNotice } from '@/hooks/use-voice-recorder'
import type { ComponentProps } from 'react'
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

function renderBar(props: Partial<ComponentProps<typeof InputBar>> = {}) {
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
      {...props}
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

/**
 * Cut used to delete the selection and write it to the clipboard in the same
 * breath, without waiting for the write: a refused write lost the text from
 * both places.
 */
describe('composer cut', () => {
  afterEach(() => vi.restoreAllMocks())

  function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }

  async function cutWorld(user: ReturnType<typeof userEvent.setup>) {
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    // The menu offers Cut only over a selection, which it reads off the window
    // as the WebView reports it; jsdom reports none for a textarea.
    const real = window.getSelection.bind(window)
    vi.spyOn(window, 'getSelection').mockImplementation(() => {
      const selection = real()
      if (selection) selection.toString = () => 'world'
      return selection
    })
    await user.pointer({ keys: '[MouseRight]', target: field })
    // Selected after the press, which puts the caret where it landed.
    field.setSelectionRange(6, 11)
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${i18n.t('contextMenu.cut')}`) }))
  }

  it('keeps the text when the clipboard refuses it, and says why', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new Error('Document is not focused.')))
    const onChange = vi.fn()
    renderBar({ value: 'hello world', onChange })

    await cutWorld(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Document is not focused.')
    expect(onChange).not.toHaveBeenCalled()
  })

  // The refusal used to share the composer's error slot, which only the
  // dismiss button cleared: after a retry worked it still said the cut failed.
  it('takes the refusal away once a retry succeeds', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValueOnce(new Error('Document is not focused.')).mockResolvedValue(undefined))
    renderBar({ value: 'hello world', onChange: vi.fn() })

    await cutWorld(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Document is not focused.')

    vi.restoreAllMocks()
    await cutWorld(user)
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  // A slow refusal from an earlier copy must not come back over a later one
  // that worked.
  it('lets only the latest copy say how it went', async () => {
    const user = userEvent.setup()
    let refuseFirst!: (reason: Error) => void
    stubClipboard(
      vi
        .fn()
        .mockImplementationOnce(() => new Promise((_, reject) => (refuseFirst = reject)))
        .mockResolvedValue(undefined),
    )
    renderBar({ value: 'hello world', onChange: vi.fn() })
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    const copy = async () => {
      vi.spyOn(window, 'getSelection').mockImplementation(() => ({ toString: () => 'world' }) as Selection)
      await user.pointer({ keys: '[MouseRight]', target: field })
      field.setSelectionRange(6, 11)
      await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${i18n.t('chat.copy')}`) }))
      vi.restoreAllMocks()
    }

    await copy()
    await copy()
    refuseFirst(new Error('Document is not focused.'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes the text once the clipboard has it', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const onChange = vi.fn()
    renderBar({ value: 'hello world', onChange })

    await cutWorld(user)

    expect(writeText).toHaveBeenCalledWith('world')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('hello '))
  })
})

/**
 * Chips were keyed by index: removing the first gave the second the first's
 * element, so its thumbnail reloaded and a focused remove button now belonged
 * to another file.
 */
describe('composer attachments', () => {
  it('keeps the element of every chip that stays when one before it is removed', () => {
    const first = { name: 'first.txt' }
    const second = { name: 'second.txt' }
    const { rerender } = renderBar({ attachedFiles: [first, second], onRemoveFile: vi.fn() })
    const chip = (name: string) => screen.getByText(name).closest('[data-slot="chat-attachment"]')
    const before = chip('second.txt')

    rerender(
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
        attachedFiles={[second]}
        onRemoveFile={vi.fn()}
      />,
    )

    expect(before).not.toBeNull()
    expect(chip('second.txt')).toBe(before)
  })
})
