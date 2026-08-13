import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowDownToSquare, ArrowUp, Copy, Microphone, Paperclip, Scissors, SquareDashedText, StopFill, Xmark } from '@gravity-ui/icons'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { Button, InputGroup, Popover, ProgressCircle, TextField, Tooltip } from '@heroui/react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { isCoarsePointer, isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useVoiceRecorder, type VoiceNotice } from '@/hooks/use-voice-recorder'
import { useAndroidVoiceRecorder } from '@/hooks/use-android-voice-recorder'
import { useHistoryLevel } from '@/hooks/use-nav'
import { VoiceButton } from '@/components/ui/voice-button'
import { VoiceOverlay } from './voice-overlay'
import { MobileOptionsMenu } from './toolbar'
import { ComposerMenu } from './composer-menu'
import { EmojiPicker } from './emoji-picker'
import type { Assistant, ChatMode, Provider, ProviderCapabilities, ThinkingLevel } from '@/types'

interface ContextInfo {
  messageCount: number
  estimatedTokens: number
  contextLimit: number
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  /** `closed` while compaction is being attempted. Anything else means enough
   *  summarisations failed in a row that it has stopped trying — the setting is
   *  still on, and the count will only keep climbing, so it has to be said. */
  compactBreaker: string
  /** Whose window the numbers above describe. */
  model: string
  /** Set when this conversation is a delegated run, so the panel can say that
   *  the window it is reporting is not the one next door. */
  agentKind?: string
}

export interface AttachedFile {
  path: string
  name: string
}

