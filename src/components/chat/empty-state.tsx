import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useIsOffline } from '@/hooks/use-connection-state'
import { Composer } from './composer'

interface EmptyStateProps {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function EmptyState({ onSubmit, disabled }: EmptyStateProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  // The same rule as the composer in a conversation: creating one on a machine
  // that is not answering fails, so the field does not pretend otherwise.
  const offline = useIsOffline()
  const locked = disabled || offline

  const handleSubmit = useCallback(() => {
    const text = value.trim()
    if (!text || locked) return
    onSubmit(text)
  }, [value, locked, onSubmit])

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-center mb-6">
          <span className="shimmer shimmer-duration-3000 text-lg font-medium text-muted">
            {t('chat.empty.subtitle')}
          </span>
        </h1>
        <Composer
          autoFocus
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          disabled={locked}
          ariaLabel={t('chat.placeholder')}
          placeholder={t('chat.placeholder')}
          notice={
            offline ? <p className="px-2 pb-1.5 text-xs text-danger">{t('settings.client.composerOffline')}</p> : null
          }
        />
      </div>
    </div>
  )
}
