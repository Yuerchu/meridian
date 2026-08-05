import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronLeft, ChevronRight, ChevronsRight, Cpu, Check, Star, Lightbulb, RefreshCw, Plus, Camera, ImageIcon, Paperclip, Zap, Hammer, Compass } from 'lucide-react'
import { ModelIcon } from '@/components/ui/model-icon'
import { Button } from '@/components/ui/button'
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { allowedEfforts } from '@/lib/thinking'
import type { Assistant, ChatMode, Provider, ProviderCapabilities, ModelInfo, ThinkingEffort, ThinkingLevel } from '@/types'

interface ToolbarProps {
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
}

const CHAT_MODES: Array<{ id: ChatMode; icon: typeof Hammer; labelKey: string; descKey: string }> = [
  { id: 'work', icon: Hammer, labelKey: 'toolbar.mode.work', descKey: 'toolbar.mode.workDesc' },
  { id: 'plan', icon: Compass, labelKey: 'toolbar.mode.plan', descKey: 'toolbar.mode.planDesc' },
]

interface GroupedModels {
  provider: Provider
  models: ModelInfo[]
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
 * The tiers to offer for a model: always `default`/`off`, plus whatever effort
 * tiers the model advertises. Unknown capabilities fall back to the full ladder
 * (see `allowedEfforts`).
 */
function levelsFor(capabilities: ProviderCapabilities | null | undefined) {
  const allowed = allowedEfforts(capabilities ?? null)
  return THINKING_LEVELS.filter(
    (l) => l.id === 'default' || l.id === 'off' || allowed.includes(l.id as ThinkingEffort),
  )
}

// ---- Mobile bottom-sheet options menu ----

export interface MobileOptionsMenuProps extends ToolbarProps {
  onTakePhoto: () => void
  onPickGallery: () => void
  onPickFile: () => void
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
  const thinkingLabel = thinkingLevel === 'default'
    ? t('toolbar.thinking.default')
    : t(`toolbar.thinking.${thinkingLevel}`)

  const close = useCallback(() => {
    setOpen(false)
    setTimeout(() => setPanel('main'), 200)
  }, [])

  const handleAction = useCallback((action: () => void) => {
    close()
    action()
  }, [close])

