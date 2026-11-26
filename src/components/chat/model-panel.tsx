import { DialogTrigger, Dialog as PopoverDialog, Button as PopoverButton } from 'react-aria-components'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { Slider } from '@/components/yuerchu-ui/components/slider/slider'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button as AriaButton,
  GridList,
  GridListItem,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type Key,
} from 'react-aria-components'
import { Bot, Check, ChevronDown, TriangleAlert } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { Menu, MenuItem, MenuTrigger } from '@/components/yuerchu-ui/components/menu/menu'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { SearchField } from '@/components/yuerchu-ui/components/search-field/search-field'
import { ModelIcon } from '@/components/ui/model-icon'
import { ProviderMark } from '@/components/ui/provider-icon'
import { useProviderModels } from '@/hooks/use-provider-models'
import { currentValueName, knobName, knobValueName } from '@/lib/acp-knob-names'
import { EFFORT_LADDER, allowedEfforts } from '@/lib/thinking'
import './model-panel.css'
import type {
  AcpConfigOptionInfoResponse,
  AssistantInfoResponse,
  LogicalModelInfoResponse,
  ModelDeploymentInfoResponse,
  ProviderCapabilitiesInfoResponse,
  ProviderInfoResponse,
  ThinkingEffort,
  ThinkingLevel,
} from '@/types'

/**
 * Which model answers and how hard it thinks, in a panel of its own at the
 * toolbar's right end, beside the microphone and Send.
 *
 * Modelled on BoardUI Pro composer-panel's model picker: a rail of providers
 * down the left, the chosen provider's models on the right, a search across all
 * of them, and the effort as a chip on the selected model's row — because how
 * hard to think is a property of the model being used, and the two are chosen
 * together far more often than either alone. The model and the effort were two
 * submenus of the `+` menu before, a menu of everything about a turn.
 *
 * Our effort ladder includes `default` and `off`, which do not sit on Pro's
 * faster-to-smarter axis, so the chip opens a list rather than a slider.
 */

// From the canonical ladder rather than restated: a copy here once left out
// `max`, so a model advertising it could not be given it from the panel.
const THINKING_LEVELS: ThinkingLevel[] = ['default', 'off', ...EFFORT_LADDER]

interface EffortChoice {
  id: string
  label: string
  description?: string
}

function PanelTrigger({
  model,
  effort,
  label,
  isDisabled,
}: {
  model: string
  effort?: string | null
  label: string
  isDisabled?: boolean
}) {
  return (
    <PopoverButton
      data-slot="model-panel-trigger"
      aria-label={label}
      isDisabled={isDisabled}
      className="m-model-panel__trigger"
    >
      <span data-slot="model-panel-trigger-model" className="m-model-panel__trigger-model">
        {model}
      </span>
      {/* Off its default only, and dropped on a narrow composer: a standing
          "· default" is noise, and its width is the width Send needs. */}
      {effort && (
        <span data-slot="model-panel-trigger-effort" className="m-model-panel__trigger-effort">
          · {effort}
        </span>
      )}
      <ChevronDown aria-hidden className="m-model-panel__trigger-chevron" />
    </PopoverButton>
  )
}

/** The level a slider rests on when it has none of its own to show. */
function middleStep(count: number): number {
  return Math.max(0, Math.floor((count - 1) / 2))
}

/**
 * The effort as a slider from faster to deeper, with "follow the default" as a
 * switch beside it.
 *
 * `default` (the assistant's setting, or the agent's) is not a point on that
 * axis, so it is not a stop on the track: it is the switch, and while it is on
 * the slider is greyed and shows where the level would go. Every other level —
 * `off` included, as the fastest — is a stop. The value moves while the thumb
 * is dragged and is stored when it is let go, so a drag is one write rather
 * than one per stop crossed. The header names the level and is a polite live
 * region, because a slider's own value text is only a number here.
 *
 * Pro's slider plays a WebGL flame at its top stop; none here yet.
 */
