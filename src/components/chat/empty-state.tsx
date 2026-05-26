import { useTranslation } from 'react-i18next'
import { Compass, Code, Languages } from 'lucide-react'

interface EmptyStateProps {
  onCreate: () => void
}

export function EmptyState({ onCreate }: EmptyStateProps) {
  const { t } = useTranslation()

  const suggestions = [
    { icon: Compass, textKey: 'chat.empty.suggest.explain', color: 'text-blue-400' },
    { icon: Code, textKey: 'chat.empty.suggest.code', color: 'text-green-400' },
    { icon: Languages, textKey: 'chat.empty.suggest.translate', color: 'text-purple-400' },
  ]

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">{t('chat.empty.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('chat.empty.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-sm">
        {suggestions.map((s) => (
          <button
            key={s.textKey}
            onClick={onCreate}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:border-muted-foreground hover:bg-accent/50 text-sm text-foreground text-left transition-colors"
          >
            <s.icon className={`w-4 h-4 flex-shrink-0 ${s.color}`} />
            <span>{t(s.textKey)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
