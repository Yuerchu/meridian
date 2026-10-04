import { useState, useRef, useCallback, useEffect, useId, useLayoutEffect, useMemo } from 'react'
import { mergeRefs } from '@react-aria/utils'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowInDownDashedPanel, Copy, CursorText, Scissors, X } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { Button, Kbd, Label, Tooltip, TooltipTrigger } from '@/components/base'
import { ContextMenu } from '@/components/base'

import { can } from '@/lib/capabilities'
import { isRemote } from '@/lib/transport'
import type { Attachment } from '@/lib/upload'
import { isCoarsePointer } from '@/hooks/use-coarse-pointer'
import { useIsOffline } from '@/hooks/use-connection-state'
import { useVoiceRecorder, type VoiceNotice } from '@/hooks/use-voice-recorder'
import { useAndroidVoiceRecorder } from '@/hooks/use-android-voice-recorder'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useHorizontalWheel } from '@/hooks/use-horizontal-wheel'
import { suggestionOptionId, useComposerTypeahead } from '@/hooks/use-composer-typeahead'
import { FileInput, type FileInputHandle } from '@/components/ui/file-input'
import { VoiceButton } from '@/components/ui/voice-button'
import { ErrorAlert } from '@/components/ui/error-alert'
import { errorMessage } from '@/lib/error-message'
import { readClipboardContent, writeClipboard, type ClipboardContent } from '@/lib/clipboard'
import { pickPasted } from '@/lib/paste-files'
import { Composer } from './composer'
import { AttachmentTiles } from './attachment-tiles'
import { ComposerSuggestions, type ComposerSuggestion } from './composer-suggestions'
import { VoiceOverlay } from './voice-overlay'
import { AttachSheet } from './attach-sheet'
import { ComposerMenu } from './composer-menu'
import { HostedModelPanel, ModelPanel } from './model-panel'
import { EmojiPicker } from './emoji-picker'
import { ContextGauge, hasContextReading } from './context-gauge'
import { ComposerStatusTab } from './composer-status-tab'
import { TodoProgressChip } from './todo-progress-chip'
import type { TodoArgs } from './todo-list'
import type { ContextInfo } from '@/hooks/use-context-info'
import { isSelect, useAcpConfig } from '@/hooks/use-acp-config'
import { currentValueName, isEffortKnob, isModeKnob, isModelKnob } from '@/lib/acp-knob-names'
import { HostedModeChip, ModeChip } from './mode-chip'
import type {
  AssistantInfoResponse,
  ChatMode,
  EmojiInfoResponse,
  ProviderInfoResponse,
  ProviderCapabilitiesInfoResponse,
  ThinkingLevel,
} from '@/types'

/**
 * One file the composer is holding, named either by a path on the machine that
 * will read it or by the bytes themselves. See `lib/upload.ts` for which is
 * which and why.
 */
export type AttachedFile = Attachment

export interface PendingSticker {
  emoji: EmojiInfoResponse
  url: string
}

interface InputBarProps {
  /** Which conversation this composer belongs to. Needed because a hosted
   *  session's model and mode are the *agent's* to report, per session, rather
   *  than this app's settings. */
  conversationId: string | null
  /** Project selected before the first conversation exists, for @ completion. */
  workspaceProjectId?: string | null
  /** Removes the docked safe-area padding when the same composer is embedded
   * in the centred welcome state. All controls and behaviour stay identical. */
  embedded?: boolean
  /** A hosted Claude Code session, whose knobs come over ACP. */
  isHosted?: boolean
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Send transcribed speech directly, bypassing the textarea. */
  onVoiceSend?: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  /** The initial conversation is being created from this composer. */
  pending?: boolean
  streaming?: boolean
  /**
   * This conversation is a delegated run that can be talked to mid-flight.
   *
   * Enter submits while the answer is still coming, and a Stop of its own
   * appears beside Send. The tool menu goes away with it: what it holds — the
   * model, the mode, the standing yes, the attachments — describes a turn about
   * to start, and steering starts none.
   */
  steerable?: boolean
  /**
   * Enter stacks the message up instead of sending it.
   *
   * A turn is running in a conversation that is not a delegated run. Like
   * `steerable` in that the field stays live and a Stop of its own appears,
   * and unlike it in what happens next: steering goes straight into the run,
   * while this is written down and delivered once the turn ends. A queued
   * message always waits; turning one into an interjection is done on its row
   * in the queue, after it exists, rather than decided here beforehand.
   */
  queueing?: boolean
  /** The rows themselves, above the shell. */
  queue?: React.ReactNode
  /** The running checklist, for the status tab's progress chip. */
  todos?: TodoArgs | null
  attachedFiles?: AttachedFile[]
  onAttachFiles?: (files: AttachedFile[]) => void
  onRemoveFile?: (index: number) => void
  /** The files in their new order, after a tile was moved. Absent, they stay put. */
  onReorderFiles?: (next: AttachedFile[]) => void
  pendingSticker?: PendingSticker | null
  onSelectSticker?: (sticker: PendingSticker) => void
  onRemoveSticker?: () => void
  assistants: AssistantInfoResponse[]
  providers: ProviderInfoResponse[]
  currentAssistantId: string | null
  currentModelId: string | null
  currentProviderId: string | null
  onSelectAssistant: (id: string) => void
  onSelectModel: (modelId: string, providerId: string) => void
  thinkingLevel: ThinkingLevel
  onSelectThinkingLevel: (level: ThinkingLevel) => void
  fastMode: boolean
  onToggleFast: (next: boolean) => void
  mode: ChatMode
  onSelectMode: (mode: ChatMode) => void
  acceptEdits: boolean
  onToggleAcceptEdits: (next: boolean) => void
  capabilities?: ProviderCapabilitiesInfoResponse | null
  contextInfo?: ContextInfo
  compacting?: boolean
  onCompact?: () => void
}