function EffortSlider({
  label,
  followLabel,
  choices,
  selected,
  onSelect,
  isDisabled,
}: {
  label: string
  followLabel: string
  choices: EffortChoice[]
  selected: string
  onSelect: (id: string) => void
  isDisabled?: boolean
}) {
  const { t } = useTranslation()
  const followable = choices.some((c) => c.id === 'default')
  const steps = choices.filter((c) => c.id !== 'default')
  const following = followable && selected === 'default'
  const selectedStep = steps.findIndex((c) => c.id === selected)
  // Where the thumb sits while the default is followed, and where switching
  // the default off lands: the last level chosen here, else the middle.
  // Remembered by id, not by position — the levels arrive with the model's
  // capabilities, possibly after the popover opened, and a remembered index
  // into the longer fallback list would point past the shorter real one (the
  // slider out of range, the switch writing `default` back).
  const [restingId, setRestingId] = useState<string | null>(selectedStep >= 0 ? selected : null)
  if (selectedStep >= 0 && restingId !== selected) setRestingId(selected)
  const remembered = restingId === null ? -1 : steps.findIndex((c) => c.id === restingId)
  const restingStep = remembered >= 0 ? remembered : middleStep(steps.length)
  const [dragging, setDragging] = useState<number | null>(null)
  const index = dragging ?? (selectedStep >= 0 ? selectedStep : restingStep)
  const current = following ? choices.find((c) => c.id === 'default') : steps[index]

  return (
    <div data-slot="effort-slider" className="m-model-panel__effort-slider">
      <div className="m-model-panel__effort-heading">
        <p aria-live="polite" className="m-model-panel__effort-label">
          {label} · <span className="m-model-panel__effort-value">{current?.label ?? selected}</span>
        </p>
        {followable && (
          <Switch
            size="sm"
            isSelected={following}
            isDisabled={isDisabled}
            onChange={(on) => onSelect(on ? 'default' : (steps[restingStep]?.id ?? 'default'))}
            className="m-model-panel__fixed"
          >
            <span className="m-model-panel__follow-label">{followLabel}</span>
          </Switch>
        )}
      </div>
      {current?.description && (
        <p data-slot="effort-slider-description" className="m-model-panel__description">
          {current.description}
        </p>
      )}
      {steps.length > 1 && (
        <>
          <Slider
            aria-label={label}
            showValue={false}
            minValue={0}
            maxValue={steps.length - 1}
            step={1}
            value={index}
            isDisabled={isDisabled || following}
            onChange={(value) => setDragging(value as number)}
            onChangeEnd={(value) => {
              setDragging(null)
              const next = steps[value as number]
              if (next && next.id !== selected) onSelect(next.id)
            }}
          />
          <div aria-hidden className="m-model-panel__effort-scale">
            <span>{t('composer.effortFaster')}</span>
            <span>{t('composer.effortDeeper')}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** The selected row's effort, as a chip opening its slider. */
function EffortChip({
  label,
  followLabel,
  choices,
  selected,
  onSelect,
  isDisabled,
}: {
  label: string
  followLabel: string
  choices: EffortChoice[]
  selected: string
  onSelect: (id: string) => void
  isDisabled?: boolean
}) {
  const current = choices.find((c) => c.id === selected)
  return (
    <DialogTrigger>
      <AriaButton
        data-slot="effort-chip"
        aria-label={`${label}: ${current?.label ?? selected}`}
        isDisabled={isDisabled}
        className="m-model-panel__chip"
      >
        {current?.label ?? selected}
        <ChevronDown aria-hidden className="m-model-panel__chip-chevron" />
      </AriaButton>
      <Popover offset={8} placement="bottom end" className="m-model-panel__effort-popover">
        <PopoverDialog aria-label={label}>
          <div className="m-model-panel__effort-content">
            <EffortSlider
              label={label}
              followLabel={followLabel}
              choices={choices}
              selected={selected}
              onSelect={onSelect}
              // Already open when a write starts: the chip's own disabling does
              // not reach in here, and a second change would race the first.
              isDisabled={isDisabled}
            />
          </div>
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  )
}

interface ModelRow {
  key: string
  modelId: string
  name: string
  /** Shown beside the name in search results, where providers are mixed. */
  provider?: string
  /** Optional inline channel chip / compliance badge in "By model" view. */
  trailing?: ReactNode
}

/** The list of models, one row selected; the selected row carries `extra`. */
function ModelList({
  rows,
  selectedKey,
  onSelect,
  extra,
  empty,
  label,
}: {
  rows: ModelRow[]
  selectedKey: string | null
  onSelect: (key: string) => void
  extra?: ReactNode
  empty: ReactNode
  label: string
}) {
  return (
    <GridList
      data-slot="model-panel-list"
      aria-label={label}
      selectionMode="single"
      selectedKeys={selectedKey ? [selectedKey] : []}
      onSelectionChange={(keys) => {
        const next = [...(keys as Set<Key>)][0]
        if (next !== undefined) onSelect(String(next))
      }}
      renderEmptyState={() => empty}
      className="m-model-panel__list"
    >
      {rows.map((row) => {
        const selected = row.key === selectedKey
        return (
          <GridListItem
            key={row.key}
            id={row.key}
            textValue={row.provider ? `${row.name} ${row.provider}` : row.name}
            className="m-model-panel__row"
          >
            <ModelIcon model={row.modelId} size={16} className="m-model-panel__fixed" />
            <span data-slot="model-panel-row-name" title={row.name} className="m-model-panel__row-name">
              {row.name}
              {row.provider && <span className="m-model-panel__row-provider">{row.provider}</span>}
            </span>
            {row.trailing}
            {selected && extra}
            {selected && <Check aria-hidden className="m-model-panel__check" />}
          </GridListItem>
        )
      })}
    </GridList>
  )
}

/** The panel's search: `/` or Ctrl/⌘+K from anywhere in it, Escape clears first. */
function useQuickSearch() {
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT') return
    if (event.key === '/' || (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault()
      box.current?.querySelector('input')?.focus()
    }
  }
  return { query, setQuery, box, onKeyDown }
}

function PanelSearch({ search }: { search: ReturnType<typeof useQuickSearch> }) {
  const { t } = useTranslation()
  return (
    <div ref={search.box}>
      <SearchField
        aria-label={t('composer.searchModels')}
        value={search.query}
        onChange={search.setQuery}
        placeholder={t('composer.searchModels')}
      />
    </div>
  )
}

export interface ModelPanelProps {
  assistants: AssistantInfoResponse[]
  providers: ProviderInfoResponse[]
  currentAssistantId: string | null
  currentModelId: string | null
  currentProviderId: string | null
  onSelectAssistant: (id: string) => void
  onSelectModel: (modelId: string, providerId: string) => void
  thinkingLevel: ThinkingLevel
  onSelectThinkingLevel: (level: ThinkingLevel) => void
  fastMode: boolean
  onToggleFast: (next: boolean) => void
  capabilities?: ProviderCapabilitiesInfoResponse | null
}

/** This app's own turn: every enabled provider's models, the effort, the assistant and fast mode. */
export function ModelPanel(props: ModelPanelProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'provider' | 'model'>('provider')
  const [logicalModels, setLogicalModels] = useState<LogicalModelInfoResponse[]>([])
  const [logicalLoading, setLogicalLoading] = useState(false)
  const canUseModelView = typeof api.logicalModels?.list === 'function'
  const models = useProviderModels(props.providers, open)
  const search = useQuickSearch()
  const [railChoice, setRailChoice] = useState<string | null>(null)

  useEffect(() => {
    if (!open || viewMode !== 'model' || !canUseModelView) return
    let cancelled = false
    setLogicalLoading(true)
    api.logicalModels
      .list()
      .then((list) => {
        if (!cancelled) setLogicalModels(list)
      })
      .catch((err) => {
        console.error('Failed to load logical models:', err)
      })
      .finally(() => {
        if (!cancelled) setLogicalLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, viewMode, canUseModelView])

  const supportsThinking = props.capabilities?.supports_thinking !== false
  const efforts = useMemo(() => allowedEfforts(props.capabilities ?? null), [props.capabilities])
  const effortChoices: EffortChoice[] = THINKING_LEVELS.filter(
    (l) =>
      l === 'default' ||
      (l === 'off' && props.capabilities?.supports_thinking_off !== false) ||
      efforts.includes(l as ThinkingEffort),
  ).map((l) => ({ id: l, label: t(`toolbar.thinking.${l}`), description: t(`toolbar.thinking.${l}Desc`) }))

  // The rail opens on the provider answering now, or the first that has models.
  const groups = models.groups
  const railProvider =
    groups.find((g) => g.provider.id === railChoice)?.provider.id ??
    groups.find((g) => g.provider.id === props.currentProviderId)?.provider.id ??
    groups[0]?.provider.id ??
    null

  const query = search.query.trim().toLowerCase()
  const providerRows: ModelRow[] = query
    ? groups.flatMap((g) =>
        g.models
          .filter((m) => `${m.name} ${m.id} ${g.provider.name}`.toLowerCase().includes(query))
          .map((m) => ({
            key: `${g.provider.id}:${m.id}`,
            modelId: m.id,
            name: m.name || m.id,
            provider: g.provider.name,
          })),
      )
    : (groups.find((g) => g.provider.id === railProvider)?.models ?? []).map((m) => ({
        key: `${railProvider}:${m.id}`,
        modelId: m.id,
        name: m.name || m.id,
      }))

  const logicalRows: ModelRow[] = useMemo(() => {
    if (viewMode !== 'model') return []
    const enabledProviderIds = new Set(props.providers.filter((p) => p.is_enabled).map((p) => p.id))
    const out: ModelRow[] = []
    for (const item of logicalModels) {
      if (item.profile.capability_domain !== 'chat') continue
      const enabledDeps = item.deployments.filter((d) => d.is_enabled && enabledProviderIds.has(d.provider_id))
      if (enabledDeps.length === 0) continue
      const matchesQuery =
        !query ||
        `${item.profile.name} ${item.profile.canonical_id ?? ''} ${enabledDeps.map((d) => `${d.provider_name} ${d.model_id}`).join(' ')}`
          .toLowerCase()
          .includes(query)
      if (!matchesQuery) continue
      const activeDep: ModelDeploymentInfoResponse =
        enabledDeps.find((d) => d.provider_id === props.currentProviderId && d.model_id === props.currentModelId) ??
        enabledDeps[0]
      const degraded = activeDep.compliance.status === 'degraded'
      const trailing =
        enabledDeps.length > 1 ? (
          <MenuTrigger>
            <AriaButton
              data-slot="model-channel-chip"
              aria-label={`${t('composer.providerChannel')}: ${activeDep.provider_name}`}
              className="m-model-panel__channel-chip"
              data-degraded={degraded || undefined}
            >
              {degraded && <TriangleAlert aria-hidden size={12} />}
              <span>{activeDep.provider_name}</span>
              <ChevronDown aria-hidden className="m-model-panel__chip-chevron" />
            </AriaButton>
            <Menu
              aria-label={t('composer.providerChannel')}
              placement="bottom end"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[`${activeDep.provider_id}:${activeDep.model_id}`]}
              onAction={(key: Key) => {
                const raw = String(key)
                const at = raw.indexOf(':')
                props.onSelectModel(raw.slice(at + 1), raw.slice(0, at))
              }}
            >
              {enabledDeps.map((dep) => (
                <MenuItem
                  key={`${dep.provider_id}:${dep.model_id}`}
                  id={`${dep.provider_id}:${dep.model_id}`}
                  textValue={dep.provider_name}
                >
                  <span className="m-model-panel__channel-option">
                    {dep.provider_name}
                    {dep.compliance.status === 'degraded' && (
                      <span className="m-model-panel__degraded-tag">{t('settings.models.protocolDegraded')}</span>
                    )}
                  </span>
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        ) : (
          <span
            data-slot="model-channel-badge"
            className="m-model-panel__channel-badge"
            data-degraded={degraded || undefined}
          >
            {degraded && <TriangleAlert aria-hidden size={12} />}
            {activeDep.provider_name}
          </span>
        )
      out.push({
        key: `${activeDep.provider_id}:${activeDep.model_id}`,
        modelId: activeDep.model_id,
        name: item.profile.name,
        trailing,
      })
    }
    return out
  }, [viewMode, logicalModels, props, query, t])

  const rows = viewMode === 'model' ? logicalRows : providerRows
  const selectedKey =
    props.currentProviderId && props.currentModelId ? `${props.currentProviderId}:${props.currentModelId}` : null

  const empty =
    (viewMode === 'provider' && (models.state === 'loading' || models.state === 'idle')) ||
    (viewMode === 'model' && logicalLoading) ? (
      <div className="m-model-panel__loading">
        <Spinner size="sm" />
      </div>
    ) : (
      <p data-slot="model-panel-empty" className="m-model-panel__empty">
        {query
          ? t('composer.noModelsMatch')
          : viewMode === 'provider' && models.state === 'failed'
            ? models.failure
              ? t('toolbar.modelsLoadFailedReason', { error: models.failure })
              : t('toolbar.modelsLoadFailed')
            : t('toolbar.noModels')}
      </p>
    )

  const currentAssistant = props.assistants.find((a) => a.id === props.currentAssistantId)
  const effortLabel =
    supportsThinking && props.thinkingLevel !== 'default' ? t(`toolbar.thinking.${props.thinkingLevel}`) : null

  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) models.retry()
        else search.setQuery('')
      }}
    >
      <PanelTrigger
        model={props.currentModelId ?? t('toolbar.selectModel')}
        effort={effortLabel}
        label={`${t('composer.modelPanel')}: ${props.currentModelId ?? t('toolbar.selectModel')}${effortLabel ? ` · ${effortLabel}` : ''}`}
      />
      <Popover offset={8} placement="top end" className="m-model-panel__popover">
        <PopoverDialog aria-label={t('composer.modelPanel')}>
          {/* The keyboard shortcuts for the search listen here, inside the panel
              only: `/` in the field is a slash command and must stay one. */}
          <div onKeyDown={search.onKeyDown} className="m-model-panel__body">
            {viewMode === 'provider' && groups.length > 1 && !query && (
              <AriaListBox
                data-slot="model-panel-rail"
                aria-label={t('composer.providers')}
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={railProvider ? [railProvider] : []}
                onSelectionChange={(keys) => {
                  const next = [...(keys as Set<Key>)][0]
                  if (next !== undefined) setRailChoice(String(next))
                }}
                className="m-model-panel__rail"
              >
                {groups.map(({ provider }) => (
                  <AriaListBoxItem
                    key={provider.id}
                    id={provider.id}
                    textValue={provider.name}
                    aria-label={provider.name}
                    className="m-model-panel__provider"
                  >
                    <span title={provider.name} className="m-model-panel__provider-mark">
                      <ProviderMark
                        icon={provider.icon}
                        catalogId={provider.catalog_id}
                        providerType={provider.provider_type}
                        size={18}
                      />
                    </span>
                  </AriaListBoxItem>
                ))}
              </AriaListBox>
            )}
            <div className="m-model-panel__main">
              {canUseModelView && (
                <div className="m-model-panel__view-toggle">
                  <SegmentedControl
                    aria-label={t('composer.modelViewMode')}
                    size="sm"
                    selectedKey={viewMode}
                    onSelectionChange={(key) => setViewMode(key === 'model' ? 'model' : 'provider')}
                  >
                    <Segment id="provider">{t('composer.viewByProvider')}</Segment>
                    <Segment id="model">{t('composer.viewByModel')}</Segment>
                  </SegmentedControl>
                </div>
              )}
              <PanelSearch search={search} />
              <ModelList
                label={t('toolbar.models')}
                rows={rows}
                selectedKey={selectedKey}
                onSelect={(key) => {
                  const at = key.indexOf(':')
                  props.onSelectModel(key.slice(at + 1), key.slice(0, at))
                }}
                empty={empty}
                extra={
                  supportsThinking ? (
                    <EffortChip
                      label={t('toolbar.thinking')}
                      followLabel={t('composer.effortFollowAssistant')}
                      choices={effortChoices}
                      selected={props.thinkingLevel}
                      onSelect={(id) => props.onSelectThinkingLevel(id as ThinkingLevel)}
                    />
                  ) : null
                }
              />
              <div data-slot="model-panel-footer" className="m-model-panel__footer">
                {props.assistants.length > 0 ? (
                  <MenuTrigger>
                    <AriaButton
                      data-slot="model-panel-assistant"
                      aria-label={`${t('toolbar.assistant')}: ${currentAssistant?.name ?? t('toolbar.noAssistant')}`}
                      className="m-model-panel__assistant"
                    >
                      <Bot aria-hidden className="m-model-panel__assistant-icon" />
                      <span className="m-model-panel__assistant-name">
                        {currentAssistant?.name ?? t('toolbar.noAssistant')}
                      </span>
                    </AriaButton>
                    <Menu
                      aria-label={t('toolbar.assistant')}
                      placement="top start"
                      selectionMode="single"
                      disallowEmptySelection
                      selectedKeys={props.currentAssistantId ? [props.currentAssistantId] : []}
                      onAction={(key: Key) => props.onSelectAssistant(String(key))}
                    >
                      {props.assistants.map((a) => (
                        <MenuItem key={a.id} id={a.id} textValue={a.name}>
                          <span className="m-model-panel__assistant-option">{a.name}</span>
                        </MenuItem>
                      ))}
                    </Menu>
                  </MenuTrigger>
                ) : (
                  <span />
                )}
                {props.capabilities?.supports_fast === true && (
                  <Switch
                    size="sm"
                    isSelected={props.fastMode}
                    onChange={props.onToggleFast}
                    className="m-model-panel__fixed"
                  >
                    <span className="m-model-panel__fast-label">{t('toolbar.fast')}</span>
                  </Switch>
                )}
              </div>
            </div>
          </div>
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  )
}

/**
 * A hosted agent's model and effort: its own values, set over ACP. No rail and
 * no search — the agent offers one short list — and no assistant or fast mode,
 * which are this app's settings, not the agent's.
 */
export function HostedModelPanel({
  model,
  effort,
  busy,
  onSet,
}: {
  model?: AcpConfigOptionInfoResponse
  effort?: AcpConfigOptionInfoResponse
  busy?: boolean
  onSet: (id: string, value: string) => void
}) {
  const { t } = useTranslation()
  if (!model && !effort) return null
  const modelName = model ? currentValueName(t, model) : null
  const effortName = effort && effort.current_value !== 'default' ? currentValueName(t, effort) : null
  const rows: ModelRow[] = (model?.options ?? []).map((v) => ({
    key: v.value,
    modelId: v.value,
    name: knobValueName(t, model!, v),
  }))
  const label = model ? knobName(t, model) : t('composer.modelPanel')
  const selectedKey = typeof model?.current_value === 'string' ? model.current_value : null
  const effortLabel = effort ? knobName(t, effort) : ''
  const effortChoices: EffortChoice[] = (effort?.options ?? []).map((v) => ({
    id: v.value,
    label: knobValueName(t, effort!, v),
    description: v.description ?? undefined,
  }))
  const effortSelected = typeof effort?.current_value === 'string' ? effort.current_value : ''
  // The effort rides on the selected model's row. With no such row — an agent
  // offering the effort and no model, or a current model it does not list —
  // that chip is never drawn, so the levels are listed here instead, or a
  // setting the trigger shows could not be changed at all.
  const effortOnRow = rows.some((row) => row.key === selectedKey)
  return (
    <DialogTrigger>
      <PanelTrigger
        model={modelName ?? effortName ?? label}
        effort={modelName ? effortName : null}
        label={`${label}: ${[modelName, effortName].filter(Boolean).join(' · ')}`}
        isDisabled={busy}
      />
      <Popover offset={8} placement="top end" className="m-model-panel__hosted-popover">
        <PopoverDialog aria-label={label}>
          <div className="m-model-panel__hosted-content">
            {rows.length > 0 && (
              <ModelList
                label={label}
                rows={rows}
                selectedKey={selectedKey}
                onSelect={(value) => model && value !== model.current_value && onSet(model.id, value)}
                empty={null}
                extra={
                  effort ? (
                    <EffortChip
                      label={effortLabel}
                      followLabel={t('composer.effortFollowDefault')}
                      choices={effortChoices}
                      selected={effortSelected}
                      onSelect={(value) => onSet(effort.id, value)}
                      isDisabled={busy}
                    />
                  ) : null
                }
              />
            )}
            {effort && !effortOnRow && (
              <div
                data-slot="model-panel-effort"
                className="m-model-panel__standalone-effort"
                data-separated={rows.length > 0 || null}
              >
                <EffortSlider
                  label={effortLabel}
                  followLabel={t('composer.effortFollowDefault')}
                  choices={effortChoices}
                  selected={effortSelected}
                  onSelect={(value) => onSet(effort.id, value)}
                  isDisabled={busy}
                />
              </div>
            )}
          </div>
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  )
}
