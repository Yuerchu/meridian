import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Check, RefreshCw, Trash2, Cloud, Key, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { api } from '@/api'
import type { Provider, ModelInfo } from '@/types'

function ProviderEditor({
  provider,
  onUpdate,
  onDelete,
}: {
  provider: Provider
  onUpdate: () => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(provider.name)
  const [providerType, setProviderType] = useState(provider.provider_type)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  useEffect(() => {
    api.getProviderKeyExists(provider.id).then(setHasKey)
  }, [provider.id])

  const handleSave = useCallback(async () => {
    await api.updateProvider(provider.id, { name, providerType, baseUrl })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onUpdate()
  }, [provider.id, name, providerType, baseUrl, onUpdate])

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return
    await api.setProviderKey(provider.id, apiKey.trim())
    setHasKey(true)
    setApiKey('')
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2000)
  }, [provider.id, apiKey])

  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true)
    setModelsError(null)
    try {
      const list = await api.fetchProviderModels(provider.id)
      setModels(list)
    } catch (err) {
      setModelsError(String(err))
    }
    setFetchingModels(false)
  }, [provider.id])

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.provider.name')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.provider.type')}</label>
        <Select value={providerType} onValueChange={(v) => v && setProviderType(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">{t('settings.provider.typeOpenAI')}</SelectItem>
            <SelectItem value="anthropic">{t('settings.provider.typeAnthropic')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.provider.baseUrl')}</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={providerType === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave}>{t('common.save')}</Button>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] text-green-400">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <label className="block text-[11px] text-muted-foreground">{t('settings.provider.apiKey')}</label>
        <div className="flex gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? t('settings.provider.apiKeyPlaceholderSet') : t('settings.provider.apiKeyPlaceholder')}
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={handleSaveKey} disabled={!apiKey.trim()}>
            <Key className="w-3 h-3" />
            {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
          </Button>
        </div>
        {hasKey && (
          <p className="text-[11px] text-green-600">{t('settings.provider.keySaved')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-muted-foreground">{t('settings.provider.models')}</label>
          <Button variant="outline" size="sm" onClick={handleFetchModels} disabled={fetchingModels || !hasKey}>
            <RefreshCw className={cn("w-3 h-3", fetchingModels && "animate-spin")} />
            {t('settings.provider.fetchModels')}
          </Button>
        </div>
        {modelsError && (
          <p className="text-[11px] text-destructive break-all">{modelsError}</p>
        )}
        {models.length > 0 && (
          <ScrollArea className="max-h-60 border border-border rounded-lg">
            {models.map((m) => (
              <div key={m.id} className="px-3 py-1.5 text-xs text-foreground border-b border-border last:border-0">
                {m.name}
              </div>
            ))}
          </ScrollArea>
        )}
        {models.length === 0 && !fetchingModels && !modelsError && (
          <p className="text-[11px] text-muted-foreground">{t('settings.provider.fetchModelsHint')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDelete(provider.id)}>
          <Trash2 className="w-3 h-3" />
          {t('settings.provider.deleteProvider')}
        </Button>
      </div>
    </div>
  )
}

export function ProviderSettings() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const list = await api.listProviders()
    setProviders(list)
    return list
  }, [])

  useEffect(() => {
    refresh().then((list) => {
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id)
      }
      setLoading(false)
    })
  }, [refresh, selectedId])

  const handleCreate = useCallback(async () => {
    const p = await api.createProvider('New Provider', 'openai', 'https://api.openai.com/v1')
    await refresh()
    setSelectedId(p.id)
  }, [refresh])

  const handleDelete = useCallback(async (id: string) => {
    await api.deleteProvider(id)
    const list = await refresh()
    if (selectedId === id) {
      setSelectedId(list.length > 0 ? list[0].id : null)
    }
  }, [selectedId, refresh])

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
  }

  const selected = providers.find((p) => p.id === selectedId)

  const providerList = (
    <>
      {providers.map((p) => (
        <button
          key={p.id}
          onClick={() => setSelectedId(p.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
            selectedId === p.id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          <Cloud className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{p.name}</span>
        </button>
      ))}
      {providers.length === 0 && (
        <p className="text-xs text-muted-foreground px-3">{t('settings.provider.noProviders')}</p>
      )}
    </>
  )

  if (isMobile) {
    return (
      <div className="max-w-3xl">
        {selected ? (
          <>
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-2 text-sm text-muted-foreground mb-4 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back')}
            </button>
            <ProviderEditor
              key={selected.id}
              provider={selected}
              onUpdate={refresh}
              onDelete={handleDelete}
            />
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium">{t('settings.provider.title')}</h2>
              <Button variant="ghost" size="icon" onClick={handleCreate} title={t('settings.provider.addProvider')}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {providerList}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-6 max-w-3xl">
      <div className="w-44 flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">{t('settings.provider.title')}</h2>
          <Button variant="ghost" size="icon" onClick={handleCreate} title={t('settings.provider.addProvider')}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {providerList}
      </div>

      <div className="flex-1 min-w-0">
        {selected ? (
          <ProviderEditor
            key={selected.id}
            provider={selected}
            onUpdate={refresh}
            onDelete={handleDelete}
          />
        ) : (
          <div className="text-sm text-muted-foreground">{t('settings.provider.selectProvider')}</div>
        )}
      </div>
    </div>
  )
}
