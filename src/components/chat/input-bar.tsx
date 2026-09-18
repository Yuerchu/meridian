import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowDownToSquare, ChevronDown, Copy, Scissors, SquareDashedText, Xmark } from '@gravity-ui/icons'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { Button, Kbd, Label, ListBox, Popover, Tooltip, TooltipTrigger } from '@/components/base'
import { ContextMenu } from '@/components/base'
import { ChatAttachment, ChatAttachmentGroup } from '@/components/base'

import { localPreviewSrc } from '@/lib/asset-src'
import { can } from '@/lib/capabilities'
import { isRemote } from '@/lib/transport'
import type { Attachment } from '@/lib/upload'
import { isCoarsePointer } from '@/hooks/use-coarse-pointer'
import { useIsOffline } from '@/hooks/use-connection-state'
import { useVoiceRecorder, type VoiceNotice } from '@/hooks/use-voice-recorder'
import { useAndroidVoiceRecorder } from '@/hooks/use-android-voice-recorder'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useComposerTypeahead } from '@/hooks/use-composer-typeahead'
import { FileInput, type FileInputHandle } from '@/components/ui/file-input'
import { VoiceButton } from '@/components/ui/voice-button'
import { Composer } from './composer'
import { ComposerSuggestions, type ComposerSuggestion } from './composer-suggestions'
import { VoiceOverlay } from './voice-overlay'
import { MobileOptionsMenu } from './toolbar'
import { ComposerMenu } from './composer-menu'
import { EmojiPicker } from './emoji-picker'
import { ToolbarSelect } from './toolbar-select'
import { ContextGauge, type ContextReading } from './context-gauge'
import { isSelect, useAcpConfig } from '@/hooks/use-acp-config'
import type { TFunction } from 'i18next'
import type {
  AcpConfigOptionInfoResponse,
  AcpConfigOptionValueInfoResponse,
  AssistantInfoResponse,
  ChatMode,
  EmojiInfoResponse,
  ProviderInfoResponse,
  ProviderCapabilitiesInfoResponse,
  QueueDelivery,
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
   * A hosted session with a turn running. Like `steerable` in that the field
   * stays live and a Stop of its own appears, and unlike it in what happens
   * next: steering goes straight into the run, while this is written down and
   * delivered when the queue says so. The toolbar stays, because which of the
   * two modes the next message goes in is a decision made *here*.
   */
  queueing?: boolean
  /** What the next queued message will be. */
  queueDelivery?: QueueDelivery
  onSelectQueueDelivery?: (delivery: QueueDelivery) => void
  /** The rows themselves, above the shell. */
  queue?: React.ReactNode
  attachedFiles?: AttachedFile[]
  onAttachFiles?: (files: AttachedFile[]) => void
  onRemoveFile?: (index: number) => void
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
  contextInfo?: ContextReading
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
/**
 * What to call a knob, and what to call the value it is set to.
 *
 * The agent's own strings are English and always will be: `name` is composed in
 * the adapter, so in a Chinese window a row of them reads `Mode / Effort / Fast
 * mode` with nothing translated. The ids it uses for the knobs it defines are a
 * short documented set (`mode`, `model`, `effort`, `fast`, `agent`), so those
 * get translations here and everything else falls back to what the agent said —
 * which is the only right answer for a knob some other agent invented.
 *
 * Keyed on `id` rather than `category`, and that is not interchangeable: the
 * reasoning knob is `id: "effort"` under `category: "thought_level"`, and Fast
 * mode is `id: "fast"` under `category: "model_config"` — a category naming a
 * *class* of setting rather than the setting. Only the id names the thing.
 */
function knobName(t: TFunction, option: AcpConfigOptionInfoResponse): string {
  const fallback = option.name || option.id
  return t(`chat.acp.knob.${option.id.toLowerCase()}`, { defaultValue: fallback })
}

function knobValueName(
  t: TFunction,
  option: AcpConfigOptionInfoResponse,
  value: AcpConfigOptionValueInfoResponse,
): string {
  const fallback = value.name || value.value
  // Scoped per knob, because `default` means a different thing on each of them
  // and a model id must never find a translation at all.
  return t(`chat.acp.value.${option.id.toLowerCase()}.${value.value.toLowerCase()}`, { defaultValue: fallback })
}

function currentValueName(t: TFunction, option: AcpConfigOptionInfoResponse): string | null {
  if (typeof option.currentValue !== 'string') return null
  const value = option.options.find((v) => v.value === option.currentValue)
  return value ? knobValueName(t, option, value) : option.currentValue
}

/**
 * Everything a hosted Claude Code session lets you set, in one control.
 *
 * Renders nothing at all for an ordinary conversation, and nothing for a hosted
 * one whose adapter is not running — there is no session to change anything on,
 * and a picker that cannot pick is worse than no picker.
 *
 * **One control, because a picker in this toolbar can only show its value.**
 * That is fine for the model — "Opus" says what it is — and says nothing for
 * anything else: the row used to read `Auto · Default (recommend… · Xhigh · On
 * · Default`, five controls naming none of the five things they set, two of them
 * truncated for the privilege, and the send button pushed out of the shell
 * behind them. So the trigger carries the two values worth reading at a glance
 * — the model and, when it is not on its default, the effort — and opening it
 * gives every knob a name, the agent's own description, and its values laid out
 * with the current one ticked.
 *
 * Which knobs exist stays the agent's answer. The two it singles out are read by
 * id, the same way `SessionConfigOption::as_model` already reads the model,
 * because the model is what a transcript row records as having answered.
 */
function HostedSessionKnobs({ options, set, busy }: Pick<ReturnType<typeof useAcpConfig>, 'options' | 'set' | 'busy'>) {
  const { t } = useTranslation()
  // A select with nothing in it is not offered: the agent has told us a knob
  // exists without saying what it accepts, and an empty menu reads as a bug.
  const pickers = options.filter((o) => isSelect(o) && o.options.length > 0)
  if (pickers.length === 0) return null

  // Category as well as id, so an agent that names one and omits the other is
  // still understood. `thought_level` is the category the adapter files effort
  // under; `effort` is its id.
  const model = pickers.find((o) => o.id === 'model' || o.category === 'model')
  const effort = pickers.find((o) => o.id === 'effort' || o.category === 'thought_level')
  const summary = [
    model && currentValueName(t, model),
    // Left off when it is on its default: a permanent "· 默认" is noise, and the
    // width it takes is the width the send button needs.
    effort && effort.currentValue !== 'default' ? currentValueName(t, effort) : null,
  ].filter(Boolean)

  // A refusal leaves the set as it was, which is already what is on screen —
  // the agent did not change, so neither should the picker.
  const choose = (id: string, value: string) => void set(id, value).catch(() => {})

  return (
    <Popover>
      <TooltipTrigger delay={0}>
        <Button
          variant="ghost"
          aria-label={t('chat.agentOptions')}
          data-slot="agent-options-trigger"
          isDisabled={busy}
          className="h-8 max-w-56 gap-1 rounded-lg px-2 text-body-regular"
        >
          <span data-slot="agent-options-summary" className="truncate">
            {summary.length > 0 ? summary.join(' · ') : t('chat.agentOptions')}
          </span>
          <ChevronDown className="size-4 shrink-0 text-text-secondary" />
        </Button>
        <Tooltip placement="top">{t('chat.agentOptions')}</Tooltip>
      </TooltipTrigger>
      <Popover.Content placement="top start" className="w-72">
        <Popover.Dialog className="flex max-h-[min(420px,calc(100vh-6rem))] flex-col gap-3 overflow-y-auto">
          {pickers.map((option) => (
            <div key={option.id} data-slot="agent-knob">
              <p data-slot="agent-knob-name" className="px-2 text-caption-1-medium">
                {knobName(t, option)}
              </p>
              {option.description && (
                <p
                  data-slot="agent-knob-description"
                  className="px-2 pt-0.5 text-caption-1-regular text-text-secondary"
                >
                  {option.description}
                </p>
              )}
              {/* A flat list rather than a second dropdown. Every value is
                  visible at once and the current one is ticked, which is the
                  thing the toolbar could not say — and it keeps this from being
                  an overlay inside an overlay. */}
              <ListBox
                aria-label={knobName(t, option)}
                className="mt-1 p-1"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={typeof option.currentValue === 'string' ? [option.currentValue] : []}
                onSelectionChange={(keys) => {
                  const next = [...(keys as Set<string>)][0]
                  if (next) choose(option.id, next)
                }}
              >
                {option.options.map((v) => (
                  <ListBox.Item key={v.value} id={v.value} textValue={knobValueName(t, option, v)}>
                    <span data-slot="agent-knob-value" className="min-w-0 flex-1 truncate text-body-regular">
                      {knobValueName(t, option, v)}
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </div>
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

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
  queueDelivery = 'follow_up',
  onSelectQueueDelivery,
  queue,
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
  const [selectedText, setSelectedText] = useState('')

  // Transient one-line notice above the composer ("too short", model missing…)
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showHint = useCallback((text: string) => {
    setVoiceNotice(text)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setVoiceNotice(null), 3000)
  }, [])
  const showVoiceNotice = useCallback(
    (notice: VoiceNotice, detail?: string) => {
      showHint(notice === 'error' && detail ? detail : t(`chat.voice.${notice}`))
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

  const moveCaret = useCallback((next: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
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
    if (/^\/\S+ $/.test(value)) moveCaret(value.length)
  }, [moveCaret, value])

  const acceptSuggestion = useCallback(
    (item: ComposerSuggestion) => {
      const next = typeahead.accept(item)
      if (!next) return
      onChange(next.value)
      moveCaret(next.caret)
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

  const handleCut = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === end) return
    navigator.clipboard.writeText(el.value.slice(start, end))
    onChange(el.value.slice(0, start) + el.value.slice(end))
    requestAnimationFrame(() => {
      el.selectionStart = start
      el.selectionEnd = start
    })
  }, [onChange])

  const handleCopy = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const text = el.value.slice(el.selectionStart, el.selectionEnd)
    if (text) navigator.clipboard.writeText(text)
  }, [])

  const handlePaste = useCallback(async () => {
    const el = textareaRef.current
    if (!el) return
    const clip = await navigator.clipboard.readText()
    const start = el.selectionStart
    const end = el.selectionEnd
    onChange(el.value.slice(0, start) + clip + el.value.slice(end))
    requestAnimationFrame(() => {
      const pos = start + clip.length
      el.selectionStart = pos
      el.selectionEnd = pos
    })
  }, [onChange])

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

  const handleTakePhoto = useCallback(async () => {
    if (isRemote) return fileInputRef.current?.open({ accept: 'image/*', capture: true })
    const uri = await api.takePhoto()
    if (uri && onAttachFiles) {
      const name = await api.resolveFileName(uri).catch(() => 'photo.jpg')
      onAttachFiles([{ path: uri, name }])
    }
  }, [onAttachFiles])

  const handlePickGallery = useCallback(async () => {
    if (isRemote) return fileInputRef.current?.open({ accept: 'image/*' })
    const uri = await api.pickGalleryImage()
    if (uri && onAttachFiles) {
      const name = await api.resolveFileName(uri).catch(() => 'image.jpg')
      onAttachFiles([{ path: uri, name }])
    }
  }, [onAttachFiles])

  // A path is all either the picker or a drop hands over; the name is asked for
  // separately because on Android a `content://` URI has no readable last
  // segment, and the tail of the path is only a fallback for when that fails.
  const attachPaths = useCallback(
    async (paths: string[]) => {
      if (!onAttachFiles || paths.length === 0) return
      const files = await Promise.all(
        paths.map(async (p) => ({
          path: p,
          name: await api.resolveFileName(p).catch(() => p.replace(/\\/g, '/').split('/').pop() ?? 'file'),
        })),
      )
      onAttachFiles(files)
    },
    [onAttachFiles],
  )

  const handlePickFile = useCallback(async () => {
    if (isRemote) return fileInputRef.current?.open()
    // Cancelling rejects on Android rather than resolving to null, so a tap on
    // Back out of the picker would otherwise surface as an unhandled rejection.
    // Every caller here already treats null as "nothing chosen".
    const paths = await open({ multiple: true }).catch(() => null)
    if (paths) await attachPaths(Array.isArray(paths) ? paths : [paths])
  }, [attachPaths])

  // Straight to the `file` form of an attachment: an HTML5 drop has no path
  // to resolve, and `uploadAttachment` already knows what to do with bytes on
  // both transports.
  const handleDropFiles = useCallback(
    (files: File[]) => {
      onAttachFiles?.(files.map((file) => ({ name: file.name, file })))
    },
    [onAttachFiles],
  )

  const menuItems = (
    <>
      {selectedText && (
        <>
          <ContextMenu.Item id="cut" textValue={t('contextMenu.cut')} onAction={handleCut}>
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
        <ArrowDownToSquare className="size-4 text-text-secondary" />
        <Label>{t('contextMenu.paste')}</Label>
        <Shortcut keys="Ctrl+V" />
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item id="select-all" textValue={t('contextMenu.selectAll')} onAction={handleSelectAll}>
        <SquareDashedText className="size-4 text-text-secondary" />
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
            suggestions={
              typeahead.open ? (
                <ComposerSuggestions
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
            // Offline takes the line over: a disabled field with nothing to
            // say about why reads as the app having broken.
            notice={
              offline ? (
                <p data-slot="composer-notice" className="px-2 pb-1.5 text-caption-1-regular text-status-danger">
                  {t('settings.client.composerOffline')}
                </p>
              ) : (
                voiceNotice && (
                  <p data-slot="composer-notice" className="px-2 pb-1.5 text-caption-1-regular text-text-secondary">
                    {voiceNotice}
                  </p>
                )
              )
            }
            attachments={
              (attachedFiles.length > 0 || pendingSticker) && (
                <div data-slot="composer-attachments" className="flex items-end gap-2 px-1 pb-1">
                  {attachedFiles.length > 0 && (
                    <ChatAttachmentGroup>
                      {attachedFiles.map((f, i) => (
                        // An image gets a thumbnail rather than the paperclip everything
                        // used to get: the path is already on disk, so this costs one
                        // asset-protocol URL. Anything else falls back to the icon the
                        // extension implies.
                        // No path means the bytes are being carried instead, and
                        // there is nothing addressable to point an `<img>` at —
                        // the icon the extension implies is the honest answer.
                        <ChatAttachment
                          key={i}
                          name={f.name}
                          src={f.path ? localPreviewSrc(f.path, f.name) : undefined}
                        >
                          <ChatAttachment.Preview />
                          <ChatAttachment.Info />
                          {onRemoveFile && (
                            <ChatAttachment.Remove
                              aria-label={t('chat.removeAttachment', { name: f.name })}
                              onPress={() => onRemoveFile(i)}
                            />
                          )}
                        </ChatAttachment>
                      ))}
                    </ChatAttachmentGroup>
                  )}
                  {pendingSticker && (
                    <div
                      className="relative shrink-0 rounded-xl bg-background-secondary-default/40 p-2"
                      data-slot="pending-sticker"
                    >
                      <img
                        data-slot="pending-sticker-image"
                        src={pendingSticker.url}
                        alt={pendingSticker.emoji.name}
                        className="size-20 object-contain"
                      />
                      {onRemoveSticker && (
                        <TooltipTrigger delay={0}>
                          <Button
                            iconOnly
                            size="small"
                            variant="primary"
                            aria-label={t('chat.removeSticker')}
                            className="touch-hitbox absolute -right-2 -top-2 min-w-0 size-6 rounded-full shadow-card"
                            onPress={onRemoveSticker}
                          >
                            <Xmark className="size-3.5" />
                          </Button>
                          <Tooltip>{t('chat.removeSticker')}</Tooltip>
                        </TooltipTrigger>
                      )}
                    </div>
                  )}
                </div>
              )
            }
            hasPayload={!!pendingSticker}
            toolbarStart={
              steerable && streaming ? null : isAndroid ? (
                // The phone keeps the pickers in the one sheet: there is no room
                // beside the field for them, and a truncated model name is worse
                // than one tap.
                <>
                  <MobileOptionsMenu
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
                    mode={mode}
                    onSelectMode={onSelectMode}
                    acceptEdits={acceptEdits}
                    onToggleAcceptEdits={onToggleAcceptEdits}
                    capabilities={capabilities}
                    // Same reason as the desktop branch below: a hosted prompt is
                    // one text block, so a picture picked here would reach the
                    // agent as JSON. Reachable from a phone in remote mode, where
                    // the conversation is hosted on the machine at the other end.
                    onTakePhoto={handleTakePhoto}
                    onPickGallery={handlePickGallery}
                    onPickFile={isHosted ? undefined : handlePickFile}
                    supportsImages={!isHosted && capabilities?.supports_images !== false}
                  />
                  {/* These two are the agent's knobs and the queue's, not the
                      sheet's, so they sit beside it here exactly as they do on a
                      desktop. Left out of this branch, a phone attached to a
                      hosted session — which is how remote mode reaches one — had
                      no way to change its model, permission mode or effort at
                      all, and no way to choose a delivery before sending. Both
                      are already compact triggers rather than rows, so there is
                      nothing to fold into the sheet. */}
                  <HostedSessionKnobs options={acp.options} set={acp.set} busy={acp.busy} />
                  {queueing && onSelectQueueDelivery && (
                    <ToolbarSelect
                      aria-label={t('chat.queue.mode')}
                      placeholder={t('chat.queue.followUp')}
                      value={queueDelivery}
                      choices={[
                        { value: 'follow_up', label: t('chat.queue.followUp'), hint: t('chat.queue.followUpHint') },
                        { value: 'interject', label: t('chat.queue.interject'), hint: t('chat.queue.interjectHint') },
                      ]}
                      onSelect={(value) => onSelectQueueDelivery(value as QueueDelivery)}
                    />
                  )}
                </>
              ) : (
                <>
                  <ComposerMenu
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
                    mode={mode}
                    onSelectMode={onSelectMode}
                    acceptEdits={acceptEdits}
                    onToggleAcceptEdits={onToggleAcceptEdits}
                    capabilities={capabilities}
                    // **Not on a hosted session.** An attachment is carried by
                    // packing the message into a JSON array of parts, and the
                    // ACP path sends whatever it is handed as a *single text
                    // block* — so the agent receives the JSON itself while the
                    // composer shows an attachment going out. Real support
                    // means mapping parts onto ACP content blocks and asking
                    // `promptCapabilities` first; until then the honest thing
                    // is not to offer it.
                    onPickFile={
                      !isHosted && onAttachFiles && capabilities?.supports_images !== false ? handlePickFile : undefined
                    }
                  />
                  {/* Beside the menu rather than inside it. Which model is
                      answering is the one setting a person changes while
                      working, and it is worth seeing without opening
                      anything. A hosted session's knobs are the agent's and
                      arrive over ACP; everything else stays in the menu. */}
                  <HostedSessionKnobs options={acp.options} set={acp.set} busy={acp.busy} />
                  {/* Only while the next Enter would queue. The two are not
                      urgency levels, so the control names what will happen
                      rather than how urgent it is — and it is here rather than
                      on the row because it is a decision about the message
                      being typed, made before it exists. */}
                  {queueing && onSelectQueueDelivery && (
                    <ToolbarSelect
                      aria-label={t('chat.queue.mode')}
                      placeholder={t('chat.queue.followUp')}
                      value={queueDelivery}
                      choices={[
                        { value: 'follow_up', label: t('chat.queue.followUp'), hint: t('chat.queue.followUpHint') },
                        { value: 'interject', label: t('chat.queue.interject'), hint: t('chat.queue.interjectHint') },
                      ]}
                      onSelect={(value) => onSelectQueueDelivery(value as QueueDelivery)}
                    />
                  )}
                </>
              )
            }
            toolbarEnd={
              <>
                {/* A sticker travels the same way an attachment does — as a
                    part in a JSON array — and reaches a hosted agent as that
                    JSON rather than as anything it can see. See `onPickFile`. */}
                {!isHosted && (
                  <EmojiPicker assistantId={currentAssistantId} onSelect={(sticker) => onSelectSticker?.(sticker)} />
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
                <ContextGauge
                  context={contextInfo}
                  hosted={!!isHosted}
                  agentUsage={acp.usage}
                  agentModel={hostedModel}
                  compacting={compacting}
                  streaming={streaming}
                  onCompact={onCompact}
                />
              </>
            }
          />
        </ComposerContextMenu>
      </div>
    </div>
  )
}