  useEffect(() => {
    if (panel !== 'model' || modelsLoaded) return
    setLoadingModels(true)
    Promise.allSettled(
      providers.filter((p) => p.is_enabled).map(async (p) => ({
        provider: p,
        models: await api.fetchProviderModels(p.id, false),
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
  // so the sheet items keep their original full-width list layout.
  const itemCls = 'flex h-auto items-center justify-start gap-3 w-full rounded-none px-4 py-2.5 text-sm font-normal text-foreground active:bg-default transition-colors'

  return (
    <Sheet open={open} onOpenChange={(o) => {
      setOpen(o)
      if (!o) setTimeout(() => setPanel('main'), 200)
    }}>
      <SheetTrigger className="inline-flex items-center justify-center rounded-md p-1 text-muted hover:text-foreground hover:bg-default transition-colors touch-hitbox">
        <Plus className="w-4 h-4" />
      </SheetTrigger>
      <SheetContent side="bottom" showCloseButton={false} className="pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[70vh]">
        {panel === 'main' && (
          <div className="flex flex-col">
            {supportsImages && (
              <>
                <Button variant="ghost" className={itemCls} onClick={() => handleAction(onTakePhoto)}>
                  <Camera className="w-4 h-4 text-muted" />
                  {t('chat.takePhoto')}
                </Button>
                <Button variant="ghost" className={itemCls} onClick={() => handleAction(onPickGallery)}>
                  <ImageIcon className="w-4 h-4 text-muted" />
                  {t('chat.pickFromGallery')}
                </Button>
              </>
            )}
            <Button variant="ghost" className={itemCls} onClick={() => handleAction(onPickFile)}>
              <Paperclip className="w-4 h-4 text-muted" />
              {t('chat.attachFile')}
            </Button>
            <div className="h-px bg-border mx-4 my-1" />
            <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('mode')}>
              <span className="flex items-center gap-3">
                {(() => {
                  const active = CHAT_MODES.find((m) => m.id === mode) ?? CHAT_MODES[0]
                  const Icon = active.icon
                  return (
                    <>
                      <Icon className={cn('w-4 h-4', mode === 'work' ? 'text-muted' : 'text-info')} />
                      <span>{t('toolbar.mode')}: {t(active.labelKey)}</span>
                    </>
                  )
                })()}
              </span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </Button>
            <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('assistant')}>
              <span className="flex items-center gap-3">
                <Bot className="w-4 h-4 text-muted" />
                <span>{currentAssistant?.name ?? t('toolbar.noAssistant')}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </Button>
            <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('model')}>
              <span className="flex items-center gap-3">
                {currentModelId
                  ? <ModelIcon model={currentModelId} size={16} />
                  : <Cpu className="w-4 h-4 text-muted" />}
                <span className="truncate max-w-[200px]">{currentModelId ?? t('toolbar.selectModel')}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </Button>
            {supportsThinking && (
              <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('thinking')}>
                <span className="flex items-center gap-3">
                  <Lightbulb className={cn('w-4 h-4', thinkingLevel !== 'default' && thinkingLevel !== 'off' ? 'text-info' : 'text-muted')} />
                  <span>{t('toolbar.thinking')}: {thinkingLabel}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted" />
              </Button>
            )}
            {mode !== 'plan' && (
              <Button
                data-slot="mobile-accept-edits-row"
                variant="ghost"
                aria-pressed={acceptEdits}
                className={cn(itemCls, 'justify-between')}
                onClick={() => onToggleAcceptEdits(!acceptEdits)}
              >
                <span className="flex items-center gap-3">
                  <ChevronsRight
                    className={cn('w-4 h-4', acceptEdits ? 'text-warning' : 'text-muted')}
                  />
                  <span>{t('toolbar.acceptEdits')}</span>
                </span>
                <span className="text-xs text-muted">
                  {acceptEdits ? t('toolbar.acceptEdits.on') : t('toolbar.acceptEdits.off')}
                </span>
              </Button>
            )}
            {supportsFast && (
              <Button
                data-slot="mobile-fast-row"
                variant="ghost"
                aria-pressed={fastMode}
                className={cn(itemCls, 'justify-between')}
                onClick={() => onToggleFast(!fastMode)}
              >
                <span className="flex items-center gap-3">
                  <Zap className={cn('w-4 h-4', fastMode ? 'text-warning' : 'text-muted')} />
                  <span>{t('toolbar.fast')}</span>
                </span>
                <span className="text-xs text-muted">
                  {fastMode ? t('toolbar.fast.on') : t('toolbar.fast.off')}
                </span>
              </Button>
            )}
          </div>
        )}

        {panel === 'assistant' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-default" onClick={() => setPanel('main')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">{t('toolbar.noAssistant').replace(/^No /, 'Select ')}</span>
            </div>
            <ScrollArea className="max-h-[50vh]">
              {assistants.map((a) => (
                <Button
                  key={a.id}
                  variant="ghost"
                  className={cn(itemCls, a.id === currentAssistantId && 'bg-default')}
                  onClick={() => { onSelectAssistant(a.id); close() }}
                >
                  {a.is_default === 1 && (
                    <Star
                      // eslint-disable-next-line no-restricted-syntax -- CLAUDE.md whitelist: gold-star semantics
                      className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"
                      fill="currentColor"
                    />
                  )}
                  <span className="flex-1 truncate">{a.name}</span>
                  {a.id === currentAssistantId && <Check className="w-4 h-4 text-muted" />}
                </Button>
              ))}
            </ScrollArea>
          </div>
        )}

        {panel === 'model' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-default" onClick={() => setPanel('main')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium flex-1">{t('toolbar.models')}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setLoadingModels(true)
                  setGroups([])
                  Promise.allSettled(
                    providers.filter((p) => p.is_enabled).map(async (p) => ({
                      provider: p,
                      models: await api.fetchProviderModels(p.id, true),
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
                disabled={loadingModels}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', loadingModels && 'animate-spin')} />
              </Button>
            </div>
            <ScrollArea className="max-h-[50vh]">
              {loadingModels && <div className="px-4 py-3 text-xs text-muted">{t('toolbar.loadingModels')}</div>}
              {groups.map((g) => (
                <div key={g.provider.id}>
                  <div className="px-4 py-1 text-xs text-muted">
                    {g.provider.name}
                  </div>
                  {g.models.map((m) => (
                    <Button
                      key={`${g.provider.id}-${m.id}`}
                      variant="ghost"
                      className={cn(
                        itemCls,
                        m.id === currentModelId && g.provider.id === currentProviderId && 'bg-default',
                      )}
                      onClick={() => { onSelectModel(m.id, g.provider.id); close() }}
                    >
                      <ModelIcon model={m.id} size={16} className="flex-shrink-0" />
                      <span className="flex-1 truncate">{m.name}</span>
                      {m.id === currentModelId && g.provider.id === currentProviderId && (
                        <Check className="w-4 h-4 text-muted flex-shrink-0" />
                      )}
                    </Button>
                  ))}
                </div>
              ))}
              {!loadingModels && groups.length === 0 && (
                <div className="px-4 py-3 text-xs text-muted">{t('toolbar.noModels')}</div>
              )}
            </ScrollArea>
          </div>
        )}

        {panel === 'mode' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-default" onClick={() => setPanel('main')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">{t('toolbar.mode')}</span>
            </div>
            {CHAT_MODES.map((m) => {
              const Icon = m.icon
              return (
                <Button
                  key={m.id}
                  variant="ghost"
                  className={cn(itemCls, 'justify-between', m.id === mode && 'bg-default')}
                  onClick={() => { onSelectMode(m.id); close() }}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-muted" />
                    <span>{t(m.labelKey)}</span>
                  </span>
                  <span className="text-xs text-muted">{t(m.descKey)}</span>
                </Button>
              )
            })}
          </div>
        )}

        {panel === 'thinking' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-default" onClick={() => setPanel('main')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">{t('toolbar.thinking')}</span>
            </div>
            {levels.map((level) => (
              <Button
                key={level.id}
                variant="ghost"
                className={cn(itemCls, 'justify-between', level.id === thinkingLevel && 'bg-default')}
                onClick={() => { onSelectThinkingLevel(level.id); close() }}
              >
                <span>{t(level.labelKey)}</span>
                <span className="text-xs text-muted">{t(level.descKey)}</span>
              </Button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
