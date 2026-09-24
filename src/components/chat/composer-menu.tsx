import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Menu as AriaMenu,
  MenuSection as AriaMenuSection,
  Popover as AriaPopover,
  SubmenuTrigger as AriaSubmenuTrigger,
  type Key,
} from 'react-aria-components'
import {
  Bot,
  Check,
  ChevronRight,
  ChevronsRight,
  Compass,
  Cpu,
  Hammer,
  Lightbulb,
  Paperclip,
  Plus,
  Zap,
} from '@keyline-icons/react/two-tone'
import { ModelIcon } from '@/components/ui/model-icon'

import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  PromptInput,
  Spinner,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { MENU_ITEMS_CONTAINER, MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH } from '@/components/base/dropdown/menu-styles'

import { cx } from '@/utils/cx'
import { api } from '@/api'
import { allowedEfforts } from '@/lib/thinking'
import type {
  AssistantInfoResponse,
  ChatMode,
  ProviderInfoResponse,
  ProviderCapabilitiesInfoResponse,
  ProviderModelInfoResponse,
  ThinkingEffort,
  ThinkingLevel,
} from '@/types'

/**
 * Everything the composer can configure, behind one `+`.
 *
 * The toolbar used to lay all of this out in a row, and each control that had
 * something to say said it in words — the mode, the assistant, the model, and
 * two toggles that grow a label when switched on. Six controls wide is fine
 * until three of them are labelled at once, at which point the row is doing the
 * job of a menu without being one.
 *
 * So it is one: the base `Dropdown` (React Aria's `Menu`) whose value rows open
 * a submenu (`SubmenuTrigger`) of the choices, `selectionMode="single"`, so the
 * current value is a `menuitemradio` with `aria-checked`. The two booleans are a
 * `selectionMode="multiple"` section — `menuitemcheckbox` rows that stay open
 * when toggled by pointer or Space. It used to be a hand-built two-column
 * popover of bare buttons, whose "selected" was a background colour and whose
 * keyboard reach from one column to the other was Tab; a submenu is ArrowRight
 * in and ArrowLeft back out, and the rows are the registry's menu rows.
 */

/** A choice inside a value row's submenu. */
interface SubOption {
  value: string
  label: string
  description?: string
  /** Rendered as a section heading above the rows carrying it. */
  group?: string
  icon?: ReactNode
  onSelect: () => void
}

export interface ComposerMenuProps {
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
  mode: ChatMode
  onSelectMode: (mode: ChatMode) => void
  acceptEdits: boolean
  onToggleAcceptEdits: (next: boolean) => void
  capabilities?: ProviderCapabilitiesInfoResponse | null
  onPickFile?: () => void
}

const CHAT_MODES: Array<{ id: ChatMode; icon: typeof Hammer; labelKey: string; descKey: string }> = [
  { id: 'work', icon: Hammer, labelKey: 'toolbar.mode.work', descKey: 'toolbar.mode.workDesc' },
  { id: 'plan', icon: Compass, labelKey: 'toolbar.mode.plan', descKey: 'toolbar.mode.planDesc' },
]

const THINKING_LEVELS: ThinkingLevel[] = ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh']

interface GroupedModels {
  provider: ProviderInfoResponse
  models: ProviderModelInfoResponse[]
}

type Tone = 'muted' | 'info' | 'warning'

function toneText(tone: Tone | undefined) {
  if (tone === 'warning') return 'text-status-warning-soft-foreground'
  if (tone === 'info') return 'text-status-info-soft-foreground'
  return 'text-text-secondary'
}

/** Icon, label and — for a value row — its current value at the end. */
function RowContent({
  icon: Icon,
  label,
  value,
  tone,
  trailing,
}: {
  icon: typeof Hammer
  label: string
  value?: string
  tone?: Tone
  trailing?: ReactNode
}) {
  return (
    <>
      <Icon aria-hidden className={cx('size-4 shrink-0', tone && tone !== 'muted' ? toneText(tone) : undefined)} />
      <span data-slot="composer-menu-item-label" className="min-w-0 flex-1 truncate text-body-medium">
        {label}
      </span>
      {value && (
        <span
          data-slot="composer-menu-item-value"
          className={cx('max-w-24 truncate text-caption-1-regular', toneText(tone))}
        >
          {value}
        </span>
      )}
      {trailing}
    </>
  )
}

