import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, StarFill, SquareDashedText } from '@gravity-ui/icons'
import { Button, Checkbox, Disclosure, DisclosureGroup, Input, Label, TextArea, TextField, Tooltip } from '@heroui/react'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect } from './primitives'
import { ProviderModelPicker } from './provider-model-picker'
import { SubAgentSettings } from './sub-agent-settings'
import type { Assistant, EmojiPack, Provider, ModelInfo, PromptTemplate, Skill, TemplateVariable, ToolInfo, ToolPreset } from '@/types'
import { SettingsDrilldown } from './settings-drilldown'

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
  const [saved, markSaved] = useTemporaryFlag()
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
    markSaved()
  }

  const presetOptions = [
    { value: '_none', label: t('settings.assistant.selectModel') },
    ...toolPresets.map((p) => ({ value: p.id, label: `${p.name}${p.description ? ` — ${p.description}` : ''}` })),
  ]

  return (
    <div className="space-y-4 px-1 pb-4">
      <TextField fullWidth>
        <Label>{t('settings.assistant.name')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      {/* The label shares its line with a button, so it is nested rather than a
          direct child. React Aria wires it through context either way. */}
      <TextField fullWidth>
        <div className="flex items-center justify-between">
          <Label>{t('settings.assistant.systemPrompt')}</Label>
          <Button
            variant="ghost"
            className="text-xs gap-1"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            <SquareDashedText className="w-3.5 h-3.5" />
            {t('settings.assistant.browseTemplates')}
          </Button>
        </div>
        {showTemplates && (
          <div
            data-slot="template-list"
            className="border border-border rounded-lg p-2 space-y-1 max-h-48 overflow-y-auto overscroll-contain"
          >
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
          </div>
        )}
        <TextArea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          className="resize-none font-mono text-xs"
        />
        {templateVars.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {templateVars.map((v) => (
              <Tooltip key={v.name} delay={0}>
                <Button
                  variant="outline"
                  className="text-xs px-1.5 py-0.5 bg-default/50 text-muted hover:bg-default font-mono"
                  onClick={() => setSystemPrompt((prev) => prev + `{{${v.name}}}`)}
                >
                  {`{{${v.name}}}`}
                </Button>
                <Tooltip.Content placement="top">{v.description_en}</Tooltip.Content>
              </Tooltip>
            ))}
          </div>
        )}
      </TextField>

      <ProviderModelPicker
        providers={providers}
        models={models}
        providerId={providerId}
        modelId={modelId}
        onChange={(provider, model) => { setProviderId(provider); setModelId(model) }}
        emptyProviderLabel={t('settings.assistant.providerDefault')}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextField fullWidth type="number">
          <Label>{t('settings.assistant.temperature')}</Label>
          <Input
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder={t('settings.assistant.providerDefault')}
            min={0}
            max={2}
            step={0.1}
          />
        </TextField>
        <TextField fullWidth type="number">
          <Label>{t('settings.assistant.contextLimit')}</Label>
          <Input value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} />
        </TextField>
      </div>

      <div className="space-y-1.5">
        <p className="block text-xs text-muted">{t('settings.assistant.autoCompact')}</p>
        <Checkbox className="text-xs" isSelected={autoCompactEnabled} onChange={setAutoCompactEnabled}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            {t('settings.assistant.autoCompactHint')}
          </Checkbox.Content>
        </Checkbox>
      </div>

      <div className="space-y-1.5">
        <p className="block text-xs text-muted">{t('settings.assistant.thinking')}</p>
        <div className="flex items-center gap-3">
          <Checkbox className="text-xs" isSelected={thinkingEnabled} onChange={setThinkingEnabled}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {t('settings.assistant.thinkingEnabled')}
            </Checkbox.Content>
          </Checkbox>
        </div>
        {thinkingEnabled && (
          <div className="space-y-1 mt-2">
            <Input fullWidth
              type="number"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(e.target.value)}
              placeholder={t('settings.assistant.thinkingBudget')}
            />
            <p className="text-xs text-muted">{t('settings.assistant.thinkingBudgetHint')}</p>
          </div>
        )}
      </div>

      <SettingsDrilldown
        title={t('settings.assistant.tools')}
        summary={
          toolMode === 'all' ? t('settings.assistant.toolsAll')
            : toolMode === 'preset' ? t('settings.tools.preset')
              : t('settings.assistant.toolsCustom')
        }
      >
        <div className="flex gap-2 mb-2">
          <Button
            variant={toolMode === 'all' ? 'primary' : 'outline'}
            onClick={() => setToolMode('all')}
          >{t('settings.assistant.toolsAll')}</Button>
          {toolPresets.length > 0 && (
            <Button
              variant={toolMode === 'preset' ? 'primary' : 'outline'}
              onClick={() => setToolMode('preset')}
            >{t('settings.tools.preset')}</Button>
          )}
          <Button
            variant={toolMode === 'custom' ? 'primary' : 'outline'}
            onClick={() => setToolMode('custom')}
          >{t('settings.assistant.toolsCustom')}</Button>
        </div>
        {toolMode === 'preset' && (
          <SettingsSelect
            ariaLabel={t('settings.tools.preset')}
            value={selectedPresetId || '_none'}
            options={presetOptions}
            onChange={(v) => setSelectedPresetId(v === '_none' ? '' : v)}
            fullWidth
          />
        )}
        {toolMode === 'custom' && (
          <div
            data-slot="tool-list"
            className="max-h-40 overflow-y-auto overscroll-contain border border-border rounded-lg"
          >{/* `role="group"` with a name, rather than `CheckboxGroup`: the
                boxes below commit one at a time and two of the three sibling
                grids write straight through to the backend on each toggle. A
                group-level value would mean diffing an array back into "which
                one changed", which is a lot of new failure for a label. */}
          <div
            role="group"
            aria-label={t('settings.assistant.tools')}
            className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2"
          >
            {allTools.map((tool) => (
              <Checkbox
                key={tool.name}
                className="py-0.5 text-xs"
                isSelected={selectedTools.has(tool.name)}
                onChange={(selected) => {
                  const next = new Set(selectedTools)
                  if (selected) next.add(tool.name)
                  else next.delete(tool.name)
                  setSelectedTools(next)
                }}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="truncate font-mono">{tool.name}</span>
                  {tool.source === 'mcp' && (
                    <span className="text-xs text-muted">MCP</span>
                  )}
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div></div>
        )}
      </SettingsDrilldown>

      {allPacks.length > 0 && (
        <SettingsDrilldown
          title={t('settings.assistant.emojiPacks')}
          summary={assignedPackIds.size || undefined}
        >
          <div
            role="group"
            aria-label={t('settings.assistant.emojiPacks')}
            className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2 border border-border rounded-lg"
          >
            {allPacks.map((pack) => (
              <Checkbox
                key={pack.id}
                className="py-0.5 text-xs"
                isSelected={assignedPackIds.has(pack.id)}
                onChange={async (selected) => {
                  if (selected) {
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
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="truncate">{pack.name}</span>
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div>
        </SettingsDrilldown>
      )}

      {allSkills.length > 0 && (
        <SettingsDrilldown
          title={t('settings.skills.assistantSection')}
          summary={boundSkillDirs.size || undefined}
        >
          <p className="text-xs text-muted">{t('settings.skills.assistantHint')}</p>
          <div
            data-slot="skill-list"
            className="max-h-40 overflow-y-auto overscroll-contain border border-border rounded-lg"
          ><div
            role="group"
            aria-label={t('settings.skills.assistantSection')}
            className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2"
          >
            {allSkills.map((skill) => (
              <Checkbox
                key={skill.dir_name}
                className="py-0.5 text-xs"
                isSelected={boundSkillDirs.has(skill.dir_name)}
                isDisabled={skill.is_enabled === 0}
                onChange={async (selected) => {
                  setSkillError(null)
                  try {
                    // The cap on bindings per anchor lives in the backend, so
                    // take the returned set rather than guessing locally.
                    const next = await api.setSkillBinding('assistant', assistant.id, skill.dir_name, selected)
                    setBoundSkillDirs(new Set(next))
                  } catch (e) {
                    setSkillError(String(e))
                  }
                }}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="truncate">{skill.display_name}</span>
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div></div>
          {skillError && <p className="text-xs text-danger">{skillError}</p>}
        </SettingsDrilldown>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={handleSave}>{t('common.save')}</Button>
        {saved && (
          <SavedHint />
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
  const { confirm, confirmDialog } = useConfirm()

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
      if (!await confirm({ body: t('settings.confirmDelete.assistant') })) return
      await api.deleteAssistant(id)
      if (expandedId === id) setExpandedId(null)
      await refresh()
    },
    [confirm, t, expandedId, refresh],
  )

  if (loading) {
    return <div className="text-muted text-sm">{t('common.loading')}</div>
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title={t('settings.assistant.title')}
        subtitle={t('settings.assistant.subtitle')}
        actions={
          <Button variant="outline" onClick={handleCreate}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.assistant.new')}
          </Button>
        }
      />

      {/* One open at a time is the group's own default (`allowsMultipleExpanded`
          is off), so the single-open rule lives in the primitive rather than in
          the click handler. */}
      <DisclosureGroup
        className="flex flex-col gap-1"
        expandedKeys={expandedId ? [expandedId] : []}
        onExpandedChange={(keys) => setExpandedId((([...keys][0] as string | undefined) ?? null))}
      >
        {assistants.map((a) => {
          const isExpanded = expandedId === a.id
          const isDefault = a.is_default === 1
          const providerName = providers.find((p) => p.id === a.provider_id)?.name

          return (
            <Disclosure
              key={a.id}
              id={a.id}
              className="flex w-full flex-col overflow-hidden rounded-lg border border-border"
            >
              <Disclosure.Heading>
                {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto`
                    and `shrink-0`, which only mean anything inside a flex container.
                    `text-start` undoes the button element's centred UA default. */}
                <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30">
                  <span className="flex-1 truncate">{a.name}</span>
                  {/* eslint-disable-next-line no-restricted-syntax -- gold-star semantics: default-assistant marker is intentionally amber (CLAUDE.md whitelist) */}
                  {isDefault && <StarFill className="w-3.5 h-3.5 text-amber-500" />}
                  {providerName && (
                    <span className="text-xs text-muted">{providerName}</span>
                  )}
                  {a.model_id && (
                    <span className="text-xs text-muted">{a.model_id}</span>
                  )}
                  <Disclosure.Indicator className="size-4 shrink-0 text-muted" />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              {/* `min-h-0` is load-bearing: the card is a flex column, and a flex
                  item's default `min-height: auto` floors it at its content height. */}
              <Disclosure.Content className="min-h-0 w-full">
                {/* Body, not a plain wrapper: it is what keeps the panel
                    measurable, so without it the editor never collapses. */}
                <Disclosure.Body>
                  {/* A collapsed panel is only hidden, not unmounted, so the
                      editor still has to be gated: mounting one per row would
                      fire its provider/model/tool/skill fetches for the whole
                      list on every visit to this page. */}
                  {isExpanded && (
                    <AssistantEditor
                      assistant={a}
                      providers={providers}
                      onSave={handleSave}
                      onDelete={isDefault ? undefined : handleDelete}
                    />
                  )}
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          )
        })}
      </DisclosureGroup>

      {/* Shares this tab's provider list rather than fetching its own: it is the
          same question — which model runs this — asked about a different kind
          of agent. */}
      <SubAgentSettings providers={providers} />
      {confirmDialog}
    </SettingsPane>
  )
}
