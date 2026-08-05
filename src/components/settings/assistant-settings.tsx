import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ChevronDown, ChevronRight, Star, Check, BookTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { api } from '@/api'
import type { Assistant, EmojiPack, Provider, ModelInfo, PromptTemplate, Skill, TemplateVariable, ToolInfo, ToolPreset } from '@/types'

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
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(assistant.auto_compact_enabled !== 0)
  const [thinkingEnabled, setThinkingEnabled] = useState(assistant.thinking_enabled !== 0)
  const [thinkingBudget, setThinkingBudget] = useState(assistant.thinking_budget?.toString() ?? '')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [saved, setSaved] = useState(false)
  const [allTools, setAllTools] = useState<ToolInfo[]>([])
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [templateVars, setTemplateVars] = useState<TemplateVariable[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [allPacks, setAllPacks] = useState<EmojiPack[]>([])
  const [assignedPackIds, setAssignedPackIds] = useState<Set<string>>(new Set())
  const [allSkills, setAllSkills] = useState<Skill[]>([])
  const [boundSkillDirs, setBoundSkillDirs] = useState<Set<string>>(new Set())
  const [skillError, setSkillError] = useState<string | null>(null)
  const [toolPresets, setToolPresets] = useState<ToolPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState(assistant.tool_preset_id ?? '')
  const [toolMode, setToolMode] = useState<'all' | 'preset' | 'custom'>(
    assistant.tool_preset_id ? 'preset' : assistant.enabled_tools ? 'custom' : 'all',
  )
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
    api.listPromptTemplates().then(setTemplates)
    api.listTemplateVariables().then(setTemplateVars)
    api.listEmojiPacks().then(setAllPacks)
    api.listToolPresets().then(setToolPresets)
    api.listAssistantEmojiPacks(assistant.id).then((packs) =>
      setAssignedPackIds(new Set(packs.map((p) => p.id))),
    )
    api.listSkills().then(setAllSkills)
    api.listSkillBindings('assistant', assistant.id).then((dirs) =>
      setBoundSkillDirs(new Set(dirs)),
    )
  }, [assistant.id])

  async function handleSave() {
    const enabledTools = toolMode === 'custom'
      ? JSON.stringify([...selectedTools])
      : null
    const toolPresetId = toolMode === 'preset' && selectedPresetId
      ? selectedPresetId
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
      toolPresetId,
      autoCompactEnabled: autoCompactEnabled ? 1 : 0,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const providerOptions = [
    { value: '_default', label: t('settings.assistant.providerDefault') },
    ...providers.map((p) => ({ value: p.id, label: p.name })),
  ]
  const modelOptions = [
    { value: '_none', label: t('settings.assistant.selectModel') },
    ...models.map((m) => ({ value: m.id, label: m.name })),
  ]
  const presetOptions = [
    { value: '_none', label: t('settings.assistant.selectModel') },
    ...toolPresets.map((p) => ({ value: p.id, label: `${p.name}${p.description ? ` — ${p.description}` : ''}` })),
  ]

  return (
    <div className="space-y-4 pl-7 pr-2 pb-4">
      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.assistant.name')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs text-muted">{t('settings.assistant.systemPrompt')}</label>
          <Button
            variant="ghost"
            className="text-xs gap-1"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            <BookTemplate className="w-3 h-3" />
            {t('settings.assistant.browseTemplates')}
          </Button>
        </div>
        {showTemplates && (
          <ScrollArea className="border border-border rounded-lg p-2 space-y-1 max-h-48">
            {templates.map((tpl) => (
              <Button
                key={tpl.id}
                variant="ghost"
                className="w-full justify-start h-auto px-2 py-1.5 text-xs"
                onClick={() => { setSystemPrompt(tpl.template_text); setShowTemplates(false) }}
              >
                <span className="font-medium">{tpl.name}</span>
                {tpl.description && (
                  <span className="text-muted ml-2">{tpl.description}</span>
                )}
              </Button>
            ))}
          </ScrollArea>
        )}
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          className="resize-none font-mono text-xs"
        />
        {templateVars.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {templateVars.map((v) => (
              <Tooltip key={v.name}>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      className="text-xs px-1.5 py-0.5 bg-default/50 text-muted hover:bg-default font-mono"
                      onClick={() => setSystemPrompt((prev) => prev + `{{${v.name}}}`)}
                    >
                      {`{{${v.name}}}`}
                    </Button>
                  }
                />
                <TooltipContent side="top">{v.description_en}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">{t('settings.assistant.provider')}</label>
          <Select
            value={providerId || '_default'}
            onValueChange={(v) => { setProviderId(!v || v === '_default' ? '' : v); setModelId('') }}
            items={providerOptions}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">{t('settings.assistant.model')}</label>
          {models.length > 0 ? (
            <Select
              value={modelId || '_none'}
              onValueChange={(v) => setModelId(!v || v === '_none' ? '' : v)}
              items={modelOptions}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('settings.assistant.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
          <label className="block text-xs text-muted">{t('settings.assistant.temperature')}</label>
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
          <label className="block text-xs text-muted">{t('settings.assistant.contextLimit')}</label>
          <Input
            type="number"
            value={contextLimit}
            onChange={(e) => setContextLimit(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.assistant.autoCompact')}</label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={autoCompactEnabled}
            onCheckedChange={(checked) => setAutoCompactEnabled(!!checked)}
          />
          <span>{t('settings.assistant.autoCompactHint')}</span>
        </label>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.assistant.thinking')}</label>
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
            <p className="text-xs text-muted/60">{t('settings.assistant.thinkingBudgetHint')}</p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-muted">{t('settings.assistant.tools')}</label>
        <div className="flex gap-2 mb-2">
          <Button
            variant={toolMode === 'all' ? 'default' : 'outline'}
            onClick={() => setToolMode('all')}
          >{t('settings.assistant.toolsAll')}</Button>
          {toolPresets.length > 0 && (
            <Button
              variant={toolMode === 'preset' ? 'default' : 'outline'}
              onClick={() => setToolMode('preset')}
            >{t('settings.tools.preset')}</Button>
          )}
          <Button
            variant={toolMode === 'custom' ? 'default' : 'outline'}
            onClick={() => setToolMode('custom')}
          >{t('settings.assistant.toolsCustom')}</Button>
        </div>
        {toolMode === 'preset' && (
          <Select
            value={selectedPresetId || '_none'}
            onValueChange={(v) => { if (v) setSelectedPresetId(v === '_none' ? '' : v) }}
            items={presetOptions}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presetOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {toolMode === 'custom' && (
          <ScrollArea className="max-h-40 border border-border rounded-lg"><div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2">
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
                  <span className="text-muted/50 text-xs">MCP</span>
                )}
              </label>
            ))}
          </div></ScrollArea>
        )}
      </div>

      {allPacks.length > 0 && (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">{t('settings.assistant.emojiPacks')}</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2 border border-border rounded-lg">
            {allPacks.map((pack) => (
              <label key={pack.id} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5">
                <Checkbox
                  checked={assignedPackIds.has(pack.id)}
                  onCheckedChange={async (checked) => {
                    if (checked) {
                      await api.assignEmojiPack(assistant.id, pack.id)
                      setAssignedPackIds((prev) => new Set([...prev, pack.id]))
                    } else {
                      await api.unassignEmojiPack(assistant.id, pack.id)
                      setAssignedPackIds((prev) => {
                        const next = new Set(prev)
                        next.delete(pack.id)
                        return next
                      })
                    }
                  }}
                />
                <span className="truncate">{pack.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {allSkills.length > 0 && (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">{t('settings.skills.assistantSection')}</label>
          <p className="text-xs text-muted/60">{t('settings.skills.assistantHint')}</p>
          <ScrollArea className="max-h-40 border border-border rounded-lg"><div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2">
            {allSkills.map((skill) => (
              <label key={skill.dir_name} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5">
                <Checkbox
                  checked={boundSkillDirs.has(skill.dir_name)}
                  disabled={skill.is_enabled === 0}
                  onCheckedChange={async (checked) => {
                    setSkillError(null)
                    try {
                      // The cap on bindings per anchor lives in the backend, so
                      // take the returned set rather than guessing locally.
                      const next = await api.setSkillBinding('assistant', assistant.id, skill.dir_name, !!checked)
                      setBoundSkillDirs(new Set(next))
                    } catch (e) {
                      setSkillError(String(e))
                    }
                  }}
                />
                <span className="truncate">{skill.display_name}</span>
              </label>
            ))}
          </div></ScrollArea>
          {skillError && <p className="text-xs text-danger">{skillError}</p>}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={handleSave}>{t('common.save')}</Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
        {onDelete && (
          <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={() => onDelete(assistant.id)}>
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
    return <div className="text-muted text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{t('settings.assistant.title')}</h2>
          <p className="text-xs text-muted mt-1">{t('settings.assistant.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={handleCreate}>
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
              <Button
                variant="ghost"
                onClick={() => setExpandedId(isExpanded ? null : a.id)}
                className="w-full justify-start h-auto px-3 py-2.5 text-sm"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted" />
                )}
                <span className="flex-1 truncate">{a.name}</span>
                {/* eslint-disable-next-line no-restricted-syntax -- gold-star semantics: default-assistant marker is intentionally amber (CLAUDE.md whitelist) */}
                {isDefault && <Star className="w-3.5 h-3.5 text-amber-500" fill="currentColor" />}
                {providerName && (
                  <span className="text-xs text-muted">{providerName}</span>
                )}
                {a.model_id && (
                  <span className="text-xs text-muted/60">{a.model_id}</span>
                )}
              </Button>
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
