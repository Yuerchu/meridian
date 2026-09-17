import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowsRotateRight,
  Bulb,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Compass,
  Cpu,
  FaceRobot,
  Hammer,
  Paperclip,
  Picture,
  Plus,
  StarFill,
  Thunderbolt,
} from '@gravity-ui/icons'
import { ModelIcon } from '@/components/ui/model-icon'
import { Button, Drawer, Spinner, Tooltip } from '@heroui/react'
import { CellSwitch } from '@/components/base'
import { cn } from '@/lib/utils'
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

interface ToolbarProps {
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
}

const CHAT_MODES: Array<{ id: ChatMode; icon: typeof Hammer; labelKey: string; descKey: string }> = [
  { id: 'work', icon: Hammer, labelKey: 'toolbar.mode.work', descKey: 'toolbar.mode.workDesc' },
  { id: 'plan', icon: Compass, labelKey: 'toolbar.mode.plan', descKey: 'toolbar.mode.planDesc' },
]

interface GroupedModels {
  provider: ProviderInfoResponse
  models: ProviderModelInfoResponse[]
}

const THINKING_LEVELS: Array<{ id: ThinkingLevel; labelKey: string; descKey: string }> = [
  { id: 'default', labelKey: 'toolbar.thinking.default', descKey: 'toolbar.thinking.defaultDesc' },
  { id: 'off', labelKey: 'toolbar.thinking.off', descKey: 'toolbar.thinking.offDesc' },
  { id: 'minimal', labelKey: 'toolbar.thinking.minimal', descKey: 'toolbar.thinking.minimalDesc' },
  { id: 'low', labelKey: 'toolbar.thinking.low', descKey: 'toolbar.thinking.lowDesc' },
  { id: 'medium', labelKey: 'toolbar.thinking.medium', descKey: 'toolbar.thinking.mediumDesc' },
  { id: 'high', labelKey: 'toolbar.thinking.high', descKey: 'toolbar.thinking.highDesc' },
  { id: 'xhigh', labelKey: 'toolbar.thinking.xhigh', descKey: 'toolbar.thinking.xhighDesc' },
  { id: 'max', labelKey: 'toolbar.thinking.max', descKey: 'toolbar.thinking.maxDesc' },
]

/**
 * The tiers to offer for a model: always `default`, `off` when supported, plus
 * whatever effort tiers the model advertises. Unknown capabilities fall back to the full ladder
 * (see `allowedEfforts`).
 */
function levelsFor(capabilities: ProviderCapabilitiesInfoResponse | null | undefined) {
  const allowed = allowedEfforts(capabilities ?? null)
  return THINKING_LEVELS.filter(
    (l) =>
      l.id === 'default' ||
      (l.id === 'off' && capabilities?.supports_thinking_off !== false) ||
      allowed.includes(l.id as ThinkingEffort),
  )
}

// ---- Mobile bottom-sheet options menu ----

export interface MobileOptionsMenuProps extends ToolbarProps {
  onTakePhoto: () => void
  onPickGallery: () => void
  /**
   * Absent hides the entry, the way `ComposerMenu` already treats it.
   *
   * `supportsImages` covers the camera and the gallery but not this one, so
   * without its own switch there was no way to withhold attachments — which a
   * hosted session needs, its prompt being a single text block.
   */
  onPickFile?: () => void
  supportsImages: boolean
}

type MobilePanel = 'main' | 'assistant' | 'model' | 'thinking' | 'mode'

