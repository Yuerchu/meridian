import { useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import ShinyText from '@/components/ShinyText'
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group'

interface EmptyStateProps {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function EmptyState({ onSubmit, disabled }: EmptyStateProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  const handleSubmit = useCallback(() => {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
  }, [value, disabled, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-center mb-6">
          <ShinyText text={t('chat.empty.subtitle')} speed={3} className="text-lg font-medium text-muted-foreground" />
        </h1>
        <InputGroup className="rounded-2xl">
          <InputGroupTextarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            disabled={disabled}
            rows={1}
            autoFocus
            className="min-h-[24px] max-h-[200px] py-3 px-4"
          />
          <InputGroupAddon align="block-end" className="px-2 pb-2 pt-0">
            <div className="flex items-center justify-end w-full">
              <InputGroupButton
                size="icon-sm"
                variant="default"
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                className="rounded-full"
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}