/**
 * Wraps the composer in our own menu on a mouse, and steps aside on a touch
 * screen.
 *
 * Ours is the worse menu there in three separate ways: it opens wherever the
 * finger landed rather than beside the caret, it captions its items with
 * Ctrl+V, and opening it takes focus off the textarea — which dismisses the
 * keyboard and staleds the `selectionStart` that Paste inserts at. The
 * platform's own long-press menu has none of those problems and custom ROMs
 * add clipboard history and translation to it, so let the WebView have it.
 */
function ComposerContextMenu({
  enabled,
  label,
  onOpenChange,
  items,
  children,
}: {
  enabled: boolean
  /** Names the menu for a screen reader. */
  label: string
  onOpenChange: (open: boolean) => void
  items: React.ReactNode
  children: React.ReactNode
}) {
  if (!enabled) return children
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      {/* ContextMenu.Trigger renders a plain div when given no `render` prop;
          `w-full` is what makes it span a full-width field. */}
      <ContextMenu.Trigger className="block w-full">{children}</ContextMenu.Trigger>
      <ContextMenu.Popover>
        <ContextMenu.Menu aria-label={label}>{items}</ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  )
}

function Shortcut({ keys }: { keys: string }) {
  return <Kbd className="ms-auto">{keys}</Kbd>
}