/**
 * A value row and the submenu of its choices. The submenu is its own `Menu`
 * with `selectionMode="single"`, so the chosen row is announced as checked.
 */
function ValueSubmenu({
  id,
  icon,
  label,
  value,
  tone,
  selectedKey,
  options,
  loading,
  emptyLabel,
  onOpenIntent,
}: {
  id: string
  icon: typeof Hammer
  label: string
  value: string
  tone?: Tone
  selectedKey: Key | null
  options: SubOption[]
  loading?: boolean
  emptyLabel?: string
  /** First sign the submenu is wanted — hovered, focused or pressed. */
  onOpenIntent?: () => void
}) {
  const groups = useMemo(() => {
    const out: Array<{ name: string | undefined; options: SubOption[] }> = []
    for (const option of options) {
      const last = out[out.length - 1]
      if (last && last.name === option.group) last.options.push(option)
      else out.push({ name: option.group, options: [option] })
    }
    return out
  }, [options])

  const rows = (list: SubOption[]) =>
    list.map((option) => (
      <DropdownItem key={option.value} id={option.value} textValue={option.label} onAction={option.onSelect}>
        {option.icon && (
          <span data-slot="composer-menu-detail-icon" className="shrink-0">
            {option.icon}
          </span>
        )}
        <span data-slot="composer-menu-detail-text" className="min-w-0 flex-1">
          <span data-slot="composer-menu-detail-label" className="block truncate text-body-medium">
            {option.label}
          </span>
          {option.description && (
            <span
              data-slot="composer-menu-detail-description"
              className="block truncate text-caption-1-regular text-text-secondary"
            >
              {option.description}
            </span>
          )}
        </span>
        {option.value === selectedKey && <Check aria-hidden className="size-4 shrink-0 text-text-secondary" />}
      </DropdownItem>
    ))

  return (
    <AriaSubmenuTrigger>
      <DropdownItem
        id={id}
        textValue={`${label}: ${value}`}
        onHoverStart={onOpenIntent}
        onFocus={onOpenIntent}
        onPressStart={onOpenIntent}
      >
        <RowContent
          icon={icon}
          label={label}
          value={value}
          tone={tone}
          trailing={<ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />}
        />
      </DropdownItem>
      <AriaPopover offset={-4} className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, 'max-h-[min(20rem,60svh)]')}>
        <AriaMenu
          aria-label={label}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selectedKey == null ? [] : [selectedKey]}
          renderEmptyState={() => (
            <div
              data-slot="composer-menu-detail-empty"
              className="flex items-center justify-center py-6 text-caption-1-regular text-text-secondary"
            >
              {loading ? <Spinner size="sm" /> : emptyLabel}
            </div>
          )}
          className={MENU_ITEMS_CONTAINER}
        >
          {loading
            ? []
            : groups.map((group, i) =>
                group.name ? (
                  <DropdownGroup key={`${group.name}-${i}`} label={group.name}>
                    {rows(group.options)}
                  </DropdownGroup>
                ) : (
                  rows(group.options)
                ),
              )}
        </AriaMenu>
      </AriaPopover>
    </AriaSubmenuTrigger>
  )
}

