import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ChevronDown, ChevronRight, Star, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/api'
import type { Assistant, Provider, ModelInfo, ToolInfo } from '@/types'

function AssistantEditor({
  assistant,
  providers,
  onSave,
  onDelete,
}: {
  assistant: Assistant
  providers: Provider[]
  onSave: (id: string, updates: Record<string, unknown>) => Promise<void>
  onDelete?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(assistant.name)
  const [systemPrompt, setSystemPrompt] = useState(assistant.system_prompt)
  const [providerId, setProviderId] = useState(assistant.provider_id ?? '')
  const [modelId, setModelId] = useState(assistant.model_id ?? '')
  const [temperature, setTemperature] = useState(assistant.temperature?.toString() ?? '')
  const [contextLimit, setContextLimit] = useState(assistant.context_limit.toString())
  const [thinkingEnabled, setThinkingEnabled] = useState(assistant.thinking_enabled !== 0)
  const [thinkingBudget, setThinkingBudget] = useState(assistant.thinking_budget?.toString() ?? '')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [saved, setSaved] = useState(false)
  const [allTools, setAllTools] = useState<ToolInfo[]>([])
  const [toolMode, setToolMode] = useState<'all' | 'custom'>(assistant.enabled_tools ? 'custom' : 'all')
  const [selectedTools, setSelectedTools] = useState<Set<string>>(() => {
    if (assistant.enabled_tools) {
      try { return new Set(JSON.parse(assistant.enabled_tools) as string[]) } catch { /* ignore */ }
    }
    return new Set<string>()
  })

  useEffect(() => {
    if (providerId) {
      api.fetchProviderModels(providerId).then(setModels).catch(() => setModels([]))
    } else {
      setModels([])
    }
  }, [providerId])

  useEffect(() => {
    api.listAllToolNames().then(setAllTools)
  }, [])

  async function handleSave() {
    const enabledTools = toolMode === 'custom'
      ? JSON.stringify([...selectedTools])
      : null
    await onSave(assistant.id, {
      name,
      systemPrompt,
      providerId: providerId.trim() || null,
      modelId: modelId.trim() || null,
      temperature: temperature ? parseFloat(temperature) : null,
      contextLimit: contextLimit ? parseInt(contextLimit) : null,
      enabledTools,
      thinkingEnabled: thinkingEnabled ? 1 : 0,
      thinkingBudget: thinkingBudget ? parseInt(thinkingBudget) : null,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4 pl-7 pr-2 pb-4">
      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.name')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.systemPrompt')}</label>
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          className="resize-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.provider')}</label>
          <Select value={providerId || '_default'} onValueChange={(v) => { setProviderId(!v || v === '_default' ? '' : v); setModelId('') }}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_default">{t('settings.assistant.providerDefault')}</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.model')}</label>
          {models.length > 0 ? (
            <Select value={modelId || '_none'} onValueChange={(v) => setModelId(!v || v === '_none' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('settings.assistant.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">{t('settings.assistant.selectModel')}</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder={t('settings.assistant.modelPlaceholder')}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.temperature')}</label>
          <Input
            type="number"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder={t('settings.assistant.providerDefault')}
            min={0}
            max={2}
            step={0.1}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.contextLimit')}</label>
          <Input
            type="number"
            value={contextLimit}
            onChange={(e) => setContextLimit(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.thinking')}</label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox
              checked={thinkingEnabled}
              onCheckedChange={(checked) => setThinkingEnabled(!!checked)}
            />
            <span>{t('settings.assistant.thinkingEnabled')}</span>
          </label>
        </div>
        {thinkingEnabled && (
          <div className="space-y-1 mt-2">
            <Input
              type="number"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(e.target.value)}
              placeholder={t('settings.assistant.thinkingBudget')}
            />
            <p className="text-[10px] text-muted-foreground/60">{t('settings.assistant.thinkingBudgetHint')}</p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">{t('settings.assistant.tools')}</label>
        <div className="flex gap-2 mb-2">
          <Button
            size="sm" variant={toolMode === 'all' ? 'default' : 'outline'}
            onClick={() => setToolMode('all')}
          >{t('settings.assistant.toolsAll')}</Button>
          <Button
            size="sm" variant={toolMode === 'custom' ? 'default' : 'outline'}
            onClick={() => setToolMode('custom')}
          >{t('settings.assistant.toolsCustom')}</Button>
        </div>
        {toolMode === 'custom' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-border rounded-lg">
            {allTools.map((tool) => (
              <label key={tool.name} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5">
                <Checkbox
                  checked={selectedTools.has(tool.name)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedTools)
                    if (checked) next.add(tool.name)
                    else next.delete(tool.name)
                    setSelectedTools(next)
                  }}
                />
                <span className="font-mono truncate">{tool.name}</span>
                {tool.source === 'mcp' && (
                  <span className="text-muted-foreground/50 text-[10px]">MCP</span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={handleSave}>{t('common.save')}</Button>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] text-green-400">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
        {onDelete && (
          <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => onDelete(assistant.id)}>
            {t('common.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function AssistantSettings() {
  const { t } = useTranslation()
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [aList, pList] = await Promise.all([
      api.listAssistants(),
      api.listProviders(),
    ])
    setAssistants(aList)
    setProviders(pList)
  }, [])

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [refresh])

  const handleCreate = useCallback(async () => {
    const a = await api.createAssistant('New Assistant', 'You are a helpful assistant.')
    await refresh()
    setExpandedId(a.id)
  }, [refresh])

  const handleSave = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      await api.updateAssistant(id, updates as never)
      await refresh()
    },
    [refresh],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await api.deleteAssistant(id)
      if (expandedId === id) setExpandedId(null)
      await refresh()
    },
    [expandedId, refresh],
  )

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{t('settings.assistant.title')}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t('settings.assistant.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCreate}>
          <Plus className="w-3.5 h-3.5" />
          {t('settings.assistant.new')}
        </Button>
      </div>

      <div className="space-y-1">
        {assistants.map((a) => {
          const isExpanded = expandedId === a.id
          const isDefault = a.is_default === 1
          const providerName = providers.find((p) => p.id === a.provider_id)?.name

          return (
            <div key={a.id} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : a.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="flex-1 truncate">{a.name}</span>
                {isDefault && <Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="currentColor" />}
                {providerName && (
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">{providerName}</span>
                )}
                {a.model_id && (
                  <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">{a.model_id}</span>
                )}
              </button>
              {isExpanded && (
                <AssistantEditor
                  assistant={a}
                  providers={providers}
                  onSave={handleSave}
                  onDelete={isDefault ? undefined : handleDelete}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
