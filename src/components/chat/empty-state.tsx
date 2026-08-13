import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Composer } from './composer'

interface EmptyStateProps {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function EmptyState({ onSubmit, disabled }: EmptyStateProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  const handleSubmit = useCallback(() => {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
  }, [value, disabled, onSubmit])

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-center mb-6">
          <span className="shimmer shimmer-duration-3000 text-lg font-medium text-muted">{t('chat.empty.subtitle')}</span>
        </h1>
        <Composer
          autoFocus
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          disabled={disabled}
          ariaLabel={t('chat.placeholder')}
          placeholder={t('chat.placeholder')}
        />
      </div>
    </div>
  )
}
