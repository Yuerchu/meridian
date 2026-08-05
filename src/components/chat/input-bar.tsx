import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowUp, Square, Paperclip, X as XIcon, Scissors, Copy, ClipboardPaste, TextSelect } from 'lucide-react'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { CircularProgress } from '@/components/ui/circular-progress'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useVoiceRecorder, type VoiceNotice } from '@/hooks/use-voice-recorder'
import { VoiceButton } from '@/components/ui/voice-button'
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

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

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
    const paths = await open({ multiple: true })
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

  return (
    <div className="px-4 pb-[max(1rem,var(--safe-bottom))] pt-2">
      <div className="max-w-2xl mx-auto">
        {voiceNotice && (
          <p className="px-2 pb-1.5 text-xs text-muted">{voiceNotice}</p>
        )}
        <ContextMenu onOpenChange={handleContextMenuOpen}>
        <ContextMenuTrigger>
        <InputGroup className="rounded-2xl">
          {attachedFiles.length > 0 && (
            <AttachmentGroup className="px-3 pt-2.5">
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
                        className="hover:text-destructive"
                      >
                        <XIcon />
                      </AttachmentAction>
                    </AttachmentActions>
                  )}
                </Attachment>
              ))}
            </AttachmentGroup>
          )}
          <InputGroupTextarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            disabled={disabled && !streaming}
            rows={1}
            className="min-h-[24px] max-h-[200px] py-3 px-4"
          />
          <InputGroupAddon align="block-end" className="px-2 pb-2 pt-0">
            <div className="flex items-center justify-between w-full gap-1">
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
              <div className="flex items-center gap-2 shrink-0">
                <EmojiPicker
                  assistantId={currentAssistantId}
                  onSelect={(syntax) => onChange(value + syntax)}
                />
                {!isAndroid && onVoiceSend && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span>
                          <VoiceButton
                            state={voice.state}
                            elapsed={voice.elapsed}
                            disabled={disabled || streaming}
                            onPointerDown={voice.handlePointerDown}
                            onPointerUp={voice.handlePointerUp}
                            onPointerCancel={voice.handlePointerCancel}
                            onPointerEnter={voice.handlePointerEnter}
                            onPointerLeave={voice.handlePointerLeave}
                          />
                        </span>
                      }
                    />
                    <TooltipContent side="top">
                      {voice.state === 'idle' ? t('chat.voice.tooltip') : t('chat.voice.cancelHint')}
                    </TooltipContent>
                  </Tooltip>
                )}
                {contextInfo && contextInfo.messageCount > 0 && (() => {
                  const ratio = contextInfo.estimatedTokens / contextInfo.contextLimit
                  const colorClass = ratio > 0.95
                    ? 'text-destructive'
                    : ratio > 0.8
                      ? 'text-warning'
                      : 'text-muted/60'
                  return (
                    <Tooltip>
                      <TooltipTrigger className={compacting ? 'text-muted' : colorClass}>
                        <CircularProgress
                          value={contextInfo.estimatedTokens}
                          max={contextInfo.contextLimit}
                          size={18}
                          strokeWidth={2.5}
                          indeterminate={compacting}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="flex flex-col gap-1 text-xs tabular-nums">
                        {compacting ? (
                          <span>{t('chat.compact.inProgress')}</span>
                        ) : (
                          <>
                            <span>{t('chat.context.messages', { count: contextInfo.messageCount })}</span>
                            <span>{t('chat.context.tokens', { used: contextInfo.estimatedTokens.toLocaleString(), limit: contextInfo.contextLimit.toLocaleString() })}</span>
                            {contextInfo.autoCompactEnabled && contextInfo.autoCompactThreshold > 0 && (
                              <span>{Math.max(0, Math.round((1 - contextInfo.estimatedTokens / contextInfo.autoCompactThreshold) * 100))}% {t('chat.compact.untilAutoCompact')}</span>
                            )}
                            {onCompact && !streaming && (
                              <Button
                                variant="link"
                                className="mt-0.5 h-auto justify-start p-0 text-xs font-normal text-background/70 underline underline-offset-2 hover:text-background"
                                onClick={onCompact}
                              >
                                {t('chat.compact.manual')}
                              </Button>
                            )}
                          </>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  )
                })()}
                {streaming ? (
                  <InputGroupButton
                    size="icon-sm"
                    variant="default"
                    onClick={onStop}
                    className="rounded-full"
                  >
                    <Square className="size-3.5" fill="currentColor" />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    size="icon-sm"
                    variant="default"
                    onClick={onSubmit}
                    disabled={disabled || !value.trim()}
                    className="rounded-full"
                  >
                    <ArrowUp className="size-4" strokeWidth={2.5} />
                  </InputGroupButton>
                )}
              </div>
            </div>
          </InputGroupAddon>
        </InputGroup>
        </ContextMenuTrigger>
        <ContextMenuContent>
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
            <ClipboardPaste />
            {t('contextMenu.paste')}
            <span className="ml-auto text-xs text-muted">Ctrl+V</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleSelectAll}>
            <TextSelect />
            {t('contextMenu.selectAll')}
            <span className="ml-auto text-xs text-muted">Ctrl+A</span>
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  )
}