export function MobileOptionsMenu({
  assistants,
  providers,
  currentAssistantId,
  currentModelId,
  currentProviderId,
  onSelectAssistant,
  onSelectModel,
  thinkingLevel,
  onSelectThinkingLevel,
  fastMode,
  onToggleFast,
  mode,
  onSelectMode,
  acceptEdits,
  onToggleAcceptEdits,
  capabilities,
  onTakePhoto,
  onPickGallery,
  onPickFile,
  supportsImages,
}: MobileOptionsMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<MobilePanel>('main')
  const [groups, setGroups] = useState<GroupedModels[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const modelsLoaded = groups.length > 0

  const currentAssistant = assistants.find((a) => a.id === currentAssistantId)
  const supportsThinking = capabilities?.supports_thinking !== false
  const supportsFast = capabilities?.supports_fast === true
  const levels = levelsFor(capabilities)
  const thinkingLabel =
    thinkingLevel === 'default' ? t('toolbar.thinking.default') : t(`toolbar.thinking.${thinkingLevel}`)

  const close = useCallback(() => {
    setOpen(false)
    setTimeout(() => setPanel('main'), 200)
  }, [])

  const handleAction = useCallback(
    (action: () => void) => {
      close()
      action()
    },
    [close],
  )

  useEffect(() => {
    if (panel !== 'model' || modelsLoaded) return
    setLoadingModels(true)
    Promise.allSettled(
      providers
        .filter((p) => p.is_enabled)
        .map(async (p) => ({
          provider: p,
          models: await api.fetchProviderModels({ providerId: p.id, forceRefresh: false }),
        })),
    ).then((results) => {
      setGroups(
        results
          .filter((r): r is PromiseFulfilledResult<GroupedModels> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((g) => g.models.length > 0),
      )
      setLoadingModels(false)
    })
  }, [panel, modelsLoaded, providers])

  // Also neutralizes ui Button defaults (h-8/rounded-lg/justify-center/font-medium)
  // so the drawer items keep their original full-width list layout.
  const itemCls =
    'flex h-auto items-center justify-start gap-3 w-full rounded-none px-4 py-2.5 text-sm font-normal text-foreground active:bg-default transition-colors'

  return (
    <Drawer
      isOpen={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setTimeout(() => setPanel('main'), 200)
      }}
    >
      <Tooltip delay={0}>
        <Drawer.Trigger
          aria-label={t('composer.menu')}
          className="inline-flex items-center justify-center rounded-md p-1 text-muted hover:text-foreground hover:bg-default transition-colors touch-hitbox"
        >
          <Plus className="w-4 h-4" />
        </Drawer.Trigger>
        <Tooltip.Content>{t('composer.menu')}</Tooltip.Content>
      </Tooltip>
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog
            aria-label={t('composer.menu')}
            // `--safe-bottom`, not bare `env()`: Android WebView reports zero
            // for the latter (crbug 40699457, only fixed in M144), which is the
            // whole reason the native bridge writes these variables. With
            // 3-button navigation that bar is 48dp of opaque buttons, so the
            // last row here was landing under it and could not be tapped.
            className="max-h-[70vh] px-0 pt-2 pb-[max(1rem,var(--safe-bottom))]"
          >
            <Drawer.Handle />
            {/* Only the colour is overridden. HeroUI's `-mx-3px p-3px` looks
                like it would inset the rows, but the two cancel: the body
                widens by 3px on each side and pads the same amount back, so a
                focus ring has room without the rows losing any width. */}
            <Drawer.Body className="text-foreground">
              {panel === 'main' && (
                <div data-slot="mobile-options-main" className="flex flex-col">
                  {supportsImages && (
                    <>
                      <Button variant="ghost" className={itemCls} onPress={() => handleAction(onTakePhoto)}>
                        <Camera className="w-4 h-4 text-muted" />
                        {t('chat.takePhoto')}
                      </Button>
                      <Button variant="ghost" className={itemCls} onPress={() => handleAction(onPickGallery)}>
                        <Picture className="w-4 h-4 text-muted" />
                        {t('chat.pickFromGallery')}
                      </Button>
                    </>
                  )}
                  {onPickFile && (
                    <Button variant="ghost" className={itemCls} onPress={() => handleAction(onPickFile)}>
                      <Paperclip className="w-4 h-4 text-muted" />
                      {t('chat.attachFile')}
                    </Button>
                  )}
                  <div data-slot="mobile-options-separator" className="h-px bg-border mx-4 my-1" />
                  <Button variant="ghost" className={cn(itemCls, 'justify-between')} onPress={() => setPanel('mode')}>
                    <span data-slot="mobile-options-mode-summary" className="flex items-center gap-3">
                      {(() => {
                        const active = CHAT_MODES.find((m) => m.id === mode) ?? CHAT_MODES[0]
                        const Icon = active.icon
                        return (
                          <>
                            <Icon
                              className={cn('w-4 h-4', mode === 'work' ? 'text-muted' : 'text-info-soft-foreground')}
                            />
                            <span data-slot="mobile-options-mode-label">
                              {t('toolbar.mode')}: {t(active.labelKey)}
                            </span>
                          </>
                        )
                      })()}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </Button>
                  <Button
                    variant="ghost"
                    className={cn(itemCls, 'justify-between')}
                    onPress={() => setPanel('assistant')}
                  >
                    <span data-slot="mobile-options-assistant-summary" className="flex items-center gap-3">
                      <FaceRobot className="w-4 h-4 text-muted" />
                      <span data-slot="mobile-options-assistant-name">
                        {currentAssistant?.name ?? t('toolbar.noAssistant')}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </Button>
                  <Button variant="ghost" className={cn(itemCls, 'justify-between')} onPress={() => setPanel('model')}>
                    <span data-slot="mobile-options-model-summary" className="flex items-center gap-3">
                      {currentModelId ? (
                        <ModelIcon model={currentModelId} size={16} />
                      ) : (
                        <Cpu className="w-4 h-4 text-muted" />
                      )}
                      <span data-slot="mobile-options-model-name" className="truncate max-w-48">
                        {currentModelId ?? t('toolbar.selectModel')}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </Button>
                  {supportsThinking && (
                    <Button
                      variant="ghost"
                      className={cn(itemCls, 'justify-between')}
                      onPress={() => setPanel('thinking')}
                    >
                      <span data-slot="mobile-options-thinking-summary" className="flex items-center gap-3">
                        <Bulb
                          className={cn(
                            'w-4 h-4',
                            thinkingLevel !== 'default' && thinkingLevel !== 'off'
                              ? 'text-info-soft-foreground'
                              : 'text-muted',
                          )}
                        />
                        <span data-slot="mobile-options-thinking-label">
                          {t('toolbar.thinking')}: {thinkingLabel}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted" />
                    </Button>
                  )}
                  {mode !== 'plan' && (
                    <CellSwitch
                      data-slot="mobile-accept-edits-row"
                      aria-label={t('toolbar.acceptEdits')}
                      isSelected={acceptEdits}
                      onChange={onToggleAcceptEdits}
                      className="w-full [--switch-control-bg-checked:var(--warning)]"
                    >
                      <CellSwitch.Trigger className="h-auto min-h-10 w-full gap-3 rounded-none border-0 bg-transparent px-4 py-2.5 text-foreground shadow-none transition-colors active:bg-default pointer-coarse:min-h-11">
                        <ChevronsRight
                          className={cn('w-4 h-4', acceptEdits ? 'text-warning-soft-foreground' : 'text-muted')}
                        />
                        <CellSwitch.Label className="flex items-center justify-between gap-2 font-normal">
                          <span data-slot="mobile-accept-edits-label">{t('toolbar.acceptEdits')}</span>
                          <span data-slot="mobile-accept-edits-state" className="text-xs font-normal text-muted">
                            {acceptEdits ? t('toolbar.acceptEdits.on') : t('toolbar.acceptEdits.off')}
                          </span>
                        </CellSwitch.Label>
                        <CellSwitch.Control />
                      </CellSwitch.Trigger>
                    </CellSwitch>
                  )}
                  {supportsFast && (
                    <CellSwitch
                      data-slot="mobile-fast-row"
                      aria-label={t('toolbar.fast')}
                      isSelected={fastMode}
                      onChange={onToggleFast}
                      className="w-full [--switch-control-bg-checked:var(--warning)]"
                    >
                      <CellSwitch.Trigger className="h-auto min-h-10 w-full gap-3 rounded-none border-0 bg-transparent px-4 py-2.5 text-foreground shadow-none transition-colors active:bg-default pointer-coarse:min-h-11">
                        <Thunderbolt
                          className={cn('w-4 h-4', fastMode ? 'text-warning-soft-foreground' : 'text-muted')}
                        />
                        <CellSwitch.Label className="flex items-center justify-between gap-2 font-normal">
                          <span data-slot="mobile-fast-label">{t('toolbar.fast')}</span>
                          <span data-slot="mobile-fast-state" className="text-xs font-normal text-muted">
                            {fastMode ? t('toolbar.fast.on') : t('toolbar.fast.off')}
                          </span>
                        </CellSwitch.Label>
                        <CellSwitch.Control />
                      </CellSwitch.Trigger>
                    </CellSwitch>
                  )}
                </div>
              )}

              {panel === 'assistant' && (
                <div data-slot="mobile-options-assistant-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-assistant-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
                  >
                    <Tooltip delay={0}>
                      <Button
                        isIconOnly
                        aria-label={t('common.back')}
                        variant="ghost"
                        className="size-auto p-1 rounded-md hover:bg-default"
                        onPress={() => setPanel('main')}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Tooltip.Content>{t('common.back')}</Tooltip.Content>
                    </Tooltip>
                    <span data-slot="mobile-options-assistant-title" className="text-sm font-medium">
                      {t('toolbar.selectAssistant')}
                    </span>
                  </div>
                  <div data-slot="toolbar-assistant-list" className="max-h-[50vh] overflow-y-auto overscroll-contain">
                    {assistants.map((a) => (
                      <Button
                        key={a.id}
                        aria-pressed={a.id === currentAssistantId}
                        variant="ghost"
                        className={cn(itemCls, a.id === currentAssistantId && 'bg-default')}
                        onPress={() => {
                          onSelectAssistant(a.id)
                          close()
                        }}
                      >
                        {a.is_default && (
                          <StarFill
                            // eslint-disable-next-line no-restricted-syntax -- CLAUDE.md whitelist: gold-star semantics
                            className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"
                          />
                        )}
                        <span data-slot="toolbar-assistant-name" className="flex-1 truncate">
                          {a.name}
                        </span>
                        {a.id === currentAssistantId && <Check className="w-4 h-4 text-muted" />}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {panel === 'model' && (
                <div data-slot="mobile-options-model-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-model-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
                  >
                    <Tooltip delay={0}>
                      <Button
                        isIconOnly
                        aria-label={t('common.back')}
                        variant="ghost"
                        className="size-auto p-1 rounded-md hover:bg-default"
                        onPress={() => setPanel('main')}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Tooltip.Content>{t('common.back')}</Tooltip.Content>
                    </Tooltip>
                    <span data-slot="mobile-options-model-title" className="text-sm font-medium flex-1">
                      {t('toolbar.models')}
                    </span>
                    <Tooltip delay={0}>
                      <Button
                        isIconOnly
                        aria-label={`${t('settings.about.logs.refresh')} ${t('toolbar.models')}`}
                        variant="ghost"
                        className="h-6 w-6"
                        onPress={() => {
                          setLoadingModels(true)
                          setGroups([])
                          Promise.allSettled(
                            providers
                              .filter((p) => p.is_enabled)
                              .map(async (p) => ({
                                provider: p,
                                models: await api.fetchProviderModels({ providerId: p.id, forceRefresh: true }),
                              })),
                          ).then((results) => {
                            setGroups(
                              results
                                .filter((r): r is PromiseFulfilledResult<GroupedModels> => r.status === 'fulfilled')
                                .map((r) => r.value)
                                .filter((g) => g.models.length > 0),
                            )
                            setLoadingModels(false)
                          })
                        }}
                        isDisabled={loadingModels}
                      >
                        {loadingModels ? (
                          <Spinner size="sm" color="current" />
                        ) : (
                          <ArrowsRotateRight className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Tooltip.Content>{`${t('settings.about.logs.refresh')} ${t('toolbar.models')}`}</Tooltip.Content>
                    </Tooltip>
                  </div>
                  <div data-slot="toolbar-model-list" className="max-h-[50vh] overflow-y-auto overscroll-contain">
                    {loadingModels && (
                      <div data-slot="toolbar-model-loading" className="px-4 py-3 text-xs text-muted">
                        {t('toolbar.loadingModels')}
                      </div>
                    )}
                    {groups.map((g) => (
                      <div key={g.provider.id} data-slot="toolbar-model-group">
                        <div data-slot="toolbar-model-provider" className="px-4 py-1 text-xs text-muted">
                          {g.provider.name}
                        </div>
                        {g.models.map((m) => (
                          <Button
                            key={`${g.provider.id}-${m.id}`}
                            aria-pressed={m.id === currentModelId && g.provider.id === currentProviderId}
                            variant="ghost"
                            className={cn(
                              itemCls,
                              m.id === currentModelId && g.provider.id === currentProviderId && 'bg-default',
                            )}
                            onPress={() => {
                              onSelectModel(m.id, g.provider.id)
                              close()
                            }}
                          >
                            <ModelIcon model={m.id} size={16} className="flex-shrink-0" />
                            <span data-slot="toolbar-model-name" className="flex-1 truncate">
                              {m.name}
                            </span>
                            {m.id === currentModelId && g.provider.id === currentProviderId && (
                              <Check className="w-4 h-4 text-muted flex-shrink-0" />
                            )}
                          </Button>
                        ))}
                      </div>
                    ))}
                    {!loadingModels && groups.length === 0 && (
                      <div data-slot="toolbar-model-empty" className="px-4 py-3 text-xs text-muted">
                        {t('toolbar.noModels')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {panel === 'mode' && (
                <div data-slot="mobile-options-mode-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-mode-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
                  >
                    <Tooltip delay={0}>
                      <Button
                        isIconOnly
                        aria-label={t('common.back')}
                        variant="ghost"
                        className="size-auto p-1 rounded-md hover:bg-default"
                        onPress={() => setPanel('main')}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Tooltip.Content>{t('common.back')}</Tooltip.Content>
                    </Tooltip>
                    <span data-slot="mobile-options-mode-title" className="text-sm font-medium">
                      {t('toolbar.mode')}
                    </span>
                  </div>
                  {CHAT_MODES.map((m) => {
                    const Icon = m.icon
                    return (
                      <Button
                        key={m.id}
                        aria-pressed={m.id === mode}
                        variant="ghost"
                        className={cn(itemCls, 'justify-between', m.id === mode && 'bg-default')}
                        onPress={() => {
                          onSelectMode(m.id)
                          close()
                        }}
                      >
                        <span data-slot="mobile-options-mode-choice" className="flex items-center gap-3">
                          <Icon className="w-4 h-4 text-muted" />
                          <span data-slot="mobile-options-mode-choice-label">{t(m.labelKey)}</span>
                        </span>
                        <span data-slot="mobile-options-mode-choice-desc" className="text-xs text-muted">
                          {t(m.descKey)}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              )}

              {panel === 'thinking' && (
                <div data-slot="mobile-options-thinking-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-thinking-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
                  >
                    <Tooltip delay={0}>
                      <Button
                        isIconOnly
                        aria-label={t('common.back')}
                        variant="ghost"
                        className="size-auto p-1 rounded-md hover:bg-default"
                        onPress={() => setPanel('main')}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Tooltip.Content>{t('common.back')}</Tooltip.Content>
                    </Tooltip>
                    <span data-slot="mobile-options-thinking-title" className="text-sm font-medium">
                      {t('toolbar.thinking')}
                    </span>
                  </div>
                  {levels.map((level) => (
                    <Button
                      key={level.id}
                      aria-pressed={level.id === thinkingLevel}
                      variant="ghost"
                      className={cn(itemCls, 'justify-between', level.id === thinkingLevel && 'bg-default')}
                      onPress={() => {
                        onSelectThinkingLevel(level.id)
                        close()
                      }}
                    >
                      <span data-slot="mobile-options-thinking-choice-label">{t(level.labelKey)}</span>
                      <span data-slot="mobile-options-thinking-choice-desc" className="text-xs text-muted">
                        {t(level.descKey)}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}
