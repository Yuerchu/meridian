import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowUp, Square, Paperclip, X as XIcon, Scissors, Copy, ClipboardPaste, TextSelect } from 'lucide-react'
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
import CountUp from '@/components/CountUp'
import { usePrevious } from '@/hooks/use-previous'
import { Toolbar } from './toolbar'
import { EmojiPicker } from './emoji-picker'
import type { Assistant, Provider, ProviderCapabilities, ThinkingLevel } from '@/types'

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
  capabilities?: ProviderCapabilities | null
  contextInfo?: ContextInfo
}

export function InputBar({
  value,
  onChange,
  onSubmit,
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
  capabilities,
  contextInfo,
  attachedFiles = [],
  onAttachFiles,
  onRemoveFile,
}: InputBarProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevTokens = usePrevious(contextInfo?.estimatedTokens ?? 0)
  const [selectedText, setSelectedText] = useState('')

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!disabled && value.trim()) {
          onSubmit()
        }
      }
    },
    [disabled, value, onSubmit],
  )

  return (
    <div className="px-4 pb-[max(1rem,var(--safe-bottom))] pt-2">
      <div className="max-w-2xl mx-auto">
        <ContextMenu onOpenChange={handleContextMenuOpen}>
        <ContextMenuTrigger>
        <InputGroup className="rounded-2xl">
          {attachedFiles.length > 0 && (
            <AttachmentGroup className="px-3 pt-2.5">
              {attachedFiles.map((f, i) => (
                <Attachment key={i} size="xs" state="done">
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
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            disabled={disabled && !streaming}
            rows={1}
            className="min-h-[24px] max-h-[200px] py-3 px-4"
          />
          <InputGroupAddon align="block-end" className="px-2 pb-2 pt-0">
            <div className="flex items-center justify-between w-full gap-1">
              <Toolbar
                assistants={assistants}
                providers={providers}
                currentAssistantId={currentAssistantId}
                currentModelId={currentModelId}
                currentProviderId={currentProviderId}
                onSelectAssistant={onSelectAssistant}
                onSelectModel={onSelectModel}
                thinkingLevel={thinkingLevel}
                onSelectThinkingLevel={onSelectThinkingLevel}
                capabilities={capabilities}
              />
              <div className="flex items-center gap-2 shrink-0">
                {onAttachFiles && capabilities?.supports_images !== false && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    title={t('chat.attach')}
                    onClick={async () => {
                      const paths = await open({ multiple: true })
                      if (paths) {
                        const files = (Array.isArray(paths) ? paths : [paths]).map((p) => ({
                          path: p,
                          name: p.replace(/\\/g, '/').split('/').pop() ?? 'file',
                        }))
                        onAttachFiles(files)
                      }
                    }}
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                )}
                <EmojiPicker
                  assistantId={currentAssistantId}
                  onSelect={(syntax) => onChange(value + syntax)}
                />
                {contextInfo && contextInfo.messageCount > 0 && (
                  <div className={`flex items-center gap-1.5 text-[11px] ${
                    contextInfo.estimatedTokens / contextInfo.contextLimit > 0.95
                      ? 'text-destructive'
                      : contextInfo.estimatedTokens / contextInfo.contextLimit > 0.8
                        ? 'text-yellow-500'
                        : 'text-muted-foreground/60'
                  }`}>
                    <span>≡ {contextInfo.messageCount}</span>
                    <span>↑ <CountUp from={prevTokens ?? 0} to={contextInfo.estimatedTokens} duration={0.8} separator="," /></span>
                    {contextInfo.autoCompactEnabled && contextInfo.autoCompactThreshold > 0 && (
                      <span className={
                        contextInfo.estimatedTokens / contextInfo.autoCompactThreshold > 0.95
                          ? 'text-destructive'
                          : contextInfo.estimatedTokens / contextInfo.autoCompactThreshold > 0.8
                            ? 'text-yellow-500'
                            : ''
                      }>
                        {Math.max(0, Math.round((1 - contextInfo.estimatedTokens / contextInfo.autoCompactThreshold) * 100))}% {t('chat.compact.untilAutoCompact')}
                      </span>
                    )}
                  </div>
                )}
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
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+X</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={handleCopy}>
                <Copy />
                {t('chat.copy')}
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onClick={handlePaste}>
            <ClipboardPaste />
            {t('contextMenu.paste')}
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+V</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleSelectAll}>
            <TextSelect />
            {t('contextMenu.selectAll')}
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+A</span>
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  )
}
