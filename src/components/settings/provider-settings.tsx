import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Check, ArrowsRotateRight, TrashBin, Cloud, Key, ArrowLeft, Sliders, Xmark } from '@gravity-ui/icons'
import { Button, Disclosure, Input, ListBox, Select, Spinner, Tooltip } from '@heroui/react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { api } from '@/api'
import { EFFORT_LADDER } from '@/lib/thinking'
import type { ModelConfig, ModelConfigInput, Provider, ModelInfo, ProviderCapabilities, ThinkingEffort } from '@/types'

/**
 * Capability overrides are tri-state on purpose. A plain checkbox cannot express
 * "inherit", so the first save would pin every capability to its current value
 * and the model would stop receiving catalog updates forever.
 */
type Tri = 'auto' | 'on' | 'off'

function triFrom(value: unknown): Tri {
  // Anything that isn't a real boolean (missing key, or a hand-edited override
  // holding junk) reads as "inherit".
  return typeof value === 'boolean' ? (value ? 'on' : 'off') : 'auto'
}

function triTo(tri: Tri): boolean | undefined {
  return tri === 'auto' ? undefined : tri === 'on'
}

/** Malformed overrides degrade to catalog behaviour on both ends, never throw. */
function parseOverrides(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function CapabilityTriRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: Tri
  onChange: (next: Tri) => void
}) {
  const { t } = useTranslation()
  const options: Array<{ value: Tri; label: string }> = [
    { value: 'auto', label: t('settings.model.capAuto') },
    { value: 'on', label: t('settings.model.capOn') },
    { value: 'off', label: t('settings.model.capOff') },
  ]
  return (
    <div data-slot="capability-tri-row" className="flex items-center justify-between gap-2">
      <label className="text-xs text-muted">{label}</label>
      <Select value={value} onChange={(v) => v && onChange(String(v) as Tri)}>
        <Select.Trigger className="h-7 w-32 text-xs">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {options.map((o) => (
              <ListBox.Item key={o.value} id={o.value} textValue={o.label} className="text-xs">
                {o.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  )
}

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

  const [showCaps, setShowCaps] = useState(false)
  const [efforts, setEfforts] = useState<ThinkingEffort[]>([])
  // Tracks whether the whitelist was touched. Untouched means the key is left
  // out of the patch entirely, so the model keeps following catalog updates.
  const [effortsDirty, setEffortsDirty] = useState(false)
  const [capThinking, setCapThinking] = useState<Tri>('auto')
  const [capFast, setCapFast] = useState<Tri>('auto')

  useEffect(() => {
    if (!existing && caps) {
      setContextWindow((caps.max_context_tokens ?? 128000).toString())
      setCompactThreshold(Math.round((caps.max_context_tokens ?? 128000) * 0.9).toString())
      if (caps.max_output_tokens) setMaxOutput(caps.max_output_tokens.toString())
    }
  }, [caps, existing])

  // Seed the override editor from the *resolved* capabilities so the user edits
  // a diff of reality rather than a blank slate.
  useEffect(() => {
    if (!caps) return
    const saved = parseOverrides(existing?.capability_overrides)
    setEfforts(EFFORT_LADDER.filter((e) => (caps.supported_efforts ?? EFFORT_LADDER).includes(e)))
    setEffortsDirty(saved.supported_efforts !== undefined)
    setCapThinking(triFrom(saved.supports_thinking))
    setCapFast(triFrom(saved.supports_fast))
  }, [caps, existing])

  const buildOverrides = (): string | null => {
    // Merge into whatever is stored so keys this editor doesn't know about
    // survive a round-trip.
    const next: Record<string, unknown> = { ...parseOverrides(existing?.capability_overrides) }
    const put = (key: string, value: unknown) => {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    put('supported_efforts', effortsDirty ? efforts : undefined)
    put('supports_thinking', triTo(capThinking))
    put('supports_fast', triTo(capFast))
    return Object.keys(next).length > 0 ? JSON.stringify(next) : null
  }

  const resetOverrides = () => {
    setEffortsDirty(false)
    setCapThinking('auto')
    setCapFast('auto')
    if (caps) setEfforts(EFFORT_LADDER.filter((e) => (caps.supported_efforts ?? EFFORT_LADDER).includes(e)))
  }

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
      capability_overrides: buildOverrides(),
    })
  }

  return (
    <div className="px-3 pb-3 space-y-2 bg-default/30">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted">{t('settings.model.contextWindow')}</label>
          <Input fullWidth value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="text-xs text-muted">{t('settings.model.compactThreshold')}</label>
          <Input fullWidth value={compactThreshold} onChange={(e) => setCompactThreshold(e.target.value)} className="h-7 text-xs" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted">{t('settings.model.maxOutput')}</label>
        <Input fullWidth value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} placeholder={t('settings.model.optional')} className="h-7 text-xs" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-muted">{t('settings.model.inputPrice')}</label>
          <Input fullWidth value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="text-xs text-muted">{t('settings.model.outputPrice')}</label>
          <Input fullWidth value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="text-xs text-muted">{t('settings.model.cachePrice')}</label>
          <Input fullWidth value={cachePrice} onChange={(e) => setCachePrice(e.target.value)} placeholder="—" className="h-7 text-xs" />
        </div>
      </div>
      <Disclosure
        data-slot="capability-overrides"
        className="pt-1"
        isExpanded={showCaps}
        onExpandedChange={setShowCaps}
      >
        <Disclosure.Heading>
          {/* `inline-flex`, not `flex`: a block-level flex row would stretch the
              trigger across the form and the indicator's own `ms-auto` would
              fling the chevron to the far edge. */}
          <Disclosure.Trigger className="inline-flex items-center gap-1 rounded-md text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50">
            {t('settings.model.capabilities')}
            <Disclosure.Indicator className="size-3.5" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content className="min-h-0 w-full">
          {/* Body, not a plain wrapper: it is what keeps the panel measurable,
              so without it the overrides never collapse. */}
          <Disclosure.Body className="space-y-2">
            <div data-slot="effort-whitelist" className="space-y-1.5">
              <label className="text-xs text-muted">{t('settings.model.supportedEfforts')}</label>
              <div className="flex flex-wrap gap-1">
                {EFFORT_LADDER.map((tier) => {
                  const on = efforts.includes(tier)
                  return (
                    <Button
                      key={tier}
                      data-slot="effort-chip"
                      variant={on ? 'primary' : 'outline'}
                      size="sm"
                      aria-pressed={on}
                      className="h-6 px-2 text-xs font-normal"
                      onClick={() => {
                        // Rebuild from the ladder so the stored array stays in
                        // ascending order -- the median coercion ranks on position.
                        setEfforts(EFFORT_LADDER.filter((x) => (x === tier ? !on : efforts.includes(x))))
                        setEffortsDirty(true)
                      }}
                    >
                      {t(`toolbar.thinking.${tier}`)}
                    </Button>
                  )
                })}
              </div>
            </div>
            <CapabilityTriRow label={t('settings.model.capThinking')} value={capThinking} onChange={setCapThinking} />
            <CapabilityTriRow label={t('settings.model.capFast')} value={capFast} onChange={setCapFast} />
            <p className="text-xs text-muted/60">{t('settings.model.capabilitiesHint')}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-0 text-xs text-muted hover:text-foreground"
              onClick={resetOverrides}
            >
              {t('settings.model.capReset')}
            </Button>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave}>{t('common.save')}</Button>
        {onDelete && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-danger" onClick={onDelete}>
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
  /// Awaited so the button can show progress until the list has reloaded.
  onDelete: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(provider.name)
  const [providerType, setProviderType] = useState(provider.provider_type)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [apiFormat, setApiFormat] = useState(provider.api_format || 'chat_completions')
  const [apiKey, setApiKey] = useState('')
  // Not a boolean: while the lookup is in flight `false` renders exactly like
  // "no key configured", and so does a lookup that failed. Both would invite the
  // user to enter a key they already have — and saving one rewrites the store
  // under a fresh passphrase, which is how the *other* providers' keys get lost.
  const [keyStatus, setKeyStatus] = useState<'loading' | 'set' | 'unset' | 'error'>('loading')
  const [savingKey, setSavingKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelConfigs, setModelConfigs] = useState<Map<string, ModelConfig>>(new Map())
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Deletion clears secrets and cached models before the list reloads, so the
  // button has to stay disabled and say what it is doing — otherwise a slow
  // delete looks like a click that did not register, and a second click races
  // the first.
  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await onDelete(provider.id)
    } finally {
      setDeleting(false)
    }
  }, [onDelete, provider.id])

  useEffect(() => {
    let cancelled = false
    setKeyStatus('loading')
    api
      .getProviderKeyExists(provider.id)
      .then((exists) => {
        if (!cancelled) setKeyStatus(exists ? 'set' : 'unset')
      })
      .catch((err) => {
        console.error('Failed to check for a saved key:', err)
        if (!cancelled) setKeyStatus('error')
      })
    return () => { cancelled = true }
  }, [provider.id])

  const handleSave = useCallback(async () => {
    await api.updateProvider(provider.id, { name, providerType, baseUrl, apiFormat })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onUpdate()
  }, [provider.id, name, providerType, baseUrl, apiFormat, onUpdate])

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await api.setProviderKey(provider.id, apiKey.trim())
      setKeyStatus('set')
      setApiKey('')
      setKeySaved(true)
      setTimeout(() => setKeySaved(false), 2000)
    } catch (err) {
      console.error('Failed to save key:', err)
      alert(String(err))
    } finally {
      setSavingKey(false)
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
    // Previously unreachable from the UI, which silently sent every DeepSeek
    // provider down the generic path with reasoning support switched off.
    { value: 'deepseek', label: t('settings.provider.typeDeepSeek') },
  ]
  const formatOptions = [
    { value: 'responses', label: t('settings.provider.apiFormatResponses') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatChatCompletions') },
    { value: 'gemma_tool', label: t('settings.provider.apiFormatGemmaTool') },
  ]

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.provider.name')}</label>
        <Input fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.provider.type')}</label>
        <Select fullWidth value={providerType} onChange={(v) => v && setProviderType(String(v))}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {typeOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.provider.baseUrl')}</label>
        <Input fullWidth
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={providerType === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
        />
      </div>

      {providerType !== 'anthropic' && (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">{t('settings.provider.apiFormat')}</label>
          <Select fullWidth value={apiFormat} onChange={(v) => v && setApiFormat(String(v))}>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {formatOptions.map((o) => (
                  <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                    {o.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>{t('common.save')}</Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" /> {t('common.saved')}
          </span>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <label className="block text-xs text-muted">{t('settings.provider.apiKey')}</label>
        <div className="flex gap-2">
          <Input fullWidth
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={keyStatus === 'loading' || savingKey}
            placeholder={
              keyStatus === 'loading'
                ? t('settings.provider.apiKeyChecking')
                : keyStatus === 'set'
                  ? t('settings.provider.apiKeyPlaceholderSet')
                  : t('settings.provider.apiKeyPlaceholder')
            }
            className="flex-1"
          />
          <Button
            variant="outline"
            onClick={handleSaveKey}
            isDisabled={!apiKey.trim() || savingKey || keyStatus === 'loading'}
          >
            {savingKey ? <Spinner className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
            {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
          </Button>
        </div>
        {keyStatus === 'loading' && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Spinner className="w-3.5 h-3.5" />
            {t('settings.provider.apiKeyChecking')}
          </p>
        )}
        {keyStatus === 'set' && (
          <p className="text-xs text-success">{t('settings.provider.keySaved')}</p>
        )}
        {keyStatus === 'error' && (
          <p className="text-xs text-warning">{t('settings.provider.apiKeyCheckFailed')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">{t('settings.provider.models')}</label>
          <Button
            variant="outline"
            onClick={handleFetchModels}
            isDisabled={fetchingModels || keyStatus !== 'set'}
          >
            <ArrowsRotateRight className={cn("w-3.5 h-3.5", fetchingModels && "animate-spin")} />
            {t('settings.provider.fetchModels')}
          </Button>
        </div>
        {modelsError && (
          <p className="text-xs text-danger break-all">{modelsError}</p>
        )}
        {models.length > 0 && (
          <div
            data-slot="provider-model-list"
            className="h-60 overflow-y-auto overscroll-contain border border-border rounded-lg"
          >
            {models.map((m) => {
              const cfg = modelConfigs.get(m.id)
              const isEditing = editingModelId === m.id
              return (
                <div key={m.id} className="border-b border-border last:border-0">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className={cn("text-xs", cfg ? "text-foreground" : "text-muted")}>
                      {m.name}
                      {cfg && <span className="ml-1.5 text-xs text-success">●</span>}
                    </span>
                    <Button
                      isIconOnly
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setEditingModelId(isEditing ? null : m.id)}
                    >
                      {isEditing ? <Xmark className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5" />}
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
          </div>
        )}
        {models.length === 0 && !fetchingModels && !modelsError && (
          <p className="text-xs text-muted">{t('settings.provider.fetchModelsHint')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <Button
          variant="ghost"
          className="text-danger hover:text-danger"
          onClick={handleDelete}
          isDisabled={deleting}
        >
          {deleting ? <Spinner className="w-3.5 h-3.5" /> : <TrashBin className="w-3.5 h-3.5" />}
          {deleting ? t('settings.provider.deletingProvider') : t('settings.provider.deleteProvider')}
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
    return <div className="text-muted text-sm">{t('common.loading')}</div>
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
              ? 'bg-default text-default-foreground'
              : 'text-muted hover:text-foreground hover:bg-default/50',
          )}
        >
          <Cloud className="w-4 h-4" />
          <span className="truncate">{p.name}</span>
        </Button>
      ))}
      {providers.length === 0 && (
        <p className="text-xs text-muted px-3">{t('settings.provider.noProviders')}</p>
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
              className="text-sm text-muted mb-4 hover:text-foreground"
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
              <Tooltip delay={0}>
                <Button
                  isIconOnly
                  aria-label={t('settings.provider.addProvider')}
                  variant="ghost"
                  onClick={handleCreate}
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Tooltip.Content placement="top">{t('settings.provider.addProvider')}</Tooltip.Content>
              </Tooltip>
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
          <Tooltip delay={0}>
            <Button
              isIconOnly
              aria-label={t('settings.provider.addProvider')}
              variant="ghost"
              onClick={handleCreate}
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Tooltip.Content placement="top">{t('settings.provider.addProvider')}</Tooltip.Content>
          </Tooltip>
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
          <div className="text-sm text-muted">{t('settings.provider.selectProvider')}</div>
        )}
      </div>
    </div>
  )
}