interface InputBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Send transcribed speech directly, bypassing the textarea. */
  onVoiceSend?: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  streaming?: boolean
  attachedFiles?: AttachedFile[]
  onAttachFiles?: (files: AttachedFile[]) => void
  onRemoveFile?: (index: number) => void
  assistants: Assistant[]
  providers: Provider[]
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
  capabilities?: ProviderCapabilities | null
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
  onOpenChange,
  items,
  children,
}: {
  enabled: boolean
  onOpenChange: (open: boolean) => void
  items: React.ReactNode
  children: React.ReactNode
}) {
  if (!enabled) return children
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>{items}</ContextMenuContent>
    </ContextMenu>
  )
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  onVoiceSend,
  onStop,
  disabled,
  streaming,
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
}: InputBarProps) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const isAndroid = platform === 'android'
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selectedText, setSelectedText] = useState('')

  // Transient one-line notice above the composer ("too short", model missing…)
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showVoiceNotice = useCallback((notice: VoiceNotice, detail?: string) => {
    const text = notice === 'error' && detail ? detail : t(`chat.voice.${notice}`)
    setVoiceNotice(text)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setVoiceNotice(null), 3000)
  }, [t])
  const voice = useVoiceRecorder({
    onSend: (text) => onVoiceSend?.(text),
    onNotice: showVoiceNotice,
  })
  // Hold-to-talk on the field itself. Both hooks are called unconditionally —
  // hooks cannot be conditional — but only one of them is ever reachable: the
  // desktop has no press layer, and Android does not render the mic button.
  const androidVoice = useAndroidVoiceRecorder({
    onSend: (text) => onVoiceSend?.(text),
    onNotice: showVoiceNotice,
    onTap: () => textareaRef.current?.focus(),
  })
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
  const composingRef = useRef(false)
  const handleSubmit = useCallback(() => {
    if (composingRef.current) return
    onSubmit()
  }, [onSubmit])

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

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSubmitKey(e)) {
        e.preventDefault()
        if (!disabled && value.trim()) {
          onSubmit()
        }
      }
    },
    [disabled, value, onSubmit],
  )

  const handleTakePhoto = useCallback(async () => {
    const uri = await api.takePhoto()
    if (uri && onAttachFiles) {
      const name = await api.resolveFileName(uri).catch(() => 'photo.jpg')
      onAttachFiles([{ path: uri, name }])
    }
  }, [onAttachFiles])

  const handlePickGallery = useCallback(async () => {
    const uri = await api.pickGalleryImage()
    if (uri && onAttachFiles) {
      const name = await api.resolveFileName(uri).catch(() => 'image.jpg')
      onAttachFiles([{ path: uri, name }])
    }
  }, [onAttachFiles])

  const handlePickFile = useCallback(async () => {
    // Cancelling rejects on Android rather than resolving to null, so a tap on
    // Back out of the picker would otherwise surface as an unhandled rejection.
    // Every caller here already treats null as "nothing chosen".
    const paths = await open({ multiple: true }).catch(() => null)
    if (paths && onAttachFiles) {
      const files = await Promise.all(
        (Array.isArray(paths) ? paths : [paths]).map(async (p) => ({
          path: p,
          name: await api.resolveFileName(p).catch(() => p.replace(/\\/g, '/').split('/').pop() ?? 'file'),
        }))
      )
      onAttachFiles(files)
    }
  }, [onAttachFiles])

  const menuItems = (
    <>
      {selectedText && (
        <>
          <ContextMenuItem onClick={handleCut}>
            <Scissors />
            {t('contextMenu.cut')}
            <span className="ml-auto text-xs text-muted">Ctrl+X</span>
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCopy}>
            <Copy />
            {t('chat.copy')}
            <span className="ml-auto text-xs text-muted">Ctrl+C</span>
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem onClick={handlePaste}>
        <ArrowDownToSquare />
        {t('contextMenu.paste')}
        <span className="ml-auto text-xs text-muted">Ctrl+V</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleSelectAll}>
        <SquareDashedText />
        {t('contextMenu.selectAll')}
        <span className="ml-auto text-xs text-muted">Ctrl+A</span>
      </ContextMenuItem>
    </>
  )

  return (
    // Sides as well as bottom: turned sideways the 3-button bar moves to one
    // edge, and the send button is in the corner it lands on.
    <div className="px-4 pb-[max(1rem,var(--safe-bottom))] pt-2 pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]">
      <div className="max-w-2xl mx-auto">
        {isAndroid && (
          <VoiceOverlay
            state={androidVoice.state}
            elapsed={androidVoice.elapsed}
            peak={androidVoice.peak}
          />
        )}
        {voiceNotice && (
          <p className="px-2 pb-1.5 text-xs text-muted">{voiceNotice}</p>
        )}
        <ComposerContextMenu
          enabled={!isCoarsePointer()}
          onOpenChange={handleContextMenuOpen}
          items={menuItems}
        >
        <TextField fullWidth aria-label={t('chat.placeholder')}>
        <InputGroup fullWidth className="flex flex-col gap-2 rounded-2xl py-2">
          {attachedFiles.length > 0 && (
            <InputGroup.Prefix className="w-full justify-start border-0 px-3.5 py-0">
              <AttachmentGroup>
                {attachedFiles.map((f, i) => (
                  <Attachment key={i} state="done">
                    <AttachmentMedia>
                      <Paperclip />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle className="max-w-[120px]">{f.name}</AttachmentTitle>
                    </AttachmentContent>
                    {onRemoveFile && (
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label={t('chat.removeAttachment', { name: f.name })}
                          onClick={() => onRemoveFile(i)}
                          className="hover:text-danger"
                        >
                          <Xmark />
                        </AttachmentAction>
                      </AttachmentActions>
                    )}
                  </Attachment>
                ))}
              </AttachmentGroup>
            </InputGroup.Prefix>
          )}
          <div className="relative w-full">
            <InputGroup.TextArea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              placeholder={isAndroid && !value ? t('chat.placeholderVoice') : t('chat.placeholder')}
              disabled={disabled && !streaming}
              rows={1}
              // `flex-none`: the input slot ships `flex-1`, which in this column
              // layout makes flex-basis, not `adjustHeight`, decide the height.
              className="min-h-6 max-h-[200px] w-full flex-none resize-none px-3.5 py-0"
            />
            {/* Hold-to-talk, as a layer rather than as handlers on the field.
                While it is up the textarea sees no touches at all, so there is
                no race with focus, the keyboard, or the text-selection action
                mode — and an empty field has nothing to select anyway. It
                disappears the moment there is text, leaving editing untouched. */}
            {isAndroid && !value && !disabled && !streaming && onVoiceSend && (
              <div
                data-slot="voice-press-layer"
                className="absolute inset-0 touch-none select-none"
                onPointerDown={androidVoice.handlePointerDown}
                onPointerMove={androidVoice.handlePointerMove}
                onPointerUp={androidVoice.handlePointerUp}
                onPointerCancel={androidVoice.handlePointerCancel}
                onContextMenu={(e) => e.preventDefault()}
              />
            )}
          </div>
          <InputGroup.Suffix className="w-full items-center gap-1 border-0 px-3 py-0">
            {isAndroid ? (
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
                onTakePhoto={handleTakePhoto}
                onPickGallery={handlePickGallery}
                onPickFile={handlePickFile}
                supportsImages={capabilities?.supports_images !== false}
              />
            ) : (
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
                onPickFile={
                  onAttachFiles && capabilities?.supports_images !== false
                    ? handlePickFile
                    : undefined
                }
              />
            )}
            <div className="ms-auto flex items-center gap-2 shrink-0">
              <EmojiPicker
                assistantId={currentAssistantId}
                onSelect={(syntax) => onChange(value + syntax)}
              />
              {/* A press target of its own. Holding the field works too, but an
                  empty composer is one line tall, which is a poor thing to aim
                  a thumb at — and nothing about it says it can be held. */}
              {isAndroid && onVoiceSend && !value && (
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label={t('chat.voice.holdToTalk')}
                  isDisabled={disabled || streaming}
                  className="touch-hitbox touch-none select-none text-muted"
                  onPointerDown={androidVoice.handlePointerDown}
                  onPointerMove={androidVoice.handlePointerMove}
                  onPointerUp={androidVoice.handlePointerUp}
                  onPointerCancel={androidVoice.handlePointerCancel}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <Microphone className="size-5" />
                </Button>
              )}
              {!isAndroid && onVoiceSend && (
                <Tooltip delay={0}>
                  {/* The button inside picks the tooltip's trigger props up from
                      context, so `Tooltip.Trigger` would only add a second,
                      inert tab stop around a real button. */}
                  <VoiceButton
                    aria-label={
                      voice.state === 'idle' ? t('chat.voice.tooltip') : t('chat.voice.cancelHint')
                    }
                    state={voice.state}
                    elapsed={voice.elapsed}
                    disabled={disabled || streaming}
                    onPointerDown={voice.handlePointerDown}
                    onPointerUp={voice.handlePointerUp}
                    onPointerCancel={voice.handlePointerCancel}
                    onPointerEnter={voice.handlePointerEnter}
                    onPointerLeave={voice.handlePointerLeave}
                  />
                  <Tooltip.Content placement="top">
                    {voice.state === 'idle' ? t('chat.voice.tooltip') : t('chat.voice.cancelHint')}
                  </Tooltip.Content>
                </Tooltip>
              )}
              {contextInfo && contextInfo.messageCount > 0 && (() => {
                const ratio = contextInfo.estimatedTokens / contextInfo.contextLimit
                // Below the warning threshold the ring is ambient, not a
                // reading — quieter than `color="default"`, which is a
                // foreground shade.
                const color = ratio > 0.95 ? 'danger' : ratio > 0.8 ? 'warning' : undefined
                // A popover rather than a tooltip. This panel has a button in
                // it, and a tooltip is not a place a button can live: it is
                // announced as a description, it closes when the pointer leaves
                // on the way to what it contains, and nothing in it is
                // reachable from the keyboard. That was already true of the
                // manual-compact link, which is why it needed a hand-rolled
                // `<button>` with a lint exemption to look right in there.
                return (
                  <Popover>
                    <Popover.Trigger
                      aria-label={t('chat.context.tokens', {
                        used: contextInfo.estimatedTokens.toLocaleString(),
                        limit: contextInfo.contextLimit.toLocaleString(),
                      })}
                      className="inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <ProgressCircle
                        aria-hidden
                        value={contextInfo.estimatedTokens}
                        maxValue={contextInfo.contextLimit}
                        isIndeterminate={compacting}
                        color={color}
                        className={
                          color && !compacting ? undefined : '[--progress-circle-stroke:var(--muted)]'
                        }
                      >
                        <ProgressCircle.Track className="size-4.5">
                          <ProgressCircle.TrackCircle />
                          <ProgressCircle.FillCircle />
                        </ProgressCircle.Track>
                      </ProgressCircle>
                    </Popover.Trigger>
                    <Popover.Content placement="top" className="max-w-64">
                      <Popover.Dialog className="flex flex-col gap-1 text-xs tabular-nums">
                        {compacting ? (
                          <span>{t('chat.compact.inProgress')}</span>
                        ) : (
                          <>
                            {/* Whose window this is. A delegated run has its own
                                model and its own limit, so the same percentage
                                means a different number of tokens — and the
                                conversation it was started from is one tap away,
                                which is exactly when that gets confusing. */}
                            <span className="text-muted">
                              {contextInfo.agentKind
                                ? t('chat.context.forSubAgent', {
                                  kind: t(`chat.subAgent.${contextInfo.agentKind === 'explore' ? 'explore' : 'agent'}`),
                                  model: contextInfo.model,
                                })
                                : contextInfo.model}
                            </span>
                            <span>{t('chat.context.messages', { count: contextInfo.messageCount })}</span>
                            <span>{t('chat.context.tokens', { used: contextInfo.estimatedTokens.toLocaleString(), limit: contextInfo.contextLimit.toLocaleString() })}</span>
                            {contextInfo.autoCompactEnabled && contextInfo.compactBreaker !== 'closed' ? (
                              // Before the countdown, and instead of it: "0% until
                              // auto-compact" next to a number that never moves
                              // reads as a bug in the indicator rather than as
                              // compaction having given up.
                              <span className="text-warning">{t('chat.compact.circuitBreakerOpen')}</span>
                            ) : contextInfo.autoCompactEnabled && contextInfo.autoCompactThreshold > 0 && (
                              <span>{Math.max(0, Math.round((1 - contextInfo.estimatedTokens / contextInfo.autoCompactThreshold) * 100))}% {t('chat.compact.untilAutoCompact')}</span>
                            )}
                            {onCompact && !streaming && (
                              <Button
                                variant="ghost"
                                className="mt-1 h-auto justify-start px-0 py-0 text-xs font-normal underline underline-offset-2"
                                onPress={onCompact}
                              >
                                {t('chat.compact.manual')}
                              </Button>
                            )}
                          </>
                        )}
                      </Popover.Dialog>
                    </Popover.Content>
                  </Popover>
                )
              })()}
              {/* TODO: a running sub-agent can be talked to, and this cannot say
                  it. `steer_conversation` and the whole queue protocol behind it
                  are done — a message goes into the run's inbox and the loop
                  takes it between rounds, including one typed while the last
                  words of an answer are being written. What is missing is a way
                  to send it: while `streaming` this swaps Send *out* for Stop,
                  so even with `disabled={false}` there is no submit control at
                  all.

                  Needs a `steerable` prop that renders both (Stop stops the run,
                  Send steers it), `sendMessage` routing to `steer_conversation`
                  when the conversation has a live turn — without touching
                  `submittingRef`, `streaming` or the optimistic assistant
                  bubble, since it starts no turn — an optimistic user bubble
                  that a later snapshot reconciles, and marking that bubble
                  undelivered when the command answers `Err` (the run had already
                  stopped reading). Attachments, voice and slash commands stay
                  hidden in that mode: each needs a turn's context, and steering
                  is precisely what does not create one.

                  The main conversation must keep the current behaviour — locked
                  composer, Stop only. Deferred with the rest of the composer
                  work until the HeroUI Pro change lands. */}
              {streaming ? (
                <Button
                  isIconOnly
                  size="sm"
                  aria-label={t('chat.stop')}
                  onClick={onStop}
                  className="rounded-full"
                >
                  <StopFill className="size-3.5" />
                </Button>
              ) : (
                <Button
                  isIconOnly
                  size="sm"
                  aria-label={t('chat.send')}
                  onClick={handleSubmit}
                  isDisabled={disabled || !value.trim()}
                  className="rounded-full"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </InputGroup.Suffix>
        </InputGroup>
        </TextField>
        </ComposerContextMenu>
      </div>
    </div>
  )
}