export function InputBar({
  conversationId,
  workspaceProjectId,
  embedded,
  isHosted,
  value,
  onChange,
  onSubmit,
  onVoiceSend: onVoiceSendProp,
  onStop,
  disabled,
  pending,
  streaming,
  steerable,
  queueing,
  queue,
  todos,
  assistants,
  providers,
  currentAssistantId,
  currentModelId,
  currentProviderId,
  onSelectAssistant,
  onSelectModel,
  thinkingLevel,
  onSelectThinkingLevel,
  fastMode,
  onToggleFast,
  mode,
  onSelectMode,
  acceptEdits,
  onToggleAcceptEdits,
  capabilities,
  contextInfo,
  compacting,
  onCompact,
  attachedFiles = [],
  onAttachFiles,
  onRemoveFile,
  onReorderFiles,
  pendingSticker,
  onSelectSticker,
  onRemoveSticker,
}: InputBarProps) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const isAndroid = platform === 'android'
  const [caret, setCaret] = useState(value.length)
  // One subscription for the whole composer. The knobs and the context gauge
  // both read the hosted session's state, and two calls would mean two fetches
  // and two listeners answering the same events.
  const acp = useAcpConfig(conversationId ?? '', !!isHosted && conversationId !== null)
  // Which model the *agent* says is answering, for the gauge to name. Not
  // `contextInfo.model`, which is this app's assistant and has nothing to do
  // with a hosted turn.
  const hostedModel = (() => {
    const model = acp.options.find((o) => o.id === 'model' || o.category === 'model')
    return model ? currentValueName(t, model) : null
  })()
  const supportsFast = isHosted
    ? acp.options.some((option) => option.id === 'fast')
    : capabilities?.supports_fast === true
  const typeahead = useComposerTypeahead({
    value,
    caret,
    conversationId,
    projectId: workspaceProjectId,
    isHosted: !!isHosted,
    supportsFast,
    providerId: currentProviderId,
    capabilities: capabilities ?? null,
    acpOptions: acp.options,
    platform,
  })
  // A message sent to a machine that is not answering fails, and a field that
  // looks live while that is true is a lie the user only finds out about after
  // typing. This is the one connection state the composer has to care about.
  const offline = useIsOffline()
  const fileInputRef = useRef<FileInputHandle>(null)
  // The sticker picker opens from the `+` menu (or the phone's sheet) and
  // hangs from that button once the menu has gone.
  const plusRef = useRef<HTMLButtonElement>(null)
  const [stickersOpen, setStickersOpen] = useState(false)
  // A sticker travels the way an attachment does — as a part in a JSON array —
  // and would reach a hosted agent as that JSON. See `onPickFile` below.
  const offersStickers = !isHosted && !!currentAssistantId && !!onSelectSticker
  // A hosted session's knobs, by where each is drawn: the model and the
  // effort in the model panel, the permission mode as the mode chip, anything
  // else in the `+` menu. A select with nothing in it is not offered: the
  // agent has said a knob exists without saying what it accepts.
  const knobs = acp.options.filter((o) => isSelect(o) && o.options.length > 0)
  const modelKnob = knobs.find(isModelKnob)
  const effortKnob = knobs.find(isEffortKnob)
  const modeKnob = knobs.find(isModeKnob)
  const otherKnobs = knobs.filter((o) => o !== modelKnob && o !== effortKnob && o !== modeKnob)
  // A refusal leaves the set as it was, which is already what is on screen;
  // the reason is kept by `useAcpConfig` and drawn above the composer.
  const setKnob = (id: string, value: string) => void acp.set(id, value).catch(() => undefined)
  const modeChip = isHosted ? (
    modeKnob ? (
      <HostedModeChip
        option={modeKnob}
        busy={acp.busy}
        // A refusal is drawn above the composer by `useAcpConfig`.
        onSelect={(value) => setKnob(modeKnob.id, value)}
      />
    ) : null
  ) : (
    <ModeChip
      mode={mode}
      acceptEdits={acceptEdits}
      onSelectMode={onSelectMode}
      onToggleAcceptEdits={onToggleAcceptEdits}
    />
  )
  const stickerPicker = offersStickers ? (
    <EmojiPicker
      assistantId={currentAssistantId}
      anchorRef={plusRef}
      isOpen={stickersOpen}
      onOpenChange={setStickersOpen}
      onSelect={(sticker) => onSelectSticker?.(sticker)}
    />
  ) : null
  /**
   * Voice is not offered at all when it cannot work, rather than offered and
   * refused.
   *
   * `voice_start_recording` runs wherever the backend is, so connected to
   * another machine the button would open *that* machine's microphone and
   * transcribe the room it is sitting in. There is no version of that worth
   * drawing disabled with an explanation: a microphone is hardware, and a
   * device that does not have one does not show a button for it.
   */
  const onVoiceSend = can.voiceInput ? onVoiceSendProp : undefined
  // Filled by Composer once the field exists: PromptInput.TextArea spreads
  // incoming props after its own ref, so one passed down would displace theirs.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentWheel = useHorizontalWheel<HTMLDivElement>()
  const attachmentRowElement = useRef<HTMLDivElement | null>(null)
  const attachmentRow = useMemo(() => mergeRefs(attachmentWheel, attachmentRowElement), [attachmentWheel])
  // Files just added are shown, wherever the row was scrolled: in a row that
  // scrolls, they land past its right edge, and nothing said they had been
  // attached — which reads as the picker having failed, and invites a second
  // pick. Only on growth; a removal leaves the reader where they were.
  const attachedCount = attachedFiles.length
  const shownAttachments = useRef(attachedCount)
  useLayoutEffect(() => {
    const row = attachmentRowElement.current
    if (row && attachedCount > shownAttachments.current) row.scrollLeft = row.scrollWidth
    shownAttachments.current = attachedCount
  }, [attachedCount])
  const suggestionsId = useId()
  const [selectedText, setSelectedText] = useState('')

  // Transient one-line hint above the composer ("too short", "nothing heard").
  // Only hints: a hint that clears itself after three seconds is fine, a
  // failure that does is the "flash" — gone before anybody could read it.
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  // What went wrong in the composer itself — recording, a picker, the hosted
  // agent's knobs — kept until the reader dismisses it.
  const [composerError, setComposerError] = useState<string | null>(null)
  // A refused cut, copy or paste. Its own slot so that the next one that
  // succeeds can clear it without taking an unrelated composer error with it;
  // in `composerError` a refusal stayed on screen after a retry had worked.
  const [clipboardError, setClipboardError] = useState<string | null>(null)
  // Only the newest cut, copy or paste may set or clear it: a slow refusal
  // from an earlier one must not come back over a later success.
  const latestClipboardAttempt = useRef(0)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showHint = useCallback((text: string) => {
    setVoiceNotice(text)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setVoiceNotice(null), 3000)
  }, [])
  const showVoiceNotice = useCallback(
    (notice: VoiceNotice, detail?: string) => {
      if (notice === 'error' || notice === 'model_missing') {
        setComposerError(notice === 'error' && detail ? detail : t(`chat.voice.${notice}`))
        return
      }
      showHint(t(`chat.voice.${notice}`))
    },
    [showHint, t],
  )
  const voice = useVoiceRecorder({
    onSend: (text) => onVoiceSend?.(text),
    onNotice: showVoiceNotice,
  })
  // Hold-to-talk, on the field itself. Both recorder hooks are called
  // unconditionally — hooks cannot be conditional — but only one is ever
  // reachable: this one is Android's, `VoiceButton` is the desktop's.
  //
  // Only while the field is empty: then it has nothing to select and nothing to
  // scroll, which is what leaves a hold free to mean something else. The moment
  // there is text the gesture stands down and the field is only a field.
  const voicePress = Boolean(isAndroid && onVoiceSend && !value && !disabled && !streaming)
  const androidVoice = useAndroidVoiceRecorder({
    onSend: (text) => onVoiceSend?.(text),
    onNotice: showVoiceNotice,
    enabled: voicePress,
  })
  const { attachField } = androidVoice
  // The back gesture cancels a recording instead of leaving the screen. Only
  // while capturing: transcription is over in well under a second, and a
  // history entry that brief is worse than none.
  useHistoryLevel(androidVoice.isActive, androidVoice.cancel)

  useEffect(() => {
    // Not on a touch screen, where focus summons the keyboard over half the
    // display. ChatView is keyed by conversation id, so this runs again on
    // every switch — landing in a conversation to read it would cost the
    // keyboard each time.
    if (isCoarsePointer()) return
    textareaRef.current?.focus()
  }, [])

  // A pinyin or kana candidate lives in the textarea before it has been chosen.
  // Enter is already guarded by `isSubmitKey`, but on a phone the send button is
  // what gets pressed, and it sits next to the candidate bar.
  // Composer holds Enter back mid-composition and disables Send on an empty
  // field; what stays here is the caller's own precondition.
  // `disabled` is `streaming` at the call site, and the same two words mean two
  // different things: the field is live while a reply comes in, and only Send
  // turns into Stop. So this has to make the same exception `Composer` makes for
  // its own `disabled` a few lines down — read literally it refuses every
  // submit made during a run, which is precisely when a steer or a queued
  // message is submitted.
  const handleSubmit = useCallback(() => {
    if ((disabled && !streaming) || (!value.trim() && !pendingSticker)) return
    onSubmit()
  }, [disabled, streaming, value, pendingSticker, onSubmit])

  // `expected` is the value the caret position was computed against. The move
  // lands a frame later, and a key typed in that frame — a fast typist, key
  // repeat — has already moved on: putting the caret back at the old length
  // then inserts the next character in the middle of the word.
  const moveCaret = useCallback((next: number, expected?: string) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      if (expected !== undefined && el.value !== expected) return
      el.selectionStart = next
      el.selectionEnd = next
      setCaret(next)
      el.focus()
    })
  }, [])

  // Pressing Enter on a command without an argument changes `/model` to
  // `/model ` from above the field. React can keep the DOM selection at the old
  // length, and then the caret-aware parser still sees the command token rather
  // than the value token. Only this exact picker transition is repositioned;
  // later clicks within the unchanged value remain untouched.
  useEffect(() => {
    if (/^\/\S+ $/.test(value)) moveCaret(value.length, value)
  }, [moveCaret, value])

  const acceptSuggestion = useCallback(
    (item: ComposerSuggestion) => {
      const next = typeahead.accept(item)
      if (!next) return
      onChange(next.value)
      moveCaret(next.caret, next.value)
      if (!next.keepOpen) typeahead.dismiss()
    },
    [moveCaret, onChange, typeahead],
  )

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return
      if (typeahead.open) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          const direction = event.key === 'ArrowDown' ? 1 : -1
          typeahead.setActiveIndex((current) => (current + direction + typeahead.items.length) % typeahead.items.length)
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = typeahead.items[typeahead.activeIndex]
          if (!item) return
          event.preventDefault()
          event.stopPropagation()
          acceptSuggestion(item)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          typeahead.dismiss()
          return
        }
      }

      if (value.startsWith('!') && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onChange(value.slice(1))
        moveCaret(Math.max(0, event.currentTarget.selectionStart - 1))
      }
    },
    [acceptSuggestion, moveCaret, onChange, typeahead, value],
  )

  const handleFieldReady = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el
      // The hold is bound here rather than through JSX: React attaches touch
      // handlers passively at the root, where the `preventDefault()` that keeps a
      // hold from becoming a tap is ignored without a word.
      if (isAndroid) attachField(el)
    },
    [isAndroid, attachField],
  )

  const handleContextMenuOpen = useCallback((open: boolean) => {
    if (open) {
      setSelectedText(window.getSelection()?.toString() ?? '')
    }
  }, [])

  // A cut removes the text only once the clipboard has it: removed first, a
  // refused write lost it from both places. And only from the value it was cut
  // out of — the write is asynchronous, and anything typed meanwhile moved the
  // offsets, so a changed value keeps its text and the copy stands alone.
  const handleCut = useCallback(async () => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === end) return
    const before = el.value
    const attempt = ++latestClipboardAttempt.current
    try {
      await writeClipboard(before.slice(start, end))
    } catch (reason) {
      if (attempt === latestClipboardAttempt.current) {
        setClipboardError(t('common.cutFailed', { error: errorMessage(reason) }))
      }
      return
    }
    if (attempt === latestClipboardAttempt.current) setClipboardError(null)
    if (el.value !== before) return
    onChange(before.slice(0, start) + before.slice(end))
    requestAnimationFrame(() => {
      el.selectionStart = start
      el.selectionEnd = start
    })
  }, [onChange, t])

  const handleCopy = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const text = el.value.slice(el.selectionStart, el.selectionEnd)
    if (!text) return
    const attempt = ++latestClipboardAttempt.current
    writeClipboard(text).then(
      () => attempt === latestClipboardAttempt.current && setClipboardError(null),
      (reason: unknown) =>
        attempt === latestClipboardAttempt.current &&
        setClipboardError(t('common.copyFailed', { error: errorMessage(reason) })),
    )
  }, [t])

  // Straight to the `file` form of an attachment: an HTML5 drop or a paste has
  // no path to resolve, and `uploadAttachment` already knows what to do with
  // bytes on both transports.
  const handleDropFiles = useCallback(
    (files: File[]) => {
      onAttachFiles?.(files.map((file) => ({ name: file.name, file })))
    },
    [onAttachFiles],
  )

  // Withheld from a hosted session, as the attach menu is: an attachment
  // reaches a hosted agent as the JSON that carries it.
  const canAttachFiles = !isHosted && !!onAttachFiles && can.dropFiles

  // A pasted file is a clipboard operation that worked, like a pasted line of
  // text: it clears a failure the menu reported earlier, and takes a turn so
  // that an older menu request answering late cannot report it again.
  const handlePastedFiles = useCallback(
    (files: File[]) => {
      latestClipboardAttempt.current += 1
      setClipboardError(null)
      handleDropFiles(files)
    },
    [handleDropFiles],
  )

  const handlePaste = useCallback(async () => {
    const el = textareaRef.current
    if (!el) return
    let content: ClipboardContent
    const attempt = ++latestClipboardAttempt.current
    try {
      content = await readClipboardContent()
    } catch (reason) {
      if (attempt === latestClipboardAttempt.current) {
        setClipboardError(t('common.pasteFailed', { error: errorMessage(reason) }))
      }
      return
    }
    if (attempt === latestClipboardAttempt.current) setClipboardError(null)
    // The same rule as Ctrl+V (`pickPasted`), so the menu and the key agree
    // on what a clipboard holding both text and a picture means.
    const files = canAttachFiles ? pickPasted(content.text, content.files) : null
    if (files) {
      handleDropFiles(files)
      return
    }
    const clip = content.text
    const start = el.selectionStart
    const end = el.selectionEnd
    onChange(el.value.slice(0, start) + clip + el.value.slice(end))
    requestAnimationFrame(() => {
      const pos = start + clip.length
      el.selectionStart = pos
      el.selectionEnd = pos
    })
  }, [canAttachFiles, handleDropFiles, onChange, t])

  const handleSelectAll = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.select()
  }, [])

  /**
   * The bytes chosen through the browser's own picker.
   *
   * Only reachable in remote mode, and the only route available there: the
   * Tauri dialog, the camera and the gallery all answer with a path or a
   * `content://` URI naming a file on *this* device, which the machine that
   * would have to read it cannot open. See `lib/upload.ts`.
   */
  const handleBrowserFiles = useCallback(
    (files: File[]) => {
      onAttachFiles?.(files.map((file) => ({ name: file.name, file })))
    },
    [onAttachFiles],
  )

  // A camera or gallery that fails answers with a rejection, not with null —
  // null is "nothing chosen" — and nothing caught it: the button did nothing
  // and the reason went to the console.
  const handleTakePhoto = useCallback(async () => {
    if (isRemote) return fileInputRef.current?.open({ accept: 'image/*', capture: true })
    let uri: string | null
    try {
      uri = await api.takePhoto()
    } catch (err) {
      setComposerError(t('chat.attachFailed', { error: errorMessage(err) }))
      return
    }
    if (uri && onAttachFiles) {
      const name = await api.resolveFileName(uri).catch(() => 'photo.jpg')
      onAttachFiles([{ path: uri, name }])
    }
  }, [onAttachFiles, t])

  const handlePickGallery = useCallback(async () => {
    if (isRemote) return fileInputRef.current?.open({ accept: 'image/*' })
    let uri: string | null
    try {
      uri = await api.pickGalleryImage()
    } catch (err) {
      setComposerError(t('chat.attachFailed', { error: errorMessage(err) }))
      return
    }
    if (uri && onAttachFiles) {
      const name = await api.resolveFileName(uri).catch(() => 'image.jpg')
      onAttachFiles([{ path: uri, name }])
    }
  }, [onAttachFiles, t])

  // A path is all either the picker or a drop hands over; the name is asked for
  // separately because on Android a `content://` URI has no readable last
  // segment, and the tail of the path is only a fallback for when that fails.
  const attachPaths = useCallback(
    async (paths: string[]) => {
      if (!onAttachFiles || paths.length === 0) return
      const files = await Promise.all(
        paths.map(async (p) => ({
          path: p,
          name: await api
            .resolveFileName(p)
            .catch(() => p.replace(/\\/g, '/').split('/').pop() || t('chat.attachedFile')),
        })),
      )
      onAttachFiles(files)
    },
    [onAttachFiles, t],
  )

  const handlePickFile = useCallback(async () => {
    if (isRemote) return fileInputRef.current?.open()
    // Cancelling rejects on Android rather than resolving to null, so a tap on
    // Back out of the picker would otherwise surface as an unhandled rejection.
    // Every caller here already treats null as "nothing chosen".
    const paths = await open({ multiple: true }).catch(() => null)
    if (paths) await attachPaths(Array.isArray(paths) ? paths : [paths])
  }, [attachPaths])

  const menuItems = (
    <>
      {selectedText && (
        <>
          <ContextMenu.Item id="cut" textValue={t('contextMenu.cut')} onAction={() => void handleCut()}>
            <Scissors className="size-4 text-text-secondary" />
            <Label>{t('contextMenu.cut')}</Label>
            <Shortcut keys="Ctrl+X" />
          </ContextMenu.Item>
          <ContextMenu.Item id="copy" textValue={t('chat.copy')} onAction={handleCopy}>
            <Copy className="size-4 text-text-secondary" />
            <Label>{t('chat.copy')}</Label>
            <Shortcut keys="Ctrl+C" />
          </ContextMenu.Item>
        </>
      )}
      <ContextMenu.Item id="paste" textValue={t('contextMenu.paste')} onAction={() => void handlePaste()}>
        <ArrowInDownDashedPanel className="size-4 text-text-secondary" />
        <Label>{t('contextMenu.paste')}</Label>
        <Shortcut keys="Ctrl+V" />
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item id="select-all" textValue={t('contextMenu.selectAll')} onAction={handleSelectAll}>
        <CursorText className="size-4 text-text-secondary" />
        <Label>{t('contextMenu.selectAll')}</Label>
        <Shortcut keys="Ctrl+A" />
      </ContextMenu.Item>
    </>
  )

  return (
    // Sides as well as bottom: turned sideways the 3-button bar moves to one
    // edge, and the send button is in the corner it lands on.
    <div
      data-slot="input-bar"
      className={
        embedded
          ? 'w-full'
          : 'px-4 pb-[max(1rem,var(--safe-bottom))] pt-2 pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]'
      }
    >
      <div data-slot="input-bar-inner" className="max-w-2xl mx-auto">
        {isAndroid && (
          <VoiceOverlay state={androidVoice.state} elapsed={androidVoice.elapsed} peak={androidVoice.peak} />
        )}
        {isRemote && onAttachFiles && <FileInput ref={fileInputRef} multiple onFiles={handleBrowserFiles} />}
        <ComposerContextMenu
          enabled={!isCoarsePointer()}
          label={t('contextMenu.composerActions')}
          onOpenChange={handleContextMenuOpen}
          items={menuItems}
        >
          <Composer
            value={value}
            onChange={onChange}
            onSubmit={handleSubmit}
            // Not simply `disabled`: while a reply streams the field stays live,
            // and only Send turns into Stop. Offline is the exception to the
            // exception — steering a run on a machine that is not answering
            // fails exactly as starting one does.
            disabled={offline || (disabled && !streaming)}
            pending={pending}
            streaming={streaming}
            onStop={onStop}
            // Both mean "Enter works while a reply is coming, and Stop moves
            // aside". What they do with the text is what differs, and that is
            // the caller's business rather than the composer's.
            steerable={steerable || queueing}
            queue={queue}
            ariaLabel={t('chat.placeholder')}
            placeholder={
              value.startsWith('!')
                ? t('chat.shell.placeholder')
                : queueing
                  ? t('chat.placeholderQueue')
                  : steerable && streaming
                    ? t('chat.placeholderSteer')
                    : // Only promises the hold while the hold is bound.
                      voicePress
                      ? t('chat.placeholderVoice')
                      : t('chat.placeholder')
            }
            onFieldReady={handleFieldReady}
            inputMode={value.startsWith('!') ? 'shell' : 'prompt'}
            onCaretChange={setCaret}
            onKeyDownCapture={handleComposerKeyDown}
            fieldProps={{
              role: 'combobox',
              'aria-autocomplete': 'list',
              'aria-expanded': typeahead.open,
              'aria-controls': typeahead.open ? suggestionsId : undefined,
              'aria-activedescendant':
                typeahead.open && typeahead.items[typeahead.activeIndex]
                  ? suggestionOptionId(suggestionsId, typeahead.activeIndex)
                  : undefined,
            }}
            suggestions={
              typeahead.open ? (
                <ComposerSuggestions
                  id={suggestionsId}
                  items={typeahead.items}
                  activeIndex={typeahead.activeIndex}
                  onAction={acceptSuggestion}
                  ariaLabel={
                    typeahead.token?.kind === 'reference'
                      ? t('chat.referenceSuggestions')
                      : t('chat.commandSuggestions')
                  }
                />
              ) : null
            }
            // `!isHosted` for the same reason the attach menu and the sticker
            // picker are withheld: an attachment reaches a hosted agent as the
            // JSON that carries it, because an ACP prompt is a single text
            // block. Closing the menus and leaving the whole window droppable
            // would be the same failure with a better hiding place.
            onDropFiles={!isHosted && onAttachFiles && can.dropFiles ? handleDropFiles : undefined}
            // A pasted screenshot is a dropped file by another route, held
            // back from a hosted session for the same reason.
            onPasteFiles={canAttachFiles ? handlePastedFiles : undefined}
            // Offline takes the line over: a disabled field with nothing to
            // say about why reads as the app having broken.
            notice={
              offline || composerError || clipboardError || acp.error || voiceNotice ? (
                <>
                  {offline && (
                    <p
                      data-slot="composer-notice"
                      role="status"
                      className="px-2 pb-1.5 text-caption-1-regular text-status-danger"
                    >
                      {t('settings.client.composerOffline')}
                    </p>
                  )}
                  {composerError && (
                    <ErrorAlert
                      data-slot="composer-error"
                      className="mx-1 mb-1.5"
                      message={composerError}
                      onDismiss={() => setComposerError(null)}
                    />
                  )}
                  {clipboardError && (
                    <ErrorAlert
                      data-slot="composer-clipboard-error"
                      className="mx-1 mb-1.5"
                      message={clipboardError}
                      onDismiss={() => setClipboardError(null)}
                    />
                  )}
                  {acp.error && (
                    <ErrorAlert
                      data-slot="composer-agent-error"
                      className="mx-1 mb-1.5"
                      title={t('chat.agentOptionsFailed')}
                      message={acp.error}
                      onDismiss={acp.dismissError}
                    />
                  )}
                  {!offline && voiceNotice && (
                    <p
                      data-slot="composer-notice"
                      role="status"
                      className="px-2 pb-1.5 text-caption-1-regular text-text-secondary"
                    >
                      {voiceNotice}
                    </p>
                  )}
                </>
              ) : null
            }
            attachments={
              (attachedFiles.length > 0 || pendingSticker) && (
                <div data-slot="composer-attachments" className="flex w-full min-w-0 items-end gap-2 px-1 pb-1">
                  {attachedFiles.length > 0 && (
                    <AttachmentTiles
                      ref={attachmentRow}
                      files={attachedFiles}
                      onRemove={onRemoveFile}
                      onReorder={onReorderFiles}
                    />
                  )}
                  {pendingSticker && (
                    <div
                      className="relative shrink-0 rounded-xl bg-background-secondary-default/40 p-1"
                      data-slot="pending-sticker"
                    >
                      <img
                        data-slot="pending-sticker-image"
                        src={pendingSticker.url}
                        alt={pendingSticker.emoji.name}
                        // The tiles' 56px with this box's padding, so the row
                        // is one height whatever it holds.
                        className="size-12 object-contain"
                      />
                      {onRemoveSticker && (
                        // The corner placement is on a wrapper, not the button.
                        // On a coarse pointer `touch-hitbox` sets the button's
                        // own `position: relative` (the box its `::after`
                        // expands from); beside `absolute` on the same element
                        // those are one class each in one layer, so emission
                        // order alone decided whether the button stayed in the
                        // corner or fell into flow under the sticker. Split, the
                        // wrapper is positioned — and, later in the DOM than the
                        // image, painted over it — and the button is the hitbox's
                        // containing block with nothing to contest it.
                        <span data-slot="pending-sticker-remove" className="absolute -right-2 -top-2 flex">
                          <TooltipTrigger delay={0}>
                            <Button
                              iconOnly
                              leadingIcon={X}
                              size="xs"
                              variant="neutral"
                              aria-label={t('chat.removeSticker')}
                              className="touch-hitbox min-w-0 size-6 rounded-full shadow-card"
                              onPress={onRemoveSticker}
                            />
                            <Tooltip>{t('chat.removeSticker')}</Tooltip>
                          </TooltipTrigger>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            }
            status={
              <ComposerStatusTab
                // The first reading of a conversation's own window is a fetch
                // away when it opens; a hosted session's arrives whenever the
                // agent says so, and holding the tab for it could be for ever.
                pending={!isHosted && contextInfo?.status === 'loading'}
                progress={todos && todos.todos.length > 0 ? <TodoProgressChip todos={todos} /> : null}
                usage={
                  hasContextReading({ context: contextInfo, hosted: !!isHosted, agentUsage: acp.usage }) ? (
                    <ContextGauge
                      showPercent
                      context={contextInfo}
                      hosted={!!isHosted}
                      agentUsage={acp.usage}
                      agentModel={hostedModel}
                      compacting={compacting}
                      streaming={streaming}
                      onCompact={onCompact}
                    />
                  ) : null
                }
              />
            }
            hasPayload={!!pendingSticker}
            toolbarStart={
              // Steering a delegated run starts no turn, so nothing that
              // describes one — what to attach, which mode — applies.
              steerable && streaming ? null : (
                <>
                  {isAndroid && !isHosted ? (
                    // The phone's `+` is a sheet a thumb reaches. A hosted
                    // session has nothing to attach, so it gets the agent's
                    // knob menu below instead.
                    <AttachSheet
                      triggerRef={plusRef}
                      onOpenStickers={offersStickers ? () => setStickersOpen(true) : undefined}
                      onTakePhoto={handleTakePhoto}
                      onPickGallery={handlePickGallery}
                      onPickFile={handlePickFile}
                      supportsImages={capabilities?.supports_images !== false}
                    />
                  ) : (
                    <ComposerMenu
                      triggerRef={plusRef}
                      onOpenStickers={offersStickers ? () => setStickersOpen(true) : undefined}
                      // **Not on a hosted session.** An attachment is carried by
                      // packing the message into a JSON array of parts, and the
                      // ACP path sends whatever it is handed as a *single text
                      // block* — so the agent receives the JSON itself while the
                      // composer shows an attachment going out. Real support
                      // means mapping parts onto ACP content blocks and asking
                      // `promptCapabilities` first; until then the honest thing
                      // is not to offer it.
                      onPickFile={
                        !isHosted && onAttachFiles && capabilities?.supports_images !== false
                          ? handlePickFile
                          : undefined
                      }
                      knobs={otherKnobs}
                      onSetKnob={setKnob}
                      knobsBusy={acp.busy}
                    />
                  )}
                  {modeChip}
                  {stickerPicker}
                </>
              )
            }
            toolbarEnd={
              <>
                {/* Which model is answering is the one setting a person
                    changes while working, so it is on the toolbar, beside the
                    microphone and Send, rather than in a menu. */}
                {steerable && streaming ? null : isHosted ? (
                  <HostedModelPanel model={modelKnob} effort={effortKnob} busy={acp.busy} onSet={setKnob} />
                ) : (
                  <ModelPanel
                    assistants={assistants}
                    providers={providers}
                    currentAssistantId={currentAssistantId}
                    currentModelId={currentModelId}
                    currentProviderId={currentProviderId}
                    onSelectAssistant={onSelectAssistant}
                    onSelectModel={onSelectModel}
                    thinkingLevel={thinkingLevel}
                    onSelectThinkingLevel={onSelectThinkingLevel}
                    fastMode={fastMode}
                    onToggleFast={onToggleFast}
                    capabilities={capabilities}
                  />
                )}
                {!isAndroid && onVoiceSend && (
                  <TooltipTrigger delay={0}>
                    {/* The button is the trigger — TooltipTrigger picks it up
                      from context, no wrapper needed. */}
                    <VoiceButton
                      aria-label={voice.state === 'idle' ? t('chat.voice.tooltip') : t('chat.voice.cancelHint')}
                      state={voice.state}
                      elapsed={voice.elapsed}
                      disabled={offline || disabled || streaming}
                      onPointerDown={voice.handlePointerDown}
                      onPointerUp={voice.handlePointerUp}
                      onPointerCancel={voice.handlePointerCancel}
                      onPointerEnter={voice.handlePointerEnter}
                      onPointerLeave={voice.handlePointerLeave}
                      onKeyboardPress={voice.handleKeyboardPress}
                    />
                    <Tooltip placement="top">
                      {voice.state === 'idle' ? t('chat.voice.tooltip') : t('chat.voice.cancelHint')}
                    </Tooltip>
                  </TooltipTrigger>
                )}
              </>
            }
          />
        </ComposerContextMenu>
      </div>
    </div>
  )
}
