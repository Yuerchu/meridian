import { useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { Button, InputGroup, TextField } from '@heroui/react'

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
      if (isSubmitKey(e)) {
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
          <span className="shimmer shimmer-duration-3000 text-lg font-medium text-muted">{t('chat.empty.subtitle')}</span>
        </h1>
        <TextField fullWidth aria-label={t('chat.placeholder')}>
          <InputGroup fullWidth className="flex flex-col gap-2 rounded-2xl py-2">
            <InputGroup.TextArea
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
              // `flex-none`: the input slot ships `flex-1`, which in this column
              // layout makes flex-basis, not `adjustHeight`, decide the height.
              className="min-h-6 max-h-[200px] w-full flex-none resize-none px-3.5 py-0"
            />
            <InputGroup.Suffix className="w-full items-center border-0 px-3 py-0">
              <Button
                isIconOnly
                size="sm"
                aria-label={t('chat.send')}
                onClick={handleSubmit}
                isDisabled={disabled || !value.trim()}
                className="ms-auto rounded-full"
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </Button>
            </InputGroup.Suffix>
          </InputGroup>
        </TextField>
      </div>
    </div>
  )
}
