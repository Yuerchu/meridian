import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button as AriaButton,
  GridList,
  GridListItem,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type Key,
} from 'react-aria-components'
import { Bot, Check, ChevronDown } from '@keyline-icons/react/two-tone'

import {
  Dropdown,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
  ListBox,
  Popover,
  SearchField,
  Spinner,
  Switch,
} from '@/components/base'
import { ModelIcon } from '@/components/ui/model-icon'
import { ProviderMark } from '@/components/ui/provider-icon'
import { useProviderModels } from '@/hooks/use-provider-models'
import { currentValueName, knobName, knobValueName } from '@/lib/acp-knob-names'
import { allowedEfforts } from '@/lib/thinking'
import { cx } from '@/utils/cx'
import type {
  AcpConfigOptionInfoResponse,
  AssistantInfoResponse,
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

const THINKING_LEVELS: ThinkingLevel[] = ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh']

interface EffortChoice {
  id: string
  label: string
  description?: string
}

const TRIGGER = cx(
  'group inline-flex h-8 min-w-0 max-w-56 shrink items-center gap-0.5 rounded-xl ps-2 pe-1',
  'text-body-medium text-text-secondary transition-colors duration-150',
  'data-[hovered]:bg-background-primary-hover data-[pressed]:bg-background-primary-hover aria-expanded:bg-background-primary-hover',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
)

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
    <Popover.Trigger data-slot="model-panel-trigger" aria-label={label} isDisabled={isDisabled} className={TRIGGER}>
      <span data-slot="model-panel-trigger-model" className="truncate px-0.5">
        {model}
      </span>
      {/* Off its default only, and dropped on a narrow composer: a standing
          "· default" is noise, and its width is the width Send needs. */}
      {effort && (
        <span data-slot="model-panel-trigger-effort" className="shrink-0 @max-[400px]/composer:hidden">
          · {effort}
        </span>
      )}
      <ChevronDown
        aria-hidden
        className="size-[18px] shrink-0 transition-transform duration-200 group-aria-expanded:rotate-180 motion-reduce:transition-none"
      />
    </Popover.Trigger>
  )
}

