import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, StarFill } from '@gravity-ui/icons'
import {
  Alert,
  Button,
  Checkbox,
  Disclosure,
  DisclosureGroup,
  Input,
  Label,
  TextArea,
  TextField,
  Tooltip,
} from '@/components/base'
import { Segment } from '@/components/base'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { ProviderModelPicker } from './provider-model-picker'
import { SubAgentSettings } from './sub-agent-settings'
import type {
  AssistantInfoResponse,
  AssistantUpdateRequest,
  EmojiPackInfoResponse,
  ProviderInfoResponse,
  McpToolInfoResponse,
  ProviderModelInfoResponse,
  SkillInfoResponse,
  TemplateVariableInfoResponse,
  ToolPresetInfoResponse,
} from '@/types'
import { SettingsDrilldown } from './settings-drilldown'
import { useSettingsDirtyRegistration } from './dirty-guard'

function AssistantEditor({
  assistant,
  providers,
  onSave,
  onDelete,
  onDirtyChange,
}: {
  assistant: AssistantInfoResponse
  providers: ProviderInfoResponse[]
  onSave: (id: string, updates: Omit<AssistantUpdateRequest, 'id'>) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onDirtyChange?: (id: string, dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(assistant.name)
  const [systemPrompt, setSystemPrompt] = useState(assistant.system_prompt)
  const [providerId, setProviderId] = useState(assistant.provider_id ?? '')
  const [modelId, setModelId] = useState(assistant.model_id ?? '')
  const [temperature, setTemperature] = useState(assistant.temperature?.toString() ?? '')
  const [contextLimit, setContextLimit] = useState(assistant.context_limit.toString())
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(assistant.auto_compact_enabled)
  const [thinkingEnabled, setThinkingEnabled] = useState(assistant.thinking_enabled)
  const [thinkingBudget, setThinkingBudget] = useState(assistant.thinking_budget?.toString() ?? '')
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])
  const [saved, markSaved] = useTemporaryFlag()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [allTools, setAllTools] = useState<McpToolInfoResponse[]>([])
  const [templateVars, setTemplateVars] = useState<TemplateVariableInfoResponse[]>([])
  const [allPacks, setAllPacks] = useState<EmojiPackInfoResponse[]>([])
  const [assignedPackIds, setAssignedPackIds] = useState<Set<string>>(new Set())
  const [allSkills, setAllSkills] = useState<SkillInfoResponse[]>([])
  const [boundSkillDirs, setBoundSkillDirs] = useState<Set<string>>(new Set())
  const [skillError, setSkillError] = useState<string | null>(null)
  const [toolPresets, setToolPresets] = useState<ToolPresetInfoResponse[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState(assistant.tool_preset_id ?? '')
  const [toolMode, setToolMode] = useState<'all' | 'preset' | 'custom'>(
    assistant.tool_preset_id ? 'preset' : assistant.enabled_tools ? 'custom' : 'all',
  )
  const [selectedTools, setSelectedTools] = useState<Set<string>>(() => {
    return new Set(assistant.enabled_tools ?? [])
  })
  const initialToolMode = assistant.tool_preset_id ? 'preset' : assistant.enabled_tools ? 'custom' : 'all'
  const [savedDraft, setSavedDraft] = useState(() =>
    JSON.stringify({
      name: assistant.name,
      systemPrompt: assistant.system_prompt,
      providerId: assistant.provider_id ?? '',
      modelId: assistant.model_id ?? '',
      temperature: assistant.temperature?.toString() ?? '',
      contextLimit: assistant.context_limit.toString(),
      autoCompactEnabled: assistant.auto_compact_enabled,
      thinkingEnabled: assistant.thinking_enabled,
      thinkingBudget: assistant.thinking_budget?.toString() ?? '',
      selectedPresetId: assistant.tool_preset_id ?? '',
      toolMode: initialToolMode,
      selectedTools: [...(assistant.enabled_tools ?? [])].sort(),
    }),
  )
  const draft = JSON.stringify({
    name,
    systemPrompt,
    providerId,
    modelId,
    temperature,
    contextLimit,
    autoCompactEnabled,
    thinkingEnabled,
    thinkingBudget,
    selectedPresetId,
    toolMode,
    selectedTools: [...selectedTools].sort(),
  })
  const dirty = draft !== savedDraft

  useEffect(() => onDirtyChange?.(assistant.id, dirty), [assistant.id, dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(assistant.id, false), [assistant.id, onDirtyChange])

  useEffect(() => {
    if (providerId) {
      api
        .fetchProviderModels({ providerId, forceRefresh: null })
        .then(setModels)
        .catch(() => setModels([]))
    } else {
      setModels([])
    }
  }, [providerId])

  useEffect(() => {
    api.listAllToolNames().then(setAllTools)
    api.listTemplateVariables().then(setTemplateVars)
    api.listEmojiPacks().then(setAllPacks)
    api.listToolPresets().then(setToolPresets)
    api.listAssistantEmojiPacks(assistant.id).then((packs) => setAssignedPackIds(new Set(packs.map((p) => p.id))))
    api.listSkills().then(setAllSkills)
    api
      .listSkillBindings({ layer: 'assistant', anchorId: assistant.id })
      .then((dirs) => setBoundSkillDirs(new Set(dirs)))
  }, [assistant.id])

  async function handleSave() {
    const enabledTools = toolMode === 'custom' ? [...selectedTools] : null
    const toolPresetId = toolMode === 'preset' && selectedPresetId ? selectedPresetId : null
    setSaveError(null)
    try {
      await onSave(assistant.id, {
        name,
        systemPrompt,
        providerId: providerId.trim() || null,
        modelId: modelId.trim() || null,
        temperature: temperature ? parseFloat(temperature) : null,
        contextLimit: contextLimit ? parseInt(contextLimit) : undefined,
        enabledTools,
        thinkingEnabled,
        thinkingBudget: thinkingBudget ? parseInt(thinkingBudget) : null,
        toolPresetId,
        autoCompactEnabled,
      })
    } catch (error) {
      // A plan review can hold the assistant; said nowhere, the button does
      // nothing and the draft stays dirty with no explanation.
      setSaveError(error instanceof Error ? error.message : String(error))
      return
    }
    setSavedDraft(draft)
    markSaved()
  }

  const presetOptions = [
    { value: '_none', label: t('settings.assistant.selectModel') },
    ...toolPresets.map((p) => ({ value: p.id, label: `${p.name}${p.description ? ` — ${p.description}` : ''}` })),
  ]

  return (
    <div data-slot="assistant-editor" className="space-y-4 px-1 pb-4">
      <TextField fullWidth>
        <Label>{t('settings.assistant.name')}</Label>
        <Input name={`assistantName-${assistant.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      <TextField fullWidth>
        <Label>{t('settings.assistant.systemPrompt')}</Label>
        <TextArea
          name={`assistantSystemPrompt-${assistant.id}`}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleSave()
            }
          }}
          rows={6}
          className="resize-none font-mono text-xs"
        />
        {templateVars.length > 0 && (
          <div data-slot="template-variables" className="flex flex-wrap gap-1">
            {templateVars.map((v) => (
              <Tooltip key={v.name} delay={0}>
                <Button
                  variant="outline"
                  className="text-xs px-1.5 py-0.5 bg-default/50 text-muted hover:bg-default font-mono"
                  onPress={() => setSystemPrompt((prev) => prev + `{{${v.name}}}`)}
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
        onChange={(provider, model) => {
          setProviderId(provider)
          setModelId(model)
        }}
        emptyProviderLabel={t('settings.assistant.providerDefault')}
      />

      <div data-slot="assistant-params" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
        <TextField fullWidth type="number">
          <Label>{t('settings.assistant.temperature')}</Label>
          <Input
            name={`assistantTemperature-${assistant.id}`}
            inputMode="decimal"
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
          <Input
            name={`assistantContextLimit-${assistant.id}`}
            inputMode="numeric"
            value={contextLimit}
            onChange={(e) => setContextLimit(e.target.value)}
          />
        </TextField>
      </div>

      <div data-slot="assistant-auto-compact" className="space-y-1.5">
        <p data-slot="assistant-auto-compact-label" className="block text-xs text-muted">
          {t('settings.assistant.autoCompact')}
        </p>
        <Checkbox className="text-xs" isSelected={autoCompactEnabled} onChange={setAutoCompactEnabled}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            {t('settings.assistant.autoCompactHint')}
          </Checkbox.Content>
        </Checkbox>
      </div>

      <div data-slot="assistant-thinking" className="space-y-1.5">
        <p data-slot="assistant-thinking-label" className="block text-xs text-muted">
          {t('settings.assistant.thinking')}
        </p>
        <div data-slot="assistant-thinking-toggle" className="flex items-center gap-3">
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
          <div data-slot="assistant-thinking-budget" className="space-y-1 mt-2">
            <Input
              fullWidth
              type="number"
              name={`assistantThinkingBudget-${assistant.id}`}
              aria-label={t('settings.assistant.thinkingBudget')}
              inputMode="numeric"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(e.target.value)}
              placeholder={t('settings.assistant.thinkingBudget')}
            />
            <p data-slot="assistant-thinking-budget-hint" className="text-xs text-muted">
              {t('settings.assistant.thinkingBudgetHint')}
            </p>
          </div>
        )}
      </div>

      <SettingsDrilldown
        title={t('settings.assistant.tools')}
        summary={
          toolMode === 'all'
            ? t('settings.assistant.toolsAll')
            : toolMode === 'preset'
              ? t('settings.tools.preset')
              : t('settings.assistant.toolsCustom')
        }
      >
        <Segment
          aria-label={t('settings.assistant.tools')}
          className="mb-2 w-full"
          selectedKey={toolMode}
          onSelectionChange={(key) => {
            if (key === 'all' || key === 'preset' || key === 'custom') setToolMode(key)
          }}
        >
          <Segment.Item id="all" className="pointer-coarse:min-h-11">
            {t('settings.assistant.toolsAll')}
          </Segment.Item>
          {toolPresets.length > 0 && (
            <Segment.Item id="preset" className="pointer-coarse:min-h-11">
              {t('settings.tools.preset')}
            </Segment.Item>
          )}
          <Segment.Item id="custom" className="pointer-coarse:min-h-11">
            {t('settings.assistant.toolsCustom')}
          </Segment.Item>
        </Segment>
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
          >
            {/* `role="group"` with a name, rather than `CheckboxGroup`: the
                boxes below commit one at a time and two of the three sibling
                grids write straight through to the backend on each toggle. A
                group-level value would mean diffing an array back into "which
                one changed", which is a lot of new failure for a label. */}
            <div
              data-slot="tool-grid"
              role="group"
              aria-label={t('settings.assistant.tools')}
              className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-1 p-2"
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
                    <span data-slot="tool-name" className="truncate font-mono">
                      {tool.name}
                    </span>
                    {tool.source === 'mcp' && (
                      <span data-slot="tool-source" className="text-xs text-muted">
                        MCP
                      </span>
                    )}
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </div>
        )}
      </SettingsDrilldown>

      {allPacks.length > 0 && (
        <SettingsDrilldown title={t('settings.assistant.emojiPacks')} summary={assignedPackIds.size || undefined}>
          <div
            data-slot="emoji-pack-grid"
            role="group"
            aria-label={t('settings.assistant.emojiPacks')}
            className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-1 p-2 border border-border rounded-lg"
          >
            {allPacks.map((pack) => (
              <Checkbox
                key={pack.id}
                className="py-0.5 text-xs"
                isSelected={assignedPackIds.has(pack.id)}
                onChange={async (selected) => {
                  if (selected) {
                    await api.assignEmojiPack({ assistantId: assistant.id, packId: pack.id })
                    setAssignedPackIds((prev) => new Set([...prev, pack.id]))
                  } else {
                    await api.unassignEmojiPack({ assistantId: assistant.id, packId: pack.id })
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
                  <span data-slot="emoji-pack-name" className="truncate">
                    {pack.name}
                  </span>
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div>
        </SettingsDrilldown>
      )}

      {allSkills.length > 0 && (
        <SettingsDrilldown title={t('settings.skills.assistantSection')} summary={boundSkillDirs.size || undefined}>
          <p data-slot="skill-hint" className="text-xs text-muted">
            {t('settings.skills.assistantHint')}
          </p>
          <div
            data-slot="skill-list"
            className="max-h-40 overflow-y-auto overscroll-contain border border-border rounded-lg"
          >
            <div
              data-slot="skill-grid"
              role="group"
              aria-label={t('settings.skills.assistantSection')}
              className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-1 p-2"
            >
              {allSkills.map((skill) => (
                <Checkbox
                  key={skill.dir_name}
                  className="py-0.5 text-xs"
                  isSelected={boundSkillDirs.has(skill.dir_name)}
                  isDisabled={!skill.is_enabled}
                  onChange={async (selected) => {
                    setSkillError(null)
                    try {
                      // The cap on bindings per anchor lives in the backend, so
                      // take the returned set rather than guessing locally.
                      const next = await api.setSkillBinding({
                        layer: 'assistant',
                        anchorId: assistant.id,
                        dirName: skill.dir_name,
                        bound: selected,
                      })
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
                    <span data-slot="skill-name" className="truncate">
                      {skill.display_name}
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </div>
          {skillError && (
            <p data-slot="skill-error" role="alert" className="text-xs text-danger">
              {skillError}
            </p>
          )}
        </SettingsDrilldown>
      )}

      {saveError && (
        <p data-slot="assistant-save-error" role="alert" className="text-xs text-danger break-all">
          {saveError}
        </p>
      )}
      <div data-slot="assistant-editor-actions" className="flex items-center gap-2 pt-1">
        <Button onPress={handleSave}>{t('common.save')}</Button>
        {saved && <SavedHint />}
        {onDelete && (
          <Button
            variant="danger-soft"
            className="ml-auto"
            onPress={() => {
              setSaveError(null)
              void onDelete(assistant.id).catch((reason) => setSaveError(String(reason)))
            }}
          >
            {t('common.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function AssistantSettings() {
  const { t } = useTranslation()
  const [assistants, setAssistants] = useState<AssistantInfoResponse[]>([])
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dirtyAssistantId, setDirtyAssistantId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const requestLeave = useCallback(async () => {
    if (!dirtyAssistantId) return true
    return confirm({ body: t('settings.unsavedChanges'), status: 'warning' })
  }, [confirm, dirtyAssistantId, t])
  useSettingsDirtyRegistration('assistants', 'assistant-editor', dirtyAssistantId !== null)

  const handleDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyAssistantId((current) => (dirty ? id : current === id ? null : current))
  }, [])

  const changeExpanded = useCallback(
    async (next: string | null) => {
      if (next === expandedId || !(await requestLeave())) return
      setExpandedId(next)
    },
    [expandedId, requestLeave],
  )

  const refresh = useCallback(async () => {
    const [aList, pList] = await Promise.all([api.listAssistants(), api.listProviders()])
    setAssistants(aList)
    setProviders(pList)
  }, [])

  useEffect(() => {
    void refresh()
      .catch((reason) => setLoadError(String(reason)))
      .finally(() => setLoading(false))
  }, [refresh])

  const handleCreate = useCallback(async () => {
    if (!(await requestLeave())) return
    const a = await api.createAssistant({
      name: 'New Assistant',
      systemPrompt: 'You are a helpful assistant.',
      modelId: null,
      temperature: null,
      topP: null,
      maxTokens: null,
    })
    await refresh()
    setExpandedId(a.id)
  }, [refresh, requestLeave])

  const handleSave = useCallback(
    async (id: string, updates: Omit<AssistantUpdateRequest, 'id'>) => {
      await api.updateAssistant({ ...updates, id })
      await refresh()
    },
    [refresh],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.assistant') }))) return
      await api.deleteAssistant(id)
      setDirtyAssistantId(null)
      if (expandedId === id) setExpandedId(null)
      await refresh()
    },
    [confirm, t, expandedId, refresh],
  )

  if (loading) {
    return <SettingsSkeleton />
  }

  if (loadError && assistants.length === 0) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.assistant.title')} subtitle={t('settings.assistant.subtitle')} />
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.assistant.loadError')}</Alert.Title>
            <Alert.Description className="break-all">{loadError}</Alert.Description>
            <Button
              size="sm"
              variant="outline"
              onPress={() => {
                setLoadError(null)
                setLoading(true)
                void refresh()
                  .catch((reason) => setLoadError(String(reason)))
                  .finally(() => setLoading(false))
              }}
            >
              {t('settings.assistant.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      </SettingsPane>
    )
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title={t('settings.assistant.title')}
        subtitle={t('settings.assistant.subtitle')}
        actions={
          <Button variant="outline" onPress={handleCreate}>
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
        onExpandedChange={(keys) => void changeExpanded(([...keys][0] as string | undefined) ?? null)}
      >
        {assistants.map((a) => {
          const isExpanded = expandedId === a.id
          const isDefault = a.is_default
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
                  <span data-slot="assistant-row-name" className="min-w-0 flex-1 truncate">
                    {a.name}
                  </span>
                  {isDefault && (
                    <span data-slot="assistant-row-default" className="shrink-0 text-warning">
                      <StarFill aria-hidden="true" className="w-3.5 h-3.5" />
                      <span data-slot="assistant-row-default-label" className="sr-only">
                        {t('settings.assistant.defaultBadge')}
                      </span>
                    </span>
                  )}
                  {/* Both truncate, and both need `min-w-0` to be allowed to.
                      A model id has no spaces in it, so its min-content width is
                      the whole string: on a narrow row these two took what they
                      liked and the assistant's own name — the one thing the row
                      is for — was squeezed to nothing before either of them gave
                      up a character. */}
                  {providerName && (
                    <span data-slot="assistant-row-provider" className="min-w-0 truncate text-xs text-muted">
                      {providerName}
                    </span>
                  )}
                  {a.model_id && (
                    <span data-slot="assistant-row-model" className="min-w-0 truncate text-xs text-muted">
                      {a.model_id}
                    </span>
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
                      onDirtyChange={handleDirtyChange}
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
