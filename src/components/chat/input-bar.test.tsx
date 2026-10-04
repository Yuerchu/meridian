import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
    const chip = (name: string) => screen.getByText(name).closest('[data-slot="attachment-tile"]')
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

/**
 * Wrapped, ten files on a phone stacked two to a row and pushed the composer
 * several hundred pixels into the transcript. jsdom has no layout, so this
 * pins the classes; measured in Chromium at 390px, ten chips keep one 42px row
 * and scroll 1588px of content inside 326px — and without the wrapper's
 * `w-full min-w-0` the wrapper grows to the row's full 1174px and spills out.
 */
describe('composer attachment row', () => {
  it('keeps the attachments in one row that scrolls sideways', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ name: `file-${i}.png` }))
    const { container } = renderBar({ attachedFiles: files, onRemoveFile: vi.fn() })

    const wrapper = container.querySelector('[data-slot="composer-attachments"]')
    const group = container.querySelector('[data-slot="attachment-tiles"]')
    expect(wrapper?.className.split(' ')).toEqual(expect.arrayContaining(['w-full', 'min-w-0']))
    expect(group?.className.split(' ')).toEqual(expect.arrayContaining(['flex-nowrap', 'overflow-x-auto', 'min-w-0']))
    expect(group?.className.split(' ')).not.toContain('flex-wrap')
  })
})

/**
 * In a row that scrolls, files added to a full strip landed past its right
 * edge with nothing to say they had been attached.
 */
describe('composer attachment row, adding and removing', () => {
  const base = {
    conversationId: null,
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    assistants: [],
    providers: [],
    currentAssistantId: null,
    currentModelId: null,
    currentProviderId: null,
    onSelectAssistant: vi.fn(),
    onSelectModel: vi.fn(),
    thinkingLevel: 'default',
    onSelectThinkingLevel: vi.fn(),
    fastMode: false,
    onToggleFast: vi.fn(),
    mode: 'work',
    onSelectMode: vi.fn(),
    acceptEdits: false,
    onToggleAcceptEdits: vi.fn(),
    onRemoveFile: vi.fn(),
  } satisfies Omit<ComponentProps<typeof InputBar>, 'attachedFiles'>
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `file-${i}.png` }))

  function laidOutRow(container: HTMLElement) {
    const row = container.querySelector('[data-slot="attachment-tiles"]') as HTMLElement
    Object.defineProperty(row, 'scrollWidth', { value: 1000, configurable: true })
    return row
  }

  it('shows the files just added, wherever the row was scrolled', () => {
    const { container, rerender } = render(<InputBar {...base} attachedFiles={files.slice(0, 2)} />)
    const row = laidOutRow(container)
    row.scrollLeft = 0

    rerender(<InputBar {...base} attachedFiles={files.slice(0, 3)} />)

    expect(row.scrollLeft).toBe(1000)
  })

  it('leaves the reader where they were when one is removed', () => {
    const { container, rerender } = render(<InputBar {...base} attachedFiles={files} />)
    const row = laidOutRow(container)
    row.scrollLeft = 200

    rerender(<InputBar {...base} attachedFiles={files.slice(1)} />)

    expect(row.scrollLeft).toBe(200)
  })
})

describe('InputBar paste', () => {
  const shot = () => new File([new Uint8Array(4)], 'image.png', { type: 'image/png' })
  const clipboard = (text: string, files: File[]) =>
    ({
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    }) as unknown as DataTransfer
  // The field's role is combobox (it owns the typeahead), so found by tag.
  const field = () => document.querySelector('textarea')!

  it('attaches a pasted screenshot instead of pasting nothing', () => {
    const onAttachFiles = vi.fn()
    renderBar({ onAttachFiles })
    const file = shot()

    const kept = fireEvent.paste(field(), { clipboardData: clipboard('', [file]) })

    expect(onAttachFiles).toHaveBeenCalledWith([{ name: 'image.png', file }])
    expect(kept).toBe(false)
  })

  it('pastes copied cells as text, not as the picture Office puts beside them', () => {
    const onAttachFiles = vi.fn()
    renderBar({ onAttachFiles })

    const kept = fireEvent.paste(field(), { clipboardData: clipboard('a\tb', [shot()]) })

    expect(onAttachFiles).not.toHaveBeenCalled()
    expect(kept).toBe(true)
  })

  it('attaches nothing to a hosted session', () => {
    const onAttachFiles = vi.fn()
    renderBar({ onAttachFiles, isHosted: true })

    fireEvent.paste(field(), { clipboardData: clipboard('', [shot()]) })

    expect(onAttachFiles).not.toHaveBeenCalled()
  })
})

