import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, ChevronRight, ChevronsRight, Compass, Cpu, Hammer, Lightbulb, Paperclip, Plus, Zap } from 'lucide-react'
import { ModelIcon } from '@/components/ui/model-icon'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Spinner, Switch } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { allowedEfforts } from '@/lib/thinking'
import type { Assistant, ChatMode, Provider, ProviderCapabilities, ModelInfo, ThinkingEffort, ThinkingLevel } from '@/types'

/**
 * Everything the composer can configure, behind one `+`.
 *
 * The toolbar used to lay all of this out in a row, and each control that had
 * something to say said it in words — the mode, the assistant, the model, and
 * two toggles that grow a label when switched on. Six controls wide is fine
 * until three of them are labelled at once, at which point the row is doing the
 * job of a menu without being one.
 *
 * The shape is borrowed from the generator's model picker in foxlinepro_dash: a
 * single popover split into a list on the left and a detail column on the right
 * that is driven by whichever row is hovered. Notably *not* nested submenus —
 * one popover means one thing to dismiss, one place to look, and no stack of
 * layers drifting across the screen. That project has kept this interaction
 * since its first version and through a whole component-library migration,
 * which is a reasonable argument that it holds up.
 */

/** A row in the right-hand column. */
interface SubOption {
  value: string
  label: string
  description?: string
  /** Rendered as a heading above the first row carrying it. */
  group?: string
  icon?: React.ReactNode
  selected?: boolean
  onSelect: () => void
}

/** A row in the left-hand list. */
interface Entry {
  key: string
  icon: typeof Hammer
  label: string
  /** Shown right-aligned: the current value, the way the mobile sheet does it. */
  value?: string
  /** Colours the value when it is not the default, so a glance is enough. */
  tone?: 'muted' | 'info' | 'warning'
  /**
   * Present makes this row a switch, and its value is the switch's state.
   * Carried on the entry rather than looked up by key at render time, so a
   * third toggle is one more `entries.push` and nothing else.
   *
   * A row that opens a column and a row that flips a boolean are two different
   * gestures; spelling both as right-aligned text gave no way to tell them
   * apart until you had already clicked.
   */
  checked?: boolean
  /** A leaf row: runs and closes. Mutually exclusive with `options`. */
  onSelect?: () => void
  /** Opens the right-hand column. */
  options?: SubOption[]
  /** Right column shows a spinner instead of `options` while true. */
  loading?: boolean
}

export interface ComposerMenuProps {
  assistants: Assistant[]
  providers: Provider[]
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
  capabilities?: ProviderCapabilities | null
  onPickFile?: () => void
}

const CHAT_MODES: Array<{ id: ChatMode; icon: typeof Hammer; labelKey: string; descKey: string }> = [
  { id: 'work', icon: Hammer, labelKey: 'toolbar.mode.work', descKey: 'toolbar.mode.workDesc' },
  { id: 'plan', icon: Compass, labelKey: 'toolbar.mode.plan', descKey: 'toolbar.mode.planDesc' },
]

const THINKING_LEVELS: ThinkingLevel[] = ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh']

interface GroupedModels {
  provider: Provider
  models: ModelInfo[]
}