/** The selected row's effort, as a chip opening the list of levels. */
function EffortChip({
  label,
  choices,
  selected,
  onSelect,
  isDisabled,
}: {
  label: string
  choices: EffortChoice[]
  selected: string
  onSelect: (id: string) => void
  isDisabled?: boolean
}) {
  const current = choices.find((c) => c.id === selected)
  return (
    <Popover>
      <AriaButton
        data-slot="effort-chip"
        aria-label={`${label}: ${current?.label ?? selected}`}
        isDisabled={isDisabled}
        className={cx(
          'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-background-tertiary-default py-0.5 ps-2 pe-1',
          'text-body-2-medium text-text-secondary outline-none transition-colors duration-150',
          'data-[hovered]:bg-background-tertiary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        )}
      >
        {current?.label ?? selected}
        <ChevronDown aria-hidden className="size-4 -rotate-90" />
      </AriaButton>
      <Popover.Content placement="bottom end" className="w-[266px] p-1">
        <Popover.Dialog aria-label={label}>
          <p className="px-2 pb-1 pt-1.5 text-body-2-medium text-text-secondary">{label}</p>
          <ListBox
            aria-label={label}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[selected]}
            onSelectionChange={(keys) => {
              const next = [...(keys as Set<Key>)][0]
              if (next !== undefined && String(next) !== selected) onSelect(String(next))
            }}
          >
            {choices.map((choice) => (
              <ListBox.Item key={choice.id} id={choice.id} textValue={choice.label}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-medium">{choice.label}</span>
                  {choice.description && (
                    <span className="truncate text-caption-1-regular text-text-secondary">{choice.description}</span>
                  )}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

interface ModelRow {
  key: string
  modelId: string
  name: string
  /** Shown beside the name in search results, where providers are mixed. */
  provider?: string
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
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-1 outline-none scrollbar-none"
    >
      {rows.map((row) => {
        const selected = row.key === selectedKey
        return (
          <GridListItem
            key={row.key}
            id={row.key}
            textValue={row.provider ? `${row.name} ${row.provider}` : row.name}
            className={cx(
              'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-2lg px-2 outline-none transition-colors duration-150',
              'data-[hovered]:bg-background-primary-hover data-[selected]:bg-background-primary-hover',
              'data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
            )}
          >
            <ModelIcon model={row.modelId} size={16} className="shrink-0" />
            <span
              data-slot="model-panel-row-name"
              title={row.name}
              className="min-w-0 flex-1 truncate text-body-medium text-text-primary"
            >
              {row.name}
              {row.provider && <span className="ms-1.5 text-text-secondary">{row.provider}</span>}
            </span>
            {selected && extra}
            {selected && <Check aria-hidden className="size-4 shrink-0 text-text-secondary" />}
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
      <SearchField aria-label={t('composer.searchModels')} value={search.query} onChange={search.setQuery}>
        <SearchField.Group className="h-8 bg-background-secondary-default">
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={t('composer.searchModels')} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
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
  const models = useProviderModels(props.providers, open)
  const search = useQuickSearch()
  const [railChoice, setRailChoice] = useState<string | null>(null)

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
  const rows: ModelRow[] = query
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
  const selectedKey =
    props.currentProviderId && props.currentModelId ? `${props.currentProviderId}:${props.currentModelId}` : null

  const empty =
    models.state === 'loading' || models.state === 'idle' ? (
      <div className="flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    ) : (
      <p data-slot="model-panel-empty" className="px-2 py-6 text-center text-caption-1-regular text-text-secondary">
        {query
          ? t('composer.noModelsMatch')
          : models.state === 'failed'
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
    <Popover
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
      <Popover.Content placement="top end" className="w-[341px] p-0.5">
        <Popover.Dialog aria-label={t('composer.modelPanel')}>
          {/* The keyboard shortcuts for the search listen here, inside the panel
              only: `/` in the field is a slash command and must stay one. */}
          <div onKeyDown={search.onKeyDown} className="flex h-[min(18rem,calc(100dvh-6rem))] gap-2">
            {groups.length > 1 && !query && (
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
                className="flex w-[42px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto rounded-2xl bg-composer-panel-rail-background p-[3px] outline-none scrollbar-none"
              >
                {groups.map(({ provider }) => (
                  <AriaListBoxItem
                    key={provider.id}
                    id={provider.id}
                    textValue={provider.name}
                    aria-label={provider.name}
                    className={cx(
                      'flex h-[30px] w-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors duration-150',
                      'data-[hovered]:bg-background-tertiary-default data-[selected]:bg-background-tertiary-default',
                      'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
                    )}
                  >
                    <span title={provider.name} className="flex">
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
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1.5 pe-1.5">
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
                      choices={effortChoices}
                      selected={props.thinkingLevel}
                      onSelect={(id) => props.onSelectThinkingLevel(id as ThinkingLevel)}
                    />
                  ) : null
                }
              />
              <div
                data-slot="model-panel-footer"
                className="flex items-center justify-between gap-2 border-t border-separator-border pt-1.5"
              >
                {props.assistants.length > 0 ? (
                  <Dropdown>
                    <DropdownTrigger
                      data-slot="model-panel-assistant"
                      aria-label={`${t('toolbar.assistant')}: ${currentAssistant?.name ?? t('toolbar.noAssistant')}`}
                      className="inline-flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-body-2-medium text-text-secondary transition-colors duration-150 data-[hovered]:bg-background-primary-hover"
                    >
                      <Bot aria-hidden className="size-4 shrink-0" />
                      <span className="truncate">{currentAssistant?.name ?? t('toolbar.noAssistant')}</span>
                    </DropdownTrigger>
                    <DropdownPopover
                      aria-label={t('toolbar.assistant')}
                      placement="top start"
                      selectionMode="single"
                      disallowEmptySelection
                      selectedKeys={props.currentAssistantId ? [props.currentAssistantId] : []}
                      onAction={(key: Key) => props.onSelectAssistant(String(key))}
                    >
                      {props.assistants.map((a) => (
                        <DropdownItem key={a.id} id={a.id} textValue={a.name}>
                          <span className="min-w-0 flex-1 truncate text-body-medium">{a.name}</span>
                        </DropdownItem>
                      ))}
                    </DropdownPopover>
                  </Dropdown>
                ) : (
                  <span />
                )}
                {props.capabilities?.supports_fast === true && (
                  <Switch size="sm" isSelected={props.fastMode} onChange={props.onToggleFast} className="shrink-0">
                    <span className="text-body-2-medium text-text-secondary">{t('toolbar.fast')}</span>
                  </Switch>
                )}
              </div>
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
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
  const effortName = effort && effort.currentValue !== 'default' ? currentValueName(t, effort) : null
  const rows: ModelRow[] = (model?.options ?? []).map((v) => ({
    key: v.value,
    modelId: v.value,
    name: knobValueName(t, model!, v),
  }))
  const label = model ? knobName(t, model) : t('composer.modelPanel')
  return (
    <Popover>
      <PanelTrigger
        model={modelName ?? effortName ?? label}
        effort={modelName ? effortName : null}
        label={`${label}: ${[modelName, effortName].filter(Boolean).join(' · ')}`}
        isDisabled={busy}
      />
      <Popover.Content placement="top end" className="w-[341px] p-1.5">
        <Popover.Dialog aria-label={label} className="flex max-h-[min(18rem,calc(100dvh-6rem))] flex-col">
          <ModelList
            label={label}
            rows={rows}
            selectedKey={typeof model?.currentValue === 'string' ? model.currentValue : null}
            onSelect={(value) => model && value !== model.currentValue && onSet(model.id, value)}
            empty={null}
            extra={
              effort ? (
                <EffortChip
                  label={knobName(t, effort)}
                  choices={effort.options.map((v) => ({
                    id: v.value,
                    label: knobValueName(t, effort, v),
                    description: v.description ?? undefined,
                  }))}
                  selected={typeof effort.currentValue === 'string' ? effort.currentValue : ''}
                  onSelect={(value) => onSet(effort.id, value)}
                  isDisabled={busy}
                />
              ) : null
            }
          />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
