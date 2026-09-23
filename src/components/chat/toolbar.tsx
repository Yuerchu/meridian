import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu as AriaMenu, MenuSection as AriaMenuSection } from 'react-aria-components'
import {
  Bot,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Compass,
  Cpu,
  Hammer,
  Image,
  Lightbulb,
  Paperclip,
  Plus,
  RefreshCw,
  Zap,
} from '@keyline-icons/react/two-tone'
import { Star } from '@keyline-icons/react/fill'
import { ModelIcon } from '@/components/ui/model-icon'
import { Button, DropdownDivider, DropdownGroup, DropdownItem, Sheet, Tooltip, TooltipTrigger } from '@/components/base'
import { MENU_ITEMS_CONTAINER } from '@/components/base/dropdown/menu-styles'
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
  const activeMode = CHAT_MODES.find((m) => m.id === mode) ?? CHAT_MODES[0]
  const ActiveModeIcon = activeMode.icon
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

  // Every list in the sheet is a React Aria `Menu` of the registry's dropdown
  // rows (`DropdownItem`): the main panel's rows are actions and ways into a
  // panel, each panel's rows a `selectionMode="single"` choice whose current
  // value is a checked `menuitemradio`, and the two booleans a
  // `selectionMode="multiple"` section of `menuitemcheckbox` rows.
  const listCls = cx(MENU_ITEMS_CONTAINER, 'px-2.5')
  const panelListCls = cx(MENU_ITEMS_CONTAINER, 'max-h-[50vh] overflow-y-auto overscroll-contain px-2.5 pt-2')

  return (
    <Sheet
      isOpen={open}
      placement="bottom"
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setTimeout(() => setPanel('main'), 200)
      }}
    >
      <TooltipTrigger delay={0}>
        <Button
          variant="neutral"
          iconOnly
          leadingIcon={Plus}
          size="small"
          aria-label={t('composer.menu')}
          onPress={() => setOpen(true)}
          className="touch-hitbox"
        />
        <Tooltip>{t('composer.menu')}</Tooltip>
      </TooltipTrigger>
      <Sheet.Backdrop>
        <Sheet.Content>
          <Sheet.Dialog
            aria-label={t('composer.menu')}
            // `--safe-bottom`, not bare `env()`: Android WebView reports zero
            // for the latter (crbug 40699457, only fixed in M144), which is the
            // whole reason the native bridge writes these variables. With
            // 3-button navigation that bar is 48dp of opaque buttons, so the
            // last row here was landing under it and could not be tapped.
            // No top padding of its own: `Sheet.Handle` is a 24px hit target
            // now rather than a 4px pill, and supplies the breathing room.
            className="max-h-[70vh] px-0 pb-[max(1rem,var(--safe-bottom))]"
          >
            <Sheet.Handle />
            <Sheet.Body className="text-text-primary">
              {panel === 'main' && (
                <AriaMenu data-slot="mobile-options-main" aria-label={t('composer.menu')} className={listCls}>
                  {supportsImages ? (
                    <DropdownItem id="photo" textValue={t('chat.takePhoto')} onAction={() => handleAction(onTakePhoto)}>
                      <Camera aria-hidden className="size-4 shrink-0 text-text-secondary" />
                      <span data-slot="mobile-options-label">{t('chat.takePhoto')}</span>
                    </DropdownItem>
                  ) : null}
                  {supportsImages ? (
                    <DropdownItem
                      id="gallery"
                      textValue={t('chat.pickFromGallery')}
                      onAction={() => handleAction(onPickGallery)}
                    >
                      <Image aria-hidden className="size-4 shrink-0 text-text-secondary" />
                      <span data-slot="mobile-options-label">{t('chat.pickFromGallery')}</span>
                    </DropdownItem>
                  ) : null}
                  {onPickFile ? (
                    <DropdownItem id="file" textValue={t('chat.attachFile')} onAction={() => handleAction(onPickFile)}>
                      <Paperclip aria-hidden className="size-4 shrink-0 text-text-secondary" />
                      <span data-slot="mobile-options-label">{t('chat.attachFile')}</span>
                    </DropdownItem>
                  ) : null}
                  {supportsImages || onPickFile ? <DropdownDivider /> : null}
                  <DropdownItem
                    id="mode"
                    textValue={`${t('toolbar.mode')}: ${t(activeMode.labelKey)}`}
                    onAction={() => setPanel('mode')}
                  >
                    <ActiveModeIcon
                      aria-hidden
                      className={cx(
                        'size-4 shrink-0',
                        mode === 'work' ? 'text-text-secondary' : 'text-status-info-soft-foreground',
                      )}
                    />
                    <span data-slot="mobile-options-mode-label" className="min-w-0 flex-1 truncate">
                      {t('toolbar.mode')}: {t(activeMode.labelKey)}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />
                  </DropdownItem>
                  <DropdownItem
                    id="assistant"
                    textValue={currentAssistant?.name ?? t('toolbar.noAssistant')}
                    onAction={() => setPanel('assistant')}
                  >
                    <Bot aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    <span data-slot="mobile-options-assistant-name" className="min-w-0 flex-1 truncate">
                      {currentAssistant?.name ?? t('toolbar.noAssistant')}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />
                  </DropdownItem>
                  <DropdownItem
                    id="model"
                    textValue={currentModelId ?? t('toolbar.selectModel')}
                    onAction={() => setPanel('model')}
                  >
                    {currentModelId ? (
                      <ModelIcon model={currentModelId} size={16} className="shrink-0" />
                    ) : (
                      <Cpu aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    )}
                    <span data-slot="mobile-options-model-name" className="min-w-0 flex-1 truncate">
                      {currentModelId ?? t('toolbar.selectModel')}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />
                  </DropdownItem>
                  {supportsThinking ? (
                    <DropdownItem
                      id="thinking"
                      textValue={`${t('toolbar.thinking')}: ${thinkingLabel}`}
                      onAction={() => setPanel('thinking')}
                    >
                      <Lightbulb
                        aria-hidden
                        className={cx(
                          'size-4 shrink-0',
                          thinkingLevel !== 'default' && thinkingLevel !== 'off'
                            ? 'text-status-info-soft-foreground'
                            : 'text-text-secondary',
                        )}
                      />
                      <span data-slot="mobile-options-thinking-label" className="min-w-0 flex-1 truncate">
                        {t('toolbar.thinking')}: {thinkingLabel}
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    </DropdownItem>
                  ) : null}
                  {mode !== 'plan' || supportsFast ? (
                    // Booleans: `menuitemcheckbox` rows, toggled in place.
                    <AriaMenuSection
                      selectionMode="multiple"
                      selectedKeys={[
                        ...(mode !== 'plan' && acceptEdits ? ['accept-edits'] : []),
                        ...(supportsFast && fastMode ? ['fast'] : []),
                      ]}
                      className="flex w-full flex-col gap-1"
                    >
                      {mode !== 'plan' ? (
                        <DropdownItem
                          id="accept-edits"
                          textValue={t('toolbar.acceptEdits')}
                          onAction={() => onToggleAcceptEdits(!acceptEdits)}
                        >
                          <ChevronsRight
                            aria-hidden
                            className={cx(
                              'size-4 shrink-0',
                              acceptEdits ? 'text-status-warning-soft-foreground' : 'text-text-secondary',
                            )}
                          />
                          <span data-slot="mobile-accept-edits-label" className="min-w-0 flex-1 truncate">
                            {t('toolbar.acceptEdits')}
                          </span>
                          <span
                            data-slot="mobile-accept-edits-state"
                            className="text-caption-1-regular text-text-secondary"
                          >
                            {acceptEdits ? t('toolbar.acceptEdits.on') : t('toolbar.acceptEdits.off')}
                          </span>
                        </DropdownItem>
                      ) : null}
                      {supportsFast ? (
                        <DropdownItem id="fast" textValue={t('toolbar.fast')} onAction={() => onToggleFast(!fastMode)}>
                          <Zap
                            aria-hidden
                            className={cx(
                              'size-4 shrink-0',
                              fastMode ? 'text-status-warning-soft-foreground' : 'text-text-secondary',
                            )}
                          />
                          <span data-slot="mobile-fast-label" className="min-w-0 flex-1 truncate">
                            {t('toolbar.fast')}
                          </span>
                          <span data-slot="mobile-fast-state" className="text-caption-1-regular text-text-secondary">
                            {fastMode ? t('toolbar.fast.on') : t('toolbar.fast.off')}
                          </span>
                        </DropdownItem>
                      ) : null}
                    </AriaMenuSection>
                  ) : null}
                </AriaMenu>
              )}

              {panel === 'assistant' && (
                <div data-slot="mobile-options-assistant-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-assistant-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border-button-default"
                  >
                    <TooltipTrigger delay={0}>
                      <Button
                        iconOnly
                        leadingIcon={ChevronLeft}
                        size="small"
                        aria-label={t('common.back')}
                        variant="neutral"
                        onPress={() => setPanel('main')}
                      />
                      <Tooltip>{t('common.back')}</Tooltip>
                    </TooltipTrigger>
                    <span data-slot="mobile-options-assistant-title" className="text-body-medium">
                      {t('toolbar.selectAssistant')}
                    </span>
                  </div>
                  <AriaMenu
                    data-slot="toolbar-assistant-list"
                    aria-label={t('toolbar.selectAssistant')}
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={currentAssistantId ? [currentAssistantId] : []}
                    className={panelListCls}
                  >
                    {assistants.map((a) => (
                      <DropdownItem
                        key={a.id}
                        id={a.id}
                        textValue={a.name}
                        onAction={() => {
                          onSelectAssistant(a.id)
                          close()
                        }}
                      >
                        {a.is_default && (
                          <Star
                            aria-hidden
                            // eslint-disable-next-line no-restricted-syntax -- CLAUDE.md whitelist: gold-star semantics
                            className="size-3.5 shrink-0 text-amber-500"
                          />
                        )}
                        <span data-slot="toolbar-assistant-name" className="min-w-0 flex-1 truncate">
                          {a.name}
                        </span>
                        {a.id === currentAssistantId && (
                          <Check aria-hidden className="size-4 shrink-0 text-text-secondary" />
                        )}
                      </DropdownItem>
                    ))}
                  </AriaMenu>
                </div>
              )}

              {panel === 'model' && (
                <div data-slot="mobile-options-model-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-model-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border-button-default"
                  >
                    <TooltipTrigger delay={0}>
                      <Button
                        iconOnly
                        leadingIcon={ChevronLeft}
                        size="small"
                        aria-label={t('common.back')}
                        variant="neutral"
                        onPress={() => setPanel('main')}
                      />
                      <Tooltip>{t('common.back')}</Tooltip>
                    </TooltipTrigger>
                    <span data-slot="mobile-options-model-title" className="text-body-medium flex-1">
                      {t('toolbar.models')}
                    </span>
                    <TooltipTrigger delay={0}>
                      <Button
                        iconOnly
                        leadingIcon={RefreshCw}
                        size="xs"
                        aria-label={`${t('settings.about.logs.refresh')} ${t('toolbar.models')}`}
                        variant="neutral"
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
                        isPending={loadingModels}
                      />
                      <Tooltip>{`${t('settings.about.logs.refresh')} ${t('toolbar.models')}`}</Tooltip>
                    </TooltipTrigger>
                  </div>
                  <AriaMenu
                    data-slot="toolbar-model-list"
                    aria-label={t('toolbar.models')}
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={currentModelId && currentProviderId ? [`${currentProviderId}:${currentModelId}`] : []}
                    renderEmptyState={() => (
                      <div
                        data-slot={loadingModels ? 'toolbar-model-loading' : 'toolbar-model-empty'}
                        className="px-2 py-3 text-caption-1-regular text-text-secondary"
                      >
                        {loadingModels ? t('toolbar.loadingModels') : t('toolbar.noModels')}
                      </div>
                    )}
                    className={panelListCls}
                  >
                    {groups.map((g) => (
                      <DropdownGroup key={g.provider.id} label={g.provider.name}>
                        {g.models.map((m) => {
                          const key = `${g.provider.id}:${m.id}`
                          return (
                            <DropdownItem
                              key={key}
                              id={key}
                              textValue={m.name || m.id}
                              onAction={() => {
                                onSelectModel(m.id, g.provider.id)
                                close()
                              }}
                            >
                              <ModelIcon model={m.id} size={16} className="shrink-0" />
                              <span data-slot="toolbar-model-name" className="min-w-0 flex-1 truncate">
                                {m.name}
                              </span>
                              {m.id === currentModelId && g.provider.id === currentProviderId && (
                                <Check aria-hidden className="size-4 shrink-0 text-text-secondary" />
                              )}
                            </DropdownItem>
                          )
                        })}
                      </DropdownGroup>
                    ))}
                  </AriaMenu>
                </div>
              )}

              {panel === 'mode' && (
                <div data-slot="mobile-options-mode-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-mode-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border-button-default"
                  >
                    <TooltipTrigger delay={0}>
                      <Button
                        iconOnly
                        leadingIcon={ChevronLeft}
                        size="small"
                        aria-label={t('common.back')}
                        variant="neutral"
                        onPress={() => setPanel('main')}
                      />
                      <Tooltip>{t('common.back')}</Tooltip>
                    </TooltipTrigger>
                    <span data-slot="mobile-options-mode-title" className="text-body-medium">
                      {t('toolbar.mode')}
                    </span>
                  </div>
                  <AriaMenu
                    data-slot="mobile-options-mode-list"
                    aria-label={t('toolbar.mode')}
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[mode]}
                    className={panelListCls}
                  >
                    {CHAT_MODES.map((m) => {
                      const Icon = m.icon
                      return (
                        <DropdownItem
                          key={m.id}
                          id={m.id}
                          textValue={t(m.labelKey)}
                          onAction={() => {
                            onSelectMode(m.id)
                            close()
                          }}
                        >
                          <Icon aria-hidden className="size-4 shrink-0 text-text-secondary" />
                          <span data-slot="mobile-options-mode-choice-label" className="min-w-0 flex-1 truncate">
                            {t(m.labelKey)}
                          </span>
                          <span
                            data-slot="mobile-options-mode-choice-desc"
                            className="text-caption-1-regular text-text-secondary"
                          >
                            {t(m.descKey)}
                          </span>
                        </DropdownItem>
                      )
                    })}
                  </AriaMenu>
                </div>
              )}

              {panel === 'thinking' && (
                <div data-slot="mobile-options-thinking-panel" className="flex flex-col">
                  <div
                    data-slot="mobile-options-thinking-header"
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-border-button-default"
                  >
                    <TooltipTrigger delay={0}>
                      <Button
                        iconOnly
                        leadingIcon={ChevronLeft}
                        size="small"
                        aria-label={t('common.back')}
                        variant="neutral"
                        onPress={() => setPanel('main')}
                      />
                      <Tooltip>{t('common.back')}</Tooltip>
                    </TooltipTrigger>
                    <span data-slot="mobile-options-thinking-title" className="text-body-medium">
                      {t('toolbar.thinking')}
                    </span>
                  </div>
                  <AriaMenu
                    data-slot="mobile-options-thinking-list"
                    aria-label={t('toolbar.thinking')}
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[thinkingLevel]}
                    className={panelListCls}
                  >
                    {levels.map((level) => (
                      <DropdownItem
                        key={level.id}
                        id={level.id}
                        textValue={t(level.labelKey)}
                        onAction={() => {
                          onSelectThinkingLevel(level.id)
                          close()
                        }}
                      >
                        <span data-slot="mobile-options-thinking-choice-label" className="min-w-0 flex-1 truncate">
                          {t(level.labelKey)}
                        </span>
                        <span
                          data-slot="mobile-options-thinking-choice-desc"
                          className="text-caption-1-regular text-text-secondary"
                        >
                          {t(level.descKey)}
                        </span>
                      </DropdownItem>
                    ))}
                  </AriaMenu>
                </div>
              )}
            </Sheet.Body>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}