export function ComposerMenu(props: ComposerMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // One piece of state drives both the highlight and the right column, which is
  // what keeps the two sides from ever disagreeing about what is being shown.
  const [hovered, setHovered] = useState<string | null>(null)
  const [groups, setGroups] = useState<GroupedModels[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const modelsLoaded = groups.length > 0

  const currentAssistant = props.assistants.find((a) => a.id === props.currentAssistantId)
  const activeMode = CHAT_MODES.find((m) => m.id === props.mode) ?? CHAT_MODES[0]
  const efforts = useMemo(
    () => allowedEfforts(props.capabilities ?? null),
    [props.capabilities],
  )

  // Fetched when the model row is first opened rather than when the menu is,
  // so opening it to flip a toggle costs nothing.
  useEffect(() => {
    if (hovered !== 'model' || modelsLoaded || loadingModels) return
    setLoadingModels(true)
    Promise.allSettled(
      props.providers
        .filter((p) => p.is_enabled)
        .map(async (p) => ({ provider: p, models: await api.fetchProviderModels(p.id, false) })),
    ).then((results) => {
      setGroups(
        results
          .filter((r): r is PromiseFulfilledResult<GroupedModels> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((g) => g.models.length > 0),
      )
      setLoadingModels(false)
    })
  }, [hovered, modelsLoaded, loadingModels, props.providers])

  const close = useCallback(() => {
    setOpen(false)
    setHovered(null)
  }, [])

  const entries: Entry[] = []

  if (props.onPickFile) {
    entries.push({
      key: 'attach',
      icon: Paperclip,
      label: t('chat.attachFile'),
      onSelect: props.onPickFile,
    })
  }

  entries.push({
    key: 'mode',
    icon: activeMode.icon,
    label: t('toolbar.mode'),
    value: t(activeMode.labelKey),
    tone: props.mode === 'work' ? 'muted' : 'info',
    options: CHAT_MODES.map((m) => ({
      value: m.id,
      label: t(m.labelKey),
      description: t(m.descKey),
      icon: <m.icon className="size-4" />,
      selected: m.id === props.mode,
      onSelect: () => props.onSelectMode(m.id),
    })),
  })

  // Plan mode removes every editing tool, so the switch would be promising to
  // skip approvals that are never going to be requested.
  if (props.mode !== 'plan') {
    entries.push({
      key: 'accept-edits',
      icon: ChevronsRight,
      label: t('toolbar.acceptEdits'),
      checked: props.acceptEdits,
      tone: props.acceptEdits ? 'warning' : 'muted',
      onSelect: () => props.onToggleAcceptEdits(!props.acceptEdits),
    })
  }

  entries.push({
    key: 'assistant',
    icon: Bot,
    label: t('toolbar.assistant'),
    value: currentAssistant?.name ?? t('toolbar.noAssistant'),
    options: props.assistants.map((a) => ({
      value: a.id,
      label: a.name,
      selected: a.id === props.currentAssistantId,
      onSelect: () => props.onSelectAssistant(a.id),
    })),
  })

  entries.push({
    key: 'model',
    icon: Cpu,
    label: t('toolbar.models'),
    value: props.currentModelId ?? t('toolbar.selectModel'),
    loading: loadingModels,
    options: groups.flatMap((g) =>
      g.models.map((m) => ({
        value: `${g.provider.id}:${m.id}`,
        label: m.name || m.id,
        group: g.provider.name,
        icon: <ModelIcon model={m.id} size={16} />,
        selected: m.id === props.currentModelId && g.provider.id === props.currentProviderId,
        onSelect: () => props.onSelectModel(m.id, g.provider.id),
      })),
    ),
  })

  if (props.capabilities?.supports_thinking !== false) {
    entries.push({
      key: 'thinking',
      icon: Lightbulb,
      label: t('toolbar.thinking'),
      value: t(`toolbar.thinking.${props.thinkingLevel}`),
      tone: props.thinkingLevel === 'default' ? 'muted' : 'info',
      options: THINKING_LEVELS.filter(
        (l) => l === 'default' || l === 'off' || efforts.includes(l as ThinkingEffort),
      ).map((l) => ({
        value: l,
        label: t(`toolbar.thinking.${l}`),
        description: t(`toolbar.thinking.${l}Desc`),
        selected: l === props.thinkingLevel,
        onSelect: () => props.onSelectThinkingLevel(l),
      })),
    })
  }

  if (props.capabilities?.supports_fast === true) {
    entries.push({
      key: 'fast',
      icon: Zap,
      label: t('toolbar.fast'),
      checked: props.fastMode,
      tone: props.fastMode ? 'warning' : 'muted',
      onSelect: () => props.onToggleFast(!props.fastMode),
    })
  }

  const hoveredEntry = entries.find((e) => e.key === hovered && (e.options || e.loading))
  const showSubPanel = Boolean(hoveredEntry)

  // Anything not at its default is worth seeing before the menu is opened —
  // otherwise folding the toolbar away would also fold away the fact that
  // approvals are currently being skipped.
  const alert = props.acceptEdits ? 'warning' : props.mode !== 'work' ? 'info' : null

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setHovered(null)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  data-slot="composer-menu-trigger"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'relative text-muted hover:text-foreground',
                    open && 'bg-default text-foreground',
                  )}
                />
              }
            >
              <Plus className="size-4" />
              {alert && (
                <span
                  data-slot="composer-menu-alert"
                  className={cn(
                    'absolute right-1 top-1 size-1.5 rounded-full',
                    alert === 'warning' ? 'bg-warning' : 'bg-info',
                  )}
                />
              )}
            </PopoverTrigger>
          }
        />
        <TooltipContent side="top">{t('composer.menu')}</TooltipContent>
      </Tooltip>

      <PopoverContent side="top" align="start" className="w-auto p-0 gap-0 overflow-hidden">
        {/* Fixed height, each column scrolling on its own.
            The popup opens upwards, so its bottom edge is pinned to the trigger
            and any growth pushes the top up — a right column taller than the
            left would slide the row out from under the cursor, and the menu
            would then show whatever the pointer had landed on instead. Sizing
            the panel to its content is what caused that, and matching the right
            column to the left one only moves the problem: both columns grow as
            features are added. A constant is the one thing neither side can
            push around. */}
        <div data-slot="composer-menu-panels" className="flex h-72">
          <div
            data-slot="composer-menu-list"
            className="w-56 shrink-0 overflow-y-auto p-1"
          >
            {entries.map((entry) => {
              const Icon = entry.icon
              const isHovered = hovered === entry.key
              const expandable = Boolean(entry.options || entry.loading)
              const isToggle = entry.checked !== undefined
              return (
                <Button
                  key={entry.key}
                  data-slot="composer-menu-item"
                  variant="ghost"
                  onMouseEnter={() => setHovered(entry.key)}
                  onFocus={() => setHovered(entry.key)}
                  role={isToggle ? "switch" : undefined}
                  aria-checked={isToggle ? entry.checked : undefined}
                  onClick={() => {
                    if (entry.onSelect) {
                      entry.onSelect()
                      // A toggle stays put: flipping two switches in a row is a
                      // normal thing to want, and closing after each one would
                      // make the menu fight the user for it.
                      if (!isToggle) close()
                      return
                    }
                    // A row with children toggles the column rather than
                    // choosing anything — there is nothing here to choose yet.
                    setHovered((prev) => (prev === entry.key ? null : entry.key))
                  }}
                  className={cn(
                    'w-full h-auto justify-start gap-2 rounded-md px-1.5 py-1 text-sm font-normal',
                    isHovered
                      ? 'bg-default text-default-foreground'
                      : 'text-muted hover:bg-default/50 hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      entry.tone === 'warning' && 'text-warning',
                      entry.tone === 'info' && 'text-info',
                    )}
                  />
                  <span data-slot="composer-menu-item-label" className="flex-1 text-left truncate">
                    {entry.label}
                  </span>
                  {entry.value && (
                    <span
                      data-slot="composer-menu-item-value"
                      className={cn(
                        'text-xs truncate max-w-[88px]',
                        entry.tone === 'warning'
                          ? 'text-warning'
                          : entry.tone === 'info'
                            ? 'text-info'
                            : 'text-muted/60',
                      )}
                    >
                      {entry.value}
                    </span>
                  )}
                  {isToggle && (
                    // The row owns the interaction, so the switch is decoration
                    // with a state: letting it take pointer events too would
                    // fire the handler twice on the switch and once elsewhere.
                    // `inert` says all of that at once — not focusable, not
                    // clickable, not in the accessibility tree — which a switch
                    // nested inside a button has to be anyway.
                    <Switch
                      inert
                      isReadOnly
                      size="sm"
                      isSelected={entry.checked}
                    >
                      <Switch.Content>
                        <Switch.Control className="data-[selected=true]:bg-warning">
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  )}
                  {expandable && <ChevronRight className="size-4 shrink-0 text-muted" />}
                </Button>
              )
            })}
          </div>

          <AnimatePresence initial={false}>
            {showSubPanel && (
              <motion.div
                data-slot="composer-menu-detail"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="overflow-hidden border-l border-border"
              >
                <div className="w-60 h-full overflow-y-auto p-1">
                  {hoveredEntry?.loading ? (
                    <div className="flex items-center justify-center py-6">
                      <Spinner className="size-4" />
                    </div>
                  ) : (
                    hoveredEntry?.options?.map((opt, i) => {
                      const heading =
                        opt.group && opt.group !== hoveredEntry.options?.[i - 1]?.group
                          ? opt.group
                          : null
                      return (
                        <div key={opt.value}>
                          {heading && (
                            <div
                              data-slot="composer-menu-detail-heading"
                              className="px-1.5 pt-2 pb-1 text-xs text-muted"
                            >
                              {heading}
                            </div>
                          )}
                          <Button
                            data-slot="composer-menu-detail-item"
                            variant="ghost"
                            onClick={() => {
                              opt.onSelect()
                              close()
                            }}
                            className={cn(
                              'w-full h-auto justify-start gap-2 rounded-md px-1.5 py-1 text-sm font-normal',
                              opt.selected
                                ? 'bg-default text-default-foreground'
                                : 'text-muted hover:bg-default/50 hover:text-foreground',
                            )}
                          >
                            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                            <span className="flex-1 min-w-0 text-left">
                              <span className="block truncate">{opt.label}</span>
                              {opt.description && (
                                <span className="block truncate text-xs text-muted/60">
                                  {opt.description}
                                </span>
                              )}
                            </span>
                          </Button>
                        </div>
                      )
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  )
}
