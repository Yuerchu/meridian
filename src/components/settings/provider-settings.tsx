import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Check, RefreshCw, Trash2, Cloud, Key, ArrowLeft, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { api } from '@/api'
import type { ModelConfig, ModelConfigInput, Provider, ModelInfo, ProviderCapabilities } from '@/types'

function ModelConfigEditor({
  providerId,
  modelId,
  existing,
  onSave,
  onDelete,
}: {
  providerId: string
  modelId: string
  existing?: ModelConfig
  onSave: (input: ModelConfigInput) => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const [caps, setCaps] = useState<ProviderCapabilities | null>(null)

  useEffect(() => {
    api.getProviderCapabilities(providerId, modelId).then(setCaps).catch(() => {})
  }, [providerId, modelId])

  const defaultCtx = existing?.context_window ?? caps?.max_context_tokens ?? 128000
  const defaultThreshold = existing?.compact_threshold ?? Math.round(defaultCtx * 0.9)
  const defaultMaxOut = existing?.max_output_tokens ?? caps?.max_output_tokens ?? null

  const [contextWindow, setContextWindow] = useState(defaultCtx.toString())
  const [compactThreshold, setCompactThreshold] = useState(defaultThreshold.toString())
  const [maxOutput, setMaxOutput] = useState(defaultMaxOut?.toString() ?? '')
  const [inputPrice, setInputPrice] = useState(existing?.input_price?.toString() ?? '0')
  const [outputPrice, setOutputPrice] = useState(existing?.output_price?.toString() ?? '0')
  const [cachePrice, setCachePrice] = useState(existing?.cache_price?.toString() ?? '')

  useEffect(() => {
    if (!existing && caps) {
      setContextWindow((caps.max_context_tokens ?? 128000).toString())
      setCompactThreshold(Math.round((caps.max_context_tokens ?? 128000) * 0.9).toString())
      if (caps.max_output_tokens) setMaxOutput(caps.max_output_tokens.toString())
    }
  }, [caps, existing])

  const handleSave = () => {
    onSave({
      provider_id: providerId,
      model_id: modelId,
      context_window: parseInt(contextWindow) || 128000,
      compact_threshold: parseInt(compactThreshold) || 100000,
      max_output_tokens: maxOutput ? parseInt(maxOutput) : null,
      input_price: parseFloat(inputPrice) || 0,
      output_price: parseFloat(outputPrice) || 0,
      cache_price: cachePrice ? parseFloat(cachePrice) : null,
    })
  }

  return (
    <div className="px-3 pb-3 space-y-2 bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">{t('settings.model.contextWindow')}</label>
          <Input value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('settings.model.compactThreshold')}</label>
          <Input value={compactThreshold} onChange={(e) => setCompactThreshold(e.target.value)} className="h-7 text-xs" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">{t('settings.model.maxOutput')}</label>
        <Input value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} placeholder={t('settings.model.optional')} className="h-7 text-xs" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">{t('settings.model.inputPrice')}</label>
          <Input value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('settings.model.outputPrice')}</label>
          <Input value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('settings.model.cachePrice')}</label>
          <Input value={cachePrice} onChange={(e) => setCachePrice(e.target.value)} placeholder="—" className="h-7 text-xs" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave}>{t('common.save')}</Button>
        {onDelete && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

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
  const [apiFormat, setApiFormat] = useState(provider.api_format || 'chat_completions')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelConfigs, setModelConfigs] = useState<Map<string, ModelConfig>>(new Map())
  const [editingModelId, setEditingModelId] = useState<string | null>(null)

  useEffect(() => {
    api.getProviderKeyExists(provider.id).then(setHasKey)
  }, [provider.id])

  const handleSave = useCallback(async () => {
    await api.updateProvider(provider.id, { name, providerType, baseUrl, apiFormat })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onUpdate()
  }, [provider.id, name, providerType, baseUrl, apiFormat, onUpdate])

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return
    try {
      await api.setProviderKey(provider.id, apiKey.trim())
      setHasKey(true)
      setApiKey('')
      setKeySaved(true)
      setTimeout(() => setKeySaved(false), 2000)
    } catch (err) {
      console.error('Failed to save key:', err)
      alert(String(err))
    }
  }, [provider.id, apiKey])

  const loadModelConfigs = useCallback(async () => {
    try {
      const configs = await api.listModelConfigs(provider.id)
      const map = new Map<string, ModelConfig>()
      for (const c of configs) map.set(c.model_id, c)
      setModelConfigs(map)
    } catch { /* ignore */ }
  }, [provider.id])

  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true)
    setModelsError(null)
    try {
      const list = await api.fetchProviderModels(provider.id, true)
      setModels(list)
      await loadModelConfigs()
    } catch (err) {
      setModelsError(String(err))
    }
    setFetchingModels(false)
  }, [provider.id, loadModelConfigs])

  useEffect(() => { loadModelConfigs() }, [loadModelConfigs])

  const handleSaveModelConfig = useCallback(async (input: ModelConfigInput) => {
    await api.saveModelConfig(input)
    await loadModelConfigs()
    setEditingModelId(null)
  }, [loadModelConfigs])

  const handleDeleteModelConfig = useCallback(async (id: string) => {
    await api.deleteModelConfig(id)
    await loadModelConfigs()
    setEditingModelId(null)
  }, [loadModelConfigs])

  const typeOptions = [
    { value: 'openai', label: t('settings.provider.typeOpenAI') },
    { value: 'anthropic', label: t('settings.provider.typeAnthropic') },
  ]
  const formatOptions = [
    { value: 'responses', label: t('settings.provider.apiFormatResponses') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatChatCompletions') },
    { value: 'gemma_tool', label: t('settings.provider.apiFormatGemmaTool') },
  ]

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-xs text-muted-foreground">{t('settings.provider.name')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted-foreground">{t('settings.provider.type')}</label>
        <Select value={providerType} onValueChange={(v) => v && setProviderType(v)} items={typeOptions}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted-foreground">{t('settings.provider.baseUrl')}</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={providerType === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
        />
      </div>

      {providerType !== 'anthropic' && (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted-foreground">{t('settings.provider.apiFormat')}</label>
          <Select value={apiFormat} onValueChange={(v) => v && setApiFormat(v)} items={formatOptions}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formatOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>{t('common.save')}</Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <label className="block text-xs text-muted-foreground">{t('settings.provider.apiKey')}</label>
        <div className="flex gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? t('settings.provider.apiKeyPlaceholderSet') : t('settings.provider.apiKeyPlaceholder')}
            className="flex-1"
          />
          <Button variant="outline" onClick={handleSaveKey} disabled={!apiKey.trim()}>
            <Key className="w-3 h-3" />
            {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
          </Button>
        </div>
        {hasKey && (
          <p className="text-xs text-success">{t('settings.provider.keySaved')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">{t('settings.provider.models')}</label>
          <Button variant="outline" onClick={handleFetchModels} disabled={fetchingModels || !hasKey}>
            <RefreshCw className={cn("w-3 h-3", fetchingModels && "animate-spin")} />
            {t('settings.provider.fetchModels')}
          </Button>
        </div>
        {modelsError && (
          <p className="text-xs text-destructive break-all">{modelsError}</p>
        )}
        {models.length > 0 && (
          <ScrollArea className="h-60 border border-border rounded-lg">
            {models.map((m) => {
              const cfg = modelConfigs.get(m.id)
              const isEditing = editingModelId === m.id
              return (
                <div key={m.id} className="border-b border-border last:border-0">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className={cn("text-xs", cfg ? "text-foreground" : "text-muted-foreground")}>
                      {m.name}
                      {cfg && <span className="ml-1.5 text-xs text-success">●</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setEditingModelId(isEditing ? null : m.id)}
                    >
                      {isEditing ? <X className="w-3 h-3" /> : <Settings2 className="w-3 h-3" />}
                    </Button>
                  </div>
                  {isEditing && (
                    <ModelConfigEditor
                      providerId={provider.id}
                      modelId={m.id}
                      existing={cfg}
                      onSave={handleSaveModelConfig}
                      onDelete={cfg ? () => handleDeleteModelConfig(cfg.id) : undefined}
                    />
                  )}
                </div>
              )
            })}
          </ScrollArea>
        )}
        {models.length === 0 && !fetchingModels && !modelsError && (
          <p className="text-xs text-muted-foreground">{t('settings.provider.fetchModelsHint')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(provider.id)}>
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
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    const list = await api.listProviders()
    setProviders(list)
    return list
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    refresh().then((list) => {
      if (list.length > 0 && !isMobile) {
        setSelectedId(list[0].id)
      }
      setLoading(false)
    })
  }, [refresh, isMobile])

  const handleCreate = useCallback(async () => {
    const p = await api.createProvider('New Provider', 'openai', 'https://api.openai.com/v1', 'responses')
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
        <Button
          key={p.id}
          variant="ghost"
          onClick={() => setSelectedId(p.id)}
          className={cn(
            'w-full justify-start h-auto px-3 py-2 text-sm',
            selectedId === p.id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          <Cloud className="w-4 h-4" />
          <span className="truncate">{p.name}</span>
        </Button>
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
            <Button
              variant="ghost"
              onClick={() => setSelectedId(null)}
              className="text-sm text-muted-foreground mb-4 hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back')}
            </Button>
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
