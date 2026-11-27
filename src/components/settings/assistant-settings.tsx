import './assistant-settings.css'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { Checkbox } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Plus } from '@keyline-icons/react/two-tone'
import { Star } from '@keyline-icons/react/fill'
import { Button as AriaButton, Disclosure, DisclosureGroup, DisclosurePanel, Heading } from 'react-aria-components'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { draftToNumber, numberToDraft } from '@/lib/number-draft'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { ProviderModelPicker } from './provider-model-picker'
import { SubAgentSettings } from './sub-agent-settings'
import { AuxiliaryModelSettings } from './auxiliary-model-settings'
import type {
  AssistantInfoResponse,
  AssistantUpdateRequest,
  CacheExpiryPolicy,
  EmojiPackInfoResponse,
  ProviderInfoResponse,
  McpToolInfoResponse,
  PromptCacheTtl,
  ProviderModelInfoResponse,
  SkillInfoResponse,
  ToolPresetInfoResponse,
} from '@/types'
import { SettingsDrilldown } from './settings-drilldown'
import { useSettingsDirtyRegistration } from './dirty-guard'
import { boundAssistantConflicts } from '@/lib/assistant-model-lock'
import { titleIfTruncated } from '@/lib/truncation'

/** An assistant's window override as the field shows it: `0` is "none", so the
 *  field is blank and the model's own window applies — not the digit zero. */
