import { useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowUp, Square, Paperclip, X as XIcon } from 'lucide-react'
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group'
import { Toolbar } from './toolbar'
import { EmojiPicker } from './emoji-picker'
import type { Assistant, Provider, ThinkingLevel } from '@/types'

interface ContextInfo {
  messageCount: number
  estimatedTokens: number
  contextLimit: number
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
  contextInfo,
  attachedFiles = [],
  onAttachFiles,
  onRemoveFile,
}: InputBarProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
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
        <InputGroup className="rounded-2xl">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {attachedFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted rounded-md">
                  <Paperclip className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">{f.name}</span>
                  {onRemoveFile && (
                    <button onClick={() => onRemoveFile(i)} className="hover:text-destructive">
                      <XIcon className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
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
              />
              <div className="flex items-center gap-2 shrink-0">
                {onAttachFiles && (
                  <button
                    className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
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
                  </button>
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
                    <span>↑ {contextInfo.estimatedTokens.toLocaleString()}</span>
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
      </div>
    </div>
  )
}