describe('InputBar paste from its own menu', () => {
  afterEach(() => vi.restoreAllMocks())

  const png = () => new Blob([new Uint8Array(4)], { type: 'image/png' })
  function stubRead(items: Array<Record<string, Blob>>, readText?: () => Promise<string>) {
    const read = vi
      .fn()
      .mockResolvedValue(
        items.map((parts) => ({ types: Object.keys(parts), getType: (type: string) => Promise.resolve(parts[type]) })),
      )
    Object.defineProperty(navigator, 'clipboard', { value: { read, readText }, configurable: true })
    return read
  }
  async function pasteFromMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.pointer({ keys: '[MouseRight]', target: document.querySelector('textarea')! })
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${i18n.t('contextMenu.paste')}`) }))
  }

  it('attaches a screenshot the menu pastes, as Ctrl+V does', async () => {
    const user = userEvent.setup()
    stubRead([{ 'image/png': png() }])
    const onAttachFiles = vi.fn()
    const onChange = vi.fn()
    renderBar({ onAttachFiles, onChange })

    await pasteFromMenu(user)

    await vi.waitFor(() => expect(onAttachFiles).toHaveBeenCalledTimes(1))
    expect(onAttachFiles.mock.calls[0][0][0].file.type).toBe('image/png')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('pastes text when the clipboard has text beside the picture', async () => {
    const user = userEvent.setup()
    stubRead([{ 'text/plain': new Blob(['a\tb']), 'image/png': png() }])
    const onAttachFiles = vi.fn()
    const onChange = vi.fn()
    renderBar({ onAttachFiles, onChange })

    await pasteFromMenu(user)

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('a\tb'))
    expect(onAttachFiles).not.toHaveBeenCalled()
  })

  it('clears a failed menu paste once a pasted file goes through', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      value: { read: vi.fn().mockRejectedValue(new Error('Read permission denied.')) },
      configurable: true,
    })
    renderBar({ onAttachFiles: vi.fn() })
    await pasteFromMenu(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Read permission denied.')

    const file = new File([new Uint8Array(4)], 'image.png', { type: 'image/png' })
    fireEvent.paste(document.querySelector('textarea')!, {
      clipboardData: {
        getData: () => '',
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      } as unknown as DataTransfer,
    })
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('composer status tab', () => {
  const todos = {
    title: 'Ship it',
    todos: [
      { content: 'Build', active_form: 'Building', status: 'completed' as const },
      { content: 'Test', active_form: 'Testing', status: 'in_progress' as const },
    ],
  }
  const ready = {
    status: 'ready' as const,
    retry: () => {},
    reading: {
      messageCount: 3,
      estimatedTokens: 41_000,
      contextLimit: 100_000,
      autoCompactEnabled: false,
      autoCompactThreshold: 0,
      compactBreaker: 'closed' as const,
      model: 'm1',
      agentKind: null,
    },
  }
  const tab = () => screen.queryByRole('group', { name: i18n.t('composer.status') })

  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('is absent with no checklist and no reading', () => {
    renderBar()
    expect(tab()).toBeNull()
  })

  it('carries the checklist chip and the context reading', () => {
    renderBar({ todos, contextInfo: ready })
    const group = tab()!
    expect(within(group).getByRole('button', { name: /Ship it, 1\/2, Testing/ })).toBeInTheDocument()
    expect(within(group).getByText('41%')).toBeInTheDocument()
  })

  it('keeps the tab while the first reading is on its way, so it does not push the transcript up later', () => {
    renderBar({ contextInfo: { status: 'loading', retry: () => {} } })
    expect(tab()).not.toBeNull()
  })

  it('does not wait on a hosted agent, which reports whenever it likes', () => {
    renderBar({ isHosted: true, contextInfo: { status: 'loading', retry: () => {} } })
    expect(tab()).toBeNull()
  })

  it('takes the reading out of the toolbar', () => {
    const { container } = renderBar({ contextInfo: ready })
    const toolbar = container.querySelector('[data-slot="prompt-input-toolbar"]')!
    expect(within(toolbar as HTMLElement).queryByText('41%')).toBeNull()
    expect(toolbar.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('offers no choice of delivery while a turn runs: a queued message waits', () => {
    const { container } = renderBar({ streaming: true, queueing: true })
    expect(container.querySelector('[data-slot="toolbar-select"]')).toBeNull()
  })
})