function overrideText(limit: number): string {
  return limit > 0 ? limit.toString() : ''
}

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
  const [contextLimit, setContextLimit] = useState(overrideText(assistant.context_limit))
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(assistant.auto_compact_enabled)
  const [cacheTtl, setCacheTtl] = useState<string>(assistant.cache_ttl ?? '_follow')
  const [cacheExpiryPolicy, setCacheExpiryPolicy] = useState<CacheExpiryPolicy>(assistant.cache_expiry_policy)
  const [cacheMaxWarmCount, setCacheMaxWarmCount] = useState(assistant.cache_max_warm_count.toString())
  const [cacheCompactMinTokens, setCacheCompactMinTokens] = useState(assistant.cache_compact_min_tokens.toString())
  const [thinkingEnabled, setThinkingEnabled] = useState(assistant.thinking_enabled)
  const [thinkingBudget, setThinkingBudget] = useState(assistant.thinking_budget?.toString() ?? '')
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])
  const [boundWindow, setBoundWindow] = useState<number | null>(null)
  const [supportsThinking, setSupportsThinking] = useState<boolean | null>(null)
  const [boundCacheTtls, setBoundCacheTtls] = useState<PromptCacheTtl[]>([])
  const [boundModelCacheTtl, setBoundModelCacheTtl] = useState<PromptCacheTtl | null>(null)
  const [saved, markSaved] = useTemporaryFlag()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [allTools, setAllTools] = useState<McpToolInfoResponse[]>([])
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
      contextLimit: overrideText(assistant.context_limit),
      autoCompactEnabled: assistant.auto_compact_enabled,
      cacheTtl: assistant.cache_ttl ?? '_follow',
      cacheExpiryPolicy: assistant.cache_expiry_policy,
      cacheMaxWarmCount: assistant.cache_max_warm_count.toString(),
      cacheCompactMinTokens: assistant.cache_compact_min_tokens.toString(),
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
    cacheTtl,
    cacheExpiryPolicy,
    cacheMaxWarmCount,
    cacheCompactMinTokens,
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
      api.providers
        .listModels({ provider_id: providerId, fetch_policy: 'cache_first' })
        .then(setModels)
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- model list feeds the picker only; the saved id is form state
        .catch(() => setModels([]))
    } else {
      setModels([])
    }
  }, [providerId])

  useEffect(() => {
    if (!providerId || !modelId) {
      setBoundWindow(null)
      setSupportsThinking(null)
      setBoundCacheTtls([])
      setBoundModelCacheTtl(null)
      return
    }
    let cancelled = false
    // Switching models must not leave the previous model's ceiling on screen
    // for a beat: a save that lands in that beat would be judged against it.
    setBoundWindow(null)
    setSupportsThinking(null)
    setBoundCacheTtls([])
    setBoundModelCacheTtl(null)
    // Two reads answer two different questions. The window comes from the
    // model's stored profile first; capabilities only decide thinking. A local
    // model's capability read fails whenever its file does, and that must not
    // take the profile's window down with it — that window is the whole lock.
    void Promise.allSettled([
      api.modelConfigs.get({ provider_id: providerId, model_id: modelId }),
      api.providers.getCapabilities({ provider_id: providerId, model_id: modelId }),
    ]).then(([config, caps]) => {
      if (cancelled) return
      setBoundWindow(
        (config.status === 'fulfilled' ? config.value?.profile.context_window : null) ??
          (caps.status === 'fulfilled' ? caps.value.max_context_tokens : null) ??
          null,
      )
      setSupportsThinking(caps.status === 'fulfilled' ? caps.value.supports_thinking : null)
      setBoundCacheTtls(caps.status === 'fulfilled' ? (caps.value.supported_cache_ttls ?? []) : [])
      setBoundModelCacheTtl(
        (config.status === 'fulfilled' ? config.value?.profile.cache_ttl : undefined) ??
          (caps.status === 'fulfilled' ? caps.value.default_cache_ttl : undefined) ??
          null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [providerId, modelId])

  const parsedContextLimit = contextLimit.trim() === '' ? 0 : Number.parseInt(contextLimit, 10)
  const draftContextLimit = Number.isFinite(parsedContextLimit) ? parsedContextLimit : 0
  const parsedMaxWarm = cacheMaxWarmCount.trim() === '' ? 0 : Number.parseInt(cacheMaxWarmCount, 10)
  const draftMaxWarm = Number.isFinite(parsedMaxWarm) ? Math.max(0, parsedMaxWarm) : null
  const parsedCompactMin = cacheCompactMinTokens.trim() === '' ? 0 : Number.parseInt(cacheCompactMinTokens, 10)
  const draftCompactMin = Number.isFinite(parsedCompactMin) ? Math.max(0, parsedCompactMin) : null
  const modelConflicts = boundAssistantConflicts({
    contextLimit: draftContextLimit,
    thinkingEnabled,
    maxTokens: null,
    modelWindow: boundWindow,
    maxOutput: null,
    supportsThinking,
  })

  useEffect(() => {
    api.mcp.listAllTools().then(setAllTools)
    api.emojis.listPacks({ assistant_id: null }).then(setAllPacks)
    api.tools.listPresets().then(setToolPresets)
    api.emojis
      .listPacks({ assistant_id: assistant.id })
      .then((packs) => setAssignedPackIds(new Set(packs.map((p) => p.id))))
    api.skills.list().then(setAllSkills)
    api.skills
      .listBindings({ layer: 'assistant', anchor_id: assistant.id })
      .then((dirs) => setBoundSkillDirs(new Set(dirs)))
  }, [assistant.id])

  async function handleSave() {
    const enabledTools = toolMode === 'custom' ? [...selectedTools] : null
    const toolPresetId = toolMode === 'preset' && selectedPresetId ? selectedPresetId : null
    setSaveError(null)
    if (modelConflicts.includes('context') && boundWindow !== null) {
      setSaveError(t('settings.assistant.contextLimitExceedsModel', { window: boundWindow }))
      return
    }
    if (modelConflicts.includes('thinking')) {
      setSaveError(t('settings.assistant.thinkingUnsupported'))
      return
    }
    if (draftMaxWarm === null || draftCompactMin === null) {
      setSaveError(t('settings.model.limitInvalidError', { field: t('settings.assistant.cacheExpiryPolicy') }))
      return
    }
    try {
      await onSave(assistant.id, {
        name,
        system_prompt: systemPrompt,
        provider_id: providerId.trim() || null,
        model_id: modelId.trim() || null,
        temperature: temperature ? parseFloat(temperature) : null,
        // Blank is "no override", which the backend stores as 0 and resolves
        // to the model's own window. The same parse the guard used, so the
        // number saved is the number that was checked.
        context_limit: draftContextLimit,
        enabled_tools: enabledTools,
        thinking_enabled: thinkingEnabled,
        thinking_budget: thinkingBudget ? parseInt(thinkingBudget) : null,
        tool_preset_id: toolPresetId,
        auto_compact_enabled: autoCompactEnabled,
        cache_ttl: cacheTtl === '_follow' ? null : (cacheTtl as PromptCacheTtl),
        cache_expiry_policy: cacheExpiryPolicy,
        cache_max_warm_count: draftMaxWarm,
        cache_compact_min_tokens: draftCompactMin,
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
    <div data-slot="assistant-editor" className="m-assistant__editor">
      <SettingsGroup>
        <SettingsRow label={t('settings.assistant.name')} layout="stacked">
          <TextField name={`assistantName-${assistant.id}`} value={name} onChange={setName} />
        </SettingsRow>

        <SettingsRow label={t('settings.assistant.systemPrompt')} layout="stacked">
          <TextArea
            name={`assistantSystemPrompt-${assistant.id}`}
            value={systemPrompt}
            onChange={setSystemPrompt}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void handleSave()
              }
            }}
            rows={6}
          />
        </SettingsRow>

        <div data-slot="assistant-model-picker" className="m-assistant__picker-row">
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
        </div>

        <SettingsRow label={t('settings.assistant.temperature')}>
          <div className="m-assistant__compact-field">
            <NumberField
              value={draftToNumber(temperature)}
              onChange={(value) => setTemperature(numberToDraft(value))}
              name={`assistantTemperature-${assistant.id}`}
              placeholder={t('settings.assistant.providerDefault')}
              minValue={0}
              maxValue={2}
              step={0.1}
              formatOptions={{ maximumFractionDigits: 2 }}
            />
          </div>
        </SettingsRow>

        {/* Over the model's window it is an error, said as one; under it, the
            window is the cap the field is read against. */}
        <SettingsRow
          label={t('settings.assistant.contextLimit')}
          description={
            boundWindow !== null && !modelConflicts.includes('context') ? (
              <span data-slot="assistant-context-cap">
                {t('settings.assistant.contextLimitCap', { window: boundWindow })}
              </span>
            ) : undefined
          }
        >
          <div className="m-assistant__compact-field">
            <NumberField
              name={`assistantContextLimit-${assistant.id}`}
              value={draftToNumber(contextLimit)}
              onChange={(value) => setContextLimit(numberToDraft(value))}
              placeholder={t('settings.assistant.contextLimitFromModel')}
              formatOptions={{ maximumFractionDigits: 0 }}
              isInvalid={modelConflicts.includes('context')}
              errorMessage={
                boundWindow !== null
                  ? t('settings.assistant.contextLimitExceedsModel', { window: boundWindow })
                  : undefined
              }
            />
          </div>
        </SettingsRow>

        <SettingsRow label={t('settings.assistant.autoCompact')} description={t('settings.assistant.autoCompactHint')}>
          <Switch isSelected={autoCompactEnabled} onChange={setAutoCompactEnabled} />
        </SettingsRow>

        {(boundCacheTtls.length > 0 || cacheTtl !== '_follow') && (
          <SettingsRow label={t('settings.assistant.cacheTtl')} description={t('settings.assistant.cacheTtlHint')}>
            <SettingsSelect
              ariaLabel={t('settings.assistant.cacheTtl')}
              value={cacheTtl}
              options={[
                {
                  value: '_follow',
                  label: boundModelCacheTtl
                    ? t('settings.assistant.cacheTtlFollowModel', {
                        value: t(`settings.cacheTtl.${boundModelCacheTtl}`),
                      })
                    : t('settings.assistant.cacheTtlFollowModelPlain'),
                },
                ...Array.from(
                  new Set<PromptCacheTtl>([
                    ...boundCacheTtls,
                    ...(cacheTtl !== '_follow' ? [cacheTtl as PromptCacheTtl] : []),
                  ]),
                ).map((ttl) => ({ value: ttl, label: t(`settings.cacheTtl.${ttl}`) })),
              ]}
              onChange={setCacheTtl}
            />
          </SettingsRow>
        )}

        <SettingsRow
          label={t('settings.assistant.cacheExpiryPolicy')}
          description={t('settings.assistant.cacheExpiryPolicyHint')}
        >
          <SettingsSelect
            ariaLabel={t('settings.assistant.cacheExpiryPolicy')}
            value={cacheExpiryPolicy}
            options={[
              { value: 'off', label: t('settings.assistant.cacheExpiryPolicy.off') },
              { value: 'warm', label: t('settings.assistant.cacheExpiryPolicy.warm') },
              { value: 'compact', label: t('settings.assistant.cacheExpiryPolicy.compact') },
              { value: 'warm_then_compact', label: t('settings.assistant.cacheExpiryPolicy.warm_then_compact') },
            ]}
            onChange={(value) => setCacheExpiryPolicy(value as CacheExpiryPolicy)}
          />
        </SettingsRow>

        {(cacheExpiryPolicy === 'warm' || cacheExpiryPolicy === 'warm_then_compact') && (
          <SettingsRow
            label={t('settings.assistant.cacheMaxWarmCount')}
            description={t('settings.assistant.cacheMaxWarmCountHint')}
          >
            <div className="m-assistant__compact-field">
              <NumberField
                name={`assistantCacheMaxWarmCount-${assistant.id}`}
                value={draftToNumber(cacheMaxWarmCount)}
                onChange={(value) => setCacheMaxWarmCount(numberToDraft(value))}
                minValue={0}
                maxValue={20}
                formatOptions={{ maximumFractionDigits: 0 }}
              />
            </div>
          </SettingsRow>
        )}

        {(cacheExpiryPolicy === 'compact' || cacheExpiryPolicy === 'warm_then_compact') && (
          <SettingsRow
            label={t('settings.assistant.cacheCompactMinTokens')}
            description={t('settings.assistant.cacheCompactMinTokensHint')}
          >
            <div className="m-assistant__compact-field">
              <NumberField
                name={`assistantCacheCompactMinTokens-${assistant.id}`}
                value={draftToNumber(cacheCompactMinTokens)}
                onChange={(value) => setCacheCompactMinTokens(numberToDraft(value))}
                minValue={0}
                step={5000}
                formatOptions={{ maximumFractionDigits: 0 }}
              />
            </div>
          </SettingsRow>
        )}

        <SettingsRow label={t('settings.assistant.thinking')} description={t('settings.assistant.thinkingEnabled')}>
          <Switch isSelected={thinkingEnabled} onChange={setThinkingEnabled} />
        </SettingsRow>

        {thinkingEnabled && (
          <SettingsRow
            label={t('settings.assistant.thinkingBudget')}
            description={t('settings.assistant.thinkingBudgetHint')}
          >
            <div className="m-assistant__compact-field">
              <NumberField
                name={`assistantThinkingBudget-${assistant.id}`}
                value={draftToNumber(thinkingBudget)}
                onChange={(value) => setThinkingBudget(numberToDraft(value))}
                placeholder={t('settings.assistant.thinkingBudget')}
                formatOptions={{ maximumFractionDigits: 0 }}
              />
            </div>
          </SettingsRow>
        )}
      </SettingsGroup>

      {modelConflicts.includes('thinking') && (
        <p data-slot="assistant-thinking-unsupported" className="m-assistant__danger">
          {t('settings.assistant.thinkingUnsupported')}
        </p>
      )}

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
        <SegmentedControl
          data-slot="segment"
          aria-label={t('settings.assistant.tools')}
          className="m-assistant__segment"
          selectedKey={toolMode}
          onSelectionChange={(key) => {
            if (key === 'all' || key === 'preset' || key === 'custom') setToolMode(key)
          }}
        >
          <Segment id="all">{t('settings.assistant.toolsAll')}</Segment>
          {toolPresets.length > 0 && <Segment id="preset">{t('settings.tools.preset')}</Segment>}
          <Segment id="custom">{t('settings.assistant.toolsCustom')}</Segment>
        </SegmentedControl>
        {toolMode === 'preset' && (
          <SettingsSelect
            ariaLabel={t('settings.tools.preset')}
            value={selectedPresetId || '_none'}
            options={presetOptions}
            onChange={(v) => setSelectedPresetId(v === '_none' ? '' : v)}
          />
        )}
        {toolMode === 'custom' && (
          <div data-slot="tool-list" className="m-assistant__scroll">
            {/* `role="group"` with a name, rather than `CheckboxGroup`: the
                boxes below commit one at a time and two of the three sibling
                grids write straight through to the backend on each toggle. A
                group-level value would mean diffing an array back into "which
                one changed", which is a lot of new failure for a label. */}
            <div
              data-slot="tool-grid"
              role="group"
              aria-label={t('settings.assistant.tools')}
              className="m-assistant__checks"
            >
              {allTools.map((tool) => (
                <Checkbox
                  key={tool.name}
                  isSelected={selectedTools.has(tool.name)}
                  onChange={(selected) => {
                    const next = new Set(selectedTools)
                    if (selected) next.add(tool.name)
                    else next.delete(tool.name)
                    setSelectedTools(next)
                  }}
                >
                  <span data-slot="tool-name" onPointerEnter={titleIfTruncated} className="m-assistant__mono">
                    {tool.name}
                  </span>
                  {tool.source === 'mcp' && (
                    <span data-slot="tool-source" className="m-assistant__hint">
                      MCP
                    </span>
                  )}
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
            className="m-assistant__checks m-assistant__checks--framed"
          >
            {allPacks.map((pack) => (
              <Checkbox
                key={pack.id}
                isSelected={assignedPackIds.has(pack.id)}
                onChange={async (selected) => {
                  await api.emojis.setPackAssignment({
                    assistant_id: assistant.id,
                    pack_id: pack.id,
                    assigned: selected,
                  })
                  if (selected) {
                    setAssignedPackIds((prev) => new Set([...prev, pack.id]))
                  } else {
                    setAssignedPackIds((prev) => {
                      const next = new Set(prev)
                      next.delete(pack.id)
                      return next
                    })
                  }
                }}
              >
                <span data-slot="emoji-pack-name" onPointerEnter={titleIfTruncated} className="m-assistant__truncate">
                  {pack.name}
                </span>
              </Checkbox>
            ))}
          </div>
        </SettingsDrilldown>
      )}

      {allSkills.length > 0 && (
        <SettingsDrilldown title={t('settings.skills.assistantSection')} summary={boundSkillDirs.size || undefined}>
          <p data-slot="skill-hint" className="m-assistant__hint">
            {t('settings.skills.assistantHint')}
          </p>
          <div data-slot="skill-list" className="m-assistant__scroll">
            <div
              data-slot="skill-grid"
              role="group"
              aria-label={t('settings.skills.assistantSection')}
              className="m-assistant__checks"
            >
              {allSkills.map((skill) => (
                <Checkbox
                  key={skill.dir_name}
                  isSelected={boundSkillDirs.has(skill.dir_name)}
                  isDisabled={!skill.is_enabled}
                  onChange={async (selected) => {
                    setSkillError(null)
                    try {
                      // The cap on bindings per anchor lives in the backend, so
                      // take the returned set rather than guessing locally.
                      const next = await api.skills.setBinding({
                        layer: 'assistant',
                        anchor_id: assistant.id,
                        dir_name: skill.dir_name,
                        bound: selected,
                      })
                      setBoundSkillDirs(new Set(next))
                    } catch (e) {
                      setSkillError(String(e))
                    }
                  }}
                >
                  <span data-slot="skill-name" onPointerEnter={titleIfTruncated} className="m-assistant__truncate">
                    {skill.display_name}
                  </span>
                </Checkbox>
              ))}
            </div>
          </div>
          {skillError && (
            <Alert data-slot="skill-error" tone="danger" shouldAnnounce>
              {skillError}
            </Alert>
          )}
        </SettingsDrilldown>
      )}

      {saveError && (
        <Alert data-slot="assistant-save-error" tone="danger" shouldAnnounce>
          {saveError}
        </Alert>
      )}
      <div data-slot="assistant-editor-actions" className="m-assistant__actions">
        <Button onPress={handleSave}>{t('common.save')}</Button>
        {saved && <SavedHint />}
        {onDelete && (
          <Button
            variant="destructive"
            className="m-assistant__aside"
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
    return confirm({ description: t('settings.unsavedChanges'), confirmLabel: t('common.discardChanges') })
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
    const [aList, pList] = await Promise.all([api.assistants.list(), api.providers.list()])
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
    const a = await api.assistants.create({
      name: 'New Assistant',
      system_prompt: 'You are a helpful assistant.',
      model_id: null,
      temperature: null,
      top_p: null,
      max_tokens: null,
    })
    await refresh()
    setExpandedId(a.id)
  }, [refresh, requestLeave])

  const handleSave = useCallback(
    async (id: string, updates: Omit<AssistantUpdateRequest, 'id'>) => {
      await api.assistants.update({ ...updates, id })
      await refresh()
    },
    [refresh],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (
        !(await confirm({
          description: t('settings.confirmDelete.assistant'),
          confirmLabel: t('common.delete'),
          tone: 'danger',
        }))
      )
        return
      await api.assistants.delete({ id })
      setDirtyAssistantId(null)
      if (expandedId === id) setExpandedId(null)
      await refresh()
    },
    [confirm, t, expandedId, refresh],
  )

  if (loading) {
    return <SettingsSkeleton width="wide" />
  }

  if (loadError && assistants.length === 0) {
    return (
      <SettingsPane width="wide">
        <SettingsHeader title={t('settings.assistant.title')} subtitle={t('settings.assistant.subtitle')} />
        <Alert
          tone="danger"
          shouldAnnounce
          heading={t('settings.assistant.loadError')}
          actions={
            <Button
              size="sm"
              variant="secondary"
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
          }
        >
          {loadError}
        </Alert>
      </SettingsPane>
    )
  }

  return (
    <SettingsPane width="wide">
      <SettingsHeader
        title={t('settings.assistant.title')}
        subtitle={t('settings.assistant.subtitle')}
        actions={
          <Button icon={<Plus />} variant="secondary" onPress={handleCreate}>
            {t('settings.assistant.new')}
          </Button>
        }
      />

      {/* One open at a time is the group's own default (`allowsMultipleExpanded`
          is off), so the single-open rule lives in the primitive rather than in
          the click handler. */}
      <SettingsGroup>
        <DisclosureGroup
          className="m-assistant__rows"
          expandedKeys={expandedId ? [expandedId] : []}
          onExpandedChange={(keys) => void changeExpanded(([...keys][0] as string | undefined) ?? null)}
        >
          {assistants.map((a) => {
            const isExpanded = expandedId === a.id
            const isDefault = a.is_default
            const providerName = providers.find((p) => p.id === a.provider_id)?.name

            return (
              <Disclosure key={a.id} id={a.id} className="m-assistant__row-card">
                <Heading className="m-assistant__row-heading">
                  <AriaButton slot="trigger" className="m-assistant__trigger">
                    <span
                      data-slot="assistant-row-name"
                      onPointerEnter={titleIfTruncated}
                      className="m-assistant__row-name"
                    >
                      {a.name}
                    </span>
                    {isDefault && (
                      <span data-slot="assistant-row-default" className="m-assistant__default">
                        <Star size={14} aria-hidden />
                        <span data-slot="assistant-row-default-label" className="m-assistant__saved">
                          {t('settings.assistant.defaultBadge')}
                        </span>
                      </span>
                    )}
                    {providerName && (
                      <span
                        data-slot="assistant-row-provider"
                        onPointerEnter={titleIfTruncated}
                        className="m-assistant__meta"
                      >
                        {providerName}
                      </span>
                    )}
                    {a.model_id && (
                      <span
                        data-slot="assistant-row-model"
                        onPointerEnter={titleIfTruncated}
                        className="m-assistant__meta"
                      >
                        {a.model_id}
                      </span>
                    )}
                    <ChevronRight size={16} aria-hidden className="m-assistant__chevron" />
                  </AriaButton>
                </Heading>
                <DisclosurePanel className="m-assistant__panel">
                  {isExpanded && (
                    <AssistantEditor
                      assistant={a}
                      providers={providers}
                      onSave={handleSave}
                      onDelete={isDefault ? undefined : handleDelete}
                      onDirtyChange={handleDirtyChange}
                    />
                  )}
                </DisclosurePanel>
              </Disclosure>
            )
          })}
        </DisclosureGroup>
      </SettingsGroup>

      {/* Shares this tab's provider list rather than fetching its own: it is the
          same question — which model runs this — asked about a different kind
          of agent. */}
      <SubAgentSettings providers={providers} />
      <AuxiliaryModelSettings providers={providers} />
      {confirmDialog}
    </SettingsPane>
  )
}