export function ComposerMenu(props: ComposerMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [wantModels, setWantModels] = useState(false)
  const [groups, setGroups] = useState<GroupedModels[]>([])
  /**
   * Where the one fetch per opening stands.
   *
   * Not derived from `groups.length`: an answer with no models left that at
   * zero, which read as "not loaded yet" and started the fetch again the moment
   * it finished — for as long as the row stayed hovered. `idle` is the only
   * state that fetches; an empty or failed answer is settled until the menu is
   * opened again, which is what a retry is.
   */
  const [modelsState, setModelsState] = useState<'idle' | 'loading' | 'loaded' | 'empty' | 'failed'>('idle')

  const currentAssistant = props.assistants.find((a) => a.id === props.currentAssistantId)
  const activeMode = CHAT_MODES.find((m) => m.id === props.mode) ?? CHAT_MODES[0]
  const efforts = useMemo(() => allowedEfforts(props.capabilities ?? null), [props.capabilities])

  // Fetched when the model row is first reached rather than when the menu is
  // opened, so opening it to flip a toggle costs nothing.
  useEffect(() => {
    if (!wantModels || modelsState !== 'idle') return
    setModelsState('loading')
    Promise.allSettled(
      props.providers
        .filter((p) => p.is_enabled)
        .map(async (p) => ({
          provider: p,
          models: await api.fetchProviderModels({ providerId: p.id, forceRefresh: false }),
        })),
    ).then((results) => {
      const next = results
        .filter((r): r is PromiseFulfilledResult<GroupedModels> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((g) => g.models.length > 0)
      setGroups(next)
      // Some providers answering is enough to pick from. Nothing answering and
      // at least one refusing is a failure, which is not the same sentence as
      // "you have no models".
      if (next.length > 0) setModelsState('loaded')
      else setModelsState(results.some((r) => r.status === 'rejected') ? 'failed' : 'empty')
    })
  }, [wantModels, modelsState, props.providers])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    // Reopening the menu is the retry for an answer that had nothing in it.
    if (next && (modelsState === 'empty' || modelsState === 'failed')) {
      setWantModels(false)
      setModelsState('idle')
    }
  }

  // Plan mode removes every editing tool, so the switch would be promising to
  // skip approvals that are never going to be requested.
  const offersAcceptEdits = props.mode !== 'plan'
  const offersFast = props.capabilities?.supports_fast === true
  const toggledKeys = [
    ...(offersAcceptEdits && props.acceptEdits ? ['accept-edits'] : []),
    ...(offersFast && props.fastMode ? ['fast'] : []),
  ]

  const thinkingOptions: SubOption[] = THINKING_LEVELS.filter(
    (l) =>
      l === 'default' ||
      (l === 'off' && props.capabilities?.supports_thinking_off !== false) ||
      efforts.includes(l as ThinkingEffort),
  ).map((l) => ({
    value: l,
    label: t(`toolbar.thinking.${l}`),
    description: t(`toolbar.thinking.${l}Desc`),
    onSelect: () => props.onSelectThinkingLevel(l),
  }))

  const currentModelKey =
    props.currentModelId && props.currentProviderId ? `${props.currentProviderId}:${props.currentModelId}` : null

  // Anything not at its default is worth seeing before the menu is opened —
  // otherwise folding the toolbar away would also fold away the fact that
  // approvals are currently being skipped.
  const alert = props.acceptEdits ? 'warning' : props.mode !== 'work' ? 'info' : null

  return (
    <Dropdown isOpen={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger delay={0}>
        {/* The alert dot sits beside the button: the control draws its
            `leadingIcon` and nothing else. Both triggers reach the RAC button
            through context, so the wrapper is inert to them. */}
        <span data-slot="composer-menu-trigger-wrap" className="relative inline-flex">
          {/* The composer's round control (the registry agent-composer's
              add button, `ai-chat-composer-add-*`). */}
          <PromptInput.Control
            leadingIcon={Plus}
            aria-label={t('composer.menu')}
            data-slot="composer-menu-trigger"
            // The registry's "Add to chat" trigger (components.md, Dropdown
            // example) turns its plus into an × while the menu is open.
            className={cx(
              'touch-hitbox [&_svg]:transition-transform [&_svg]:duration-200',
              open && '[&_svg]:rotate-45',
            )}
          />
          {alert && (
            <span
              data-slot="composer-menu-alert"
              className={cx(
                'pointer-events-none absolute right-1 top-1 size-1.5 rounded-full',
                alert === 'warning' ? 'bg-status-warning' : 'bg-status-info',
              )}
            />
          )}
        </span>
        <Tooltip placement="top">{t('composer.menu')}</Tooltip>
      </TooltipTrigger>

      <DropdownPopover aria-label={t('composer.menu')} placement="top start">
        {props.onPickFile ? (
          <DropdownItem id="attach" textValue={t('chat.attachFile')} onAction={props.onPickFile}>
            <RowContent icon={Paperclip} label={t('chat.attachFile')} />
          </DropdownItem>
        ) : null}

        <ValueSubmenu
          id="mode"
          icon={activeMode.icon}
          label={t('toolbar.mode')}
          value={t(activeMode.labelKey)}
          tone={props.mode === 'work' ? 'muted' : 'info'}
          selectedKey={props.mode}
          options={CHAT_MODES.map((m) => ({
            value: m.id,
            label: t(m.labelKey),
            description: t(m.descKey),
            icon: <m.icon aria-hidden className="size-4" />,
            onSelect: () => props.onSelectMode(m.id),
          }))}
        />

        {offersAcceptEdits || offersFast ? (
          // Booleans: `menuitemcheckbox` rows, which a pointer or Space
          // toggles without closing the menu.
          <AriaMenuSection selectionMode="multiple" selectedKeys={toggledKeys} className="flex w-full flex-col gap-1">
            {offersAcceptEdits ? (
              <DropdownItem
                id="accept-edits"
                textValue={t('toolbar.acceptEdits')}
                onAction={() => props.onToggleAcceptEdits(!props.acceptEdits)}
              >
                <RowContent
                  icon={ChevronsRight}
                  label={t('toolbar.acceptEdits')}
                  value={props.acceptEdits ? t('toolbar.acceptEdits.on') : t('toolbar.acceptEdits.off')}
                  tone={props.acceptEdits ? 'warning' : 'muted'}
                />
              </DropdownItem>
            ) : null}
            {offersFast ? (
              <DropdownItem
                id="fast"
                textValue={t('toolbar.fast')}
                onAction={() => props.onToggleFast(!props.fastMode)}
              >
                <RowContent
                  icon={Zap}
                  label={t('toolbar.fast')}
                  value={props.fastMode ? t('toolbar.fast.on') : t('toolbar.fast.off')}
                  tone={props.fastMode ? 'warning' : 'muted'}
                />
              </DropdownItem>
            ) : null}
          </AriaMenuSection>
        ) : null}

        <ValueSubmenu
          id="assistant"
          icon={Bot}
          label={t('toolbar.assistant')}
          value={currentAssistant?.name ?? t('toolbar.noAssistant')}
          selectedKey={props.currentAssistantId}
          options={props.assistants.map((a) => ({
            value: a.id,
            label: a.name,
            onSelect: () => props.onSelectAssistant(a.id),
          }))}
        />

        <ValueSubmenu
          id="model"
          icon={Cpu}
          label={t('toolbar.models')}
          value={props.currentModelId ?? t('toolbar.selectModel')}
          selectedKey={currentModelKey}
          loading={modelsState === 'loading'}
          emptyLabel={modelsState === 'failed' ? t('toolbar.modelsLoadFailed') : t('toolbar.noModels')}
          onOpenIntent={() => setWantModels(true)}
          options={groups.flatMap((g) =>
            g.models.map((m) => ({
              value: `${g.provider.id}:${m.id}`,
              label: m.name || m.id,
              group: g.provider.name,
              icon: <ModelIcon model={m.id} size={16} />,
              onSelect: () => props.onSelectModel(m.id, g.provider.id),
            })),
          )}
        />

        {props.capabilities?.supports_thinking !== false ? (
          <ValueSubmenu
            id="thinking"
            icon={Lightbulb}
            label={t('toolbar.thinking')}
            value={t(`toolbar.thinking.${props.thinkingLevel}`)}
            tone={props.thinkingLevel === 'default' ? 'muted' : 'info'}
            selectedKey={props.thinkingLevel}
            options={thinkingOptions}
          />
        ) : null}
      </DropdownPopover>
    </Dropdown>
  )
}
