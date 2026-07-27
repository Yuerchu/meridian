import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronLeft, ChevronRight, Cpu, Check, Star, Lightbulb, RefreshCw, Plus, Camera, ImageIcon, Paperclip, Zap } from 'lucide-react'
import { ModelIcon } from '@lobehub/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { allowedEfforts } from '@/lib/thinking'
import type { Assistant, Provider, ProviderCapabilities, ModelInfo, ThinkingEffort, ThinkingLevel } from '@/types'

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
  capabilities?: ProviderCapabilities | null
}

function AssistantSelector({
  assistants,
  currentId,
  onSelect,
}: {
  assistants: Assistant[]
  currentId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = assistants.find((a) => a.id === currentId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors touch-hitbox">
        <Bot className="w-3.5 h-3.5" />
        <span className="max-w-[120px] truncate">{current?.name ?? t('toolbar.noAssistant')}</span>
        <ChevronDown className="w-3 h-3" />
      </PopoverTrigger>
      {/* gap-0: PopoverContent defaults to gap-2.5 for card-style content, which
          would space out menu rows. Select menus stack flush. */}
      <PopoverContent align="start" className="w-52 gap-0 p-1 bg-popover border-border">
        {assistants.map((a) => (
          <Button
            key={a.id}
            variant="ghost"
            onClick={() => {
              onSelect(a.id)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 h-auto text-sm justify-start',
              a.id === currentId
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {a.is_default === 1 && (
              <Star
                // eslint-disable-next-line no-restricted-syntax -- CLAUDE.md whitelist: gold-star semantics
                className="size-4 text-amber-500 flex-shrink-0"
                fill="currentColor"
              />
            )}
            <span className="flex-1 truncate">{a.name}</span>
            {a.id === currentId && <Check className="size-4 text-muted-foreground" />}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

interface GroupedModels {
  provider: Provider
  models: ModelInfo[]
}

function ModelSelector({
  providers,
  currentModelId,
  currentProviderId,
  onSelect,
}: {
  providers: Provider[]
  currentModelId: string | null
  currentProviderId: string | null
  onSelect: (modelId: string, providerId: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<GroupedModels[]>([])
  const [loading, setLoading] = useState(false)

  const loadModels = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && groups.length > 0) return
    setLoading(true)
    const results = await Promise.allSettled(
      providers
        .filter((p) => p.is_enabled)
        .map(async (p) => ({
          provider: p,
          models: await api.fetchProviderModels(p.id, forceRefresh),
        })),
    )
    setGroups(
      results
        .filter((r): r is PromiseFulfilledResult<GroupedModels> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((g) => g.models.length > 0),
    )
    setLoading(false)
  }, [providers, groups.length])

  useEffect(() => {
    if (open) loadModels()
  }, [open, loadModels])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors touch-hitbox">
        {currentModelId ? <ModelIcon model={currentModelId} size={14} /> : <Cpu className="w-3.5 h-3.5" />}
        <span className="max-w-[160px] truncate">{currentModelId ?? t('toolbar.selectModel')}</span>
        <ChevronDown className="w-3 h-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-0 bg-popover border-border">
        <div className="flex items-center justify-between px-1.5 py-1 border-b border-border">
          <span className="text-xs text-muted-foreground">{t('toolbar.models')}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => loadModels(true)}
            disabled={loading}
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </Button>
        </div>
        <ScrollArea className="h-72 p-1">
          {loading && <div className="px-1.5 py-1 text-sm text-muted-foreground">{t('toolbar.loadingModels')}</div>}
          {groups.map((g) => (
            <div key={g.provider.id}>
              <div className="px-1.5 py-1 text-xs text-muted-foreground">
                {g.provider.name}
              </div>
              {g.models.map((m) => (
                <Button
                  key={`${g.provider.id}-${m.id}`}
                  variant="ghost"
                  onClick={() => {
                    onSelect(m.id, g.provider.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 h-auto text-sm justify-start',
                    m.id === currentModelId && g.provider.id === currentProviderId
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <ModelIcon model={m.id} size={16} className="flex-shrink-0" />
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.id === currentModelId && g.provider.id === currentProviderId && (
                    <Check className="size-4 text-muted-foreground flex-shrink-0" />
                  )}
                </Button>
              ))}
            </div>
          ))}
          {!loading && groups.length === 0 && (
            <div className="px-1.5 py-1 text-sm text-muted-foreground">
              {t('toolbar.noModels')}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
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

export function ThinkingSelector({
  current,
  onSelect,
  capabilities,
}: {
  current: ThinkingLevel
  onSelect: (level: ThinkingLevel) => void
  capabilities?: ProviderCapabilities | null
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isActive = current !== 'default' && current !== 'off'
  const levels = levelsFor(capabilities)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors touch-hitbox',
        isActive
          ? 'text-info hover:text-info/80 hover:bg-accent'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
      )}>
        <Lightbulb className="w-3.5 h-3.5" />
        {current !== 'default' && (
          <span className="max-w-[60px] truncate">{t(`toolbar.thinking.${current}`)}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-1 bg-popover border-border">
        <div className="px-1.5 py-1 text-xs text-muted-foreground">
          {t('toolbar.thinking')}
        </div>
        {levels.map((level) => (
          <Button
            key={level.id}
            variant="ghost"
            onClick={() => { onSelect(level.id); setOpen(false) }}
            className={cn(
              'w-full flex items-center justify-between gap-1.5 rounded-md px-1.5 py-1 h-auto text-sm',
              level.id === current
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <span>{t(level.labelKey)}</span>
            <span className="text-xs text-muted-foreground/60">{t(level.descKey)}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Low-latency tier toggle. Only rendered for models that advertise it, so an
 * explicit `true` is required rather than the optimistic `!== false` used for
 * the thinking selector -- offering a tier the model lacks would be a wasted
 * control, whereas offering an extra effort tier is harmless.
 */
export function FastToggle({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: (next: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Button
      data-slot="fast-toggle"
      variant="ghost"
      aria-pressed={active}
      onClick={() => onToggle(!active)}
      className={cn(
        // border-0 and an explicit icon size cancel out <Button>'s defaults
        // (border-transparent, plus a svg:size-4 rule that only skips classes
        // containing "size-") so this lines up with the bare PopoverTriggers
        // sitting next to it.
        'flex items-center gap-1 px-2 py-1 h-auto border-0 rounded-md text-xs transition-colors touch-hitbox',
        active
          ? 'text-warning hover:text-warning/80 hover:bg-accent'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
      )}
    >
      <Zap className="size-3.5" />
      {active && <span>{t('toolbar.fast')}</span>}
    </Button>
  )
}

export function Toolbar(props: ToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none">
      <AssistantSelector
        assistants={props.assistants}
        currentId={props.currentAssistantId}
        onSelect={props.onSelectAssistant}
      />
      <span className="text-border text-xs">·</span>
      <ModelSelector
        providers={props.providers}
        currentModelId={props.currentModelId}
        currentProviderId={props.currentProviderId}
        onSelect={props.onSelectModel}
      />
      {props.capabilities?.supports_thinking !== false && (
        <>
          <span className="text-border text-xs">·</span>
          <ThinkingSelector
            current={props.thinkingLevel}
            onSelect={props.onSelectThinkingLevel}
            capabilities={props.capabilities}
          />
        </>
      )}
      {props.capabilities?.supports_fast === true && (
        <>
          <span className="text-border text-xs">·</span>
          <FastToggle active={props.fastMode} onToggle={props.onToggleFast} />
        </>
      )}
    </div>
  )
}

// ---- Mobile bottom-sheet options menu ----

export interface MobileOptionsMenuProps extends ToolbarProps {
  onTakePhoto: () => void
  onPickGallery: () => void
  onPickFile: () => void
  supportsImages: boolean
}

type MobilePanel = 'main' | 'assistant' | 'model' | 'thinking'

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
  const itemCls = 'flex h-auto items-center justify-start gap-3 w-full rounded-none px-4 py-2.5 text-sm font-normal text-foreground active:bg-accent transition-colors'

  return (
    <Sheet open={open} onOpenChange={(o) => {
      setOpen(o)
      if (!o) setTimeout(() => setPanel('main'), 200)
    }}>
      <SheetTrigger className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors touch-hitbox">
        <Plus className="w-4 h-4" />
      </SheetTrigger>
      <SheetContent side="bottom" showCloseButton={false} className="pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[70vh]">
        {panel === 'main' && (
          <div className="flex flex-col">
            {supportsImages && (
              <>
                <Button variant="ghost" className={itemCls} onClick={() => handleAction(onTakePhoto)}>
                  <Camera className="w-4 h-4 text-muted-foreground" />
                  {t('chat.takePhoto')}
                </Button>
                <Button variant="ghost" className={itemCls} onClick={() => handleAction(onPickGallery)}>
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  {t('chat.pickFromGallery')}
                </Button>
              </>
            )}
            <Button variant="ghost" className={itemCls} onClick={() => handleAction(onPickFile)}>
              <Paperclip className="w-4 h-4 text-muted-foreground" />
              {t('chat.attachFile')}
            </Button>
            <div className="h-px bg-border mx-4 my-1" />
            <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('assistant')}>
              <span className="flex items-center gap-3">
                <Bot className="w-4 h-4 text-muted-foreground" />
                <span>{currentAssistant?.name ?? t('toolbar.noAssistant')}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('model')}>
              <span className="flex items-center gap-3">
                {currentModelId
                  ? <ModelIcon model={currentModelId} size={16} />
                  : <Cpu className="w-4 h-4 text-muted-foreground" />}
                <span className="truncate max-w-[200px]">{currentModelId ?? t('toolbar.selectModel')}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Button>
            {supportsThinking && (
              <Button variant="ghost" className={cn(itemCls, 'justify-between')} onClick={() => setPanel('thinking')}>
                <span className="flex items-center gap-3">
                  <Lightbulb className={cn('w-4 h-4', thinkingLevel !== 'default' && thinkingLevel !== 'off' ? 'text-info' : 'text-muted-foreground')} />
                  <span>{t('toolbar.thinking')}: {thinkingLabel}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
                  <Zap className={cn('w-4 h-4', fastMode ? 'text-warning' : 'text-muted-foreground')} />
                  <span>{t('toolbar.fast')}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {fastMode ? t('toolbar.fast.on') : t('toolbar.fast.off')}
                </span>
              </Button>
            )}
          </div>
        )}

        {panel === 'assistant' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-accent" onClick={() => setPanel('main')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">{t('toolbar.noAssistant').replace(/^No /, 'Select ')}</span>
            </div>
            <ScrollArea className="max-h-[50vh]">
              {assistants.map((a) => (
                <Button
                  key={a.id}
                  variant="ghost"
                  className={cn(itemCls, a.id === currentAssistantId && 'bg-accent')}
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
                  {a.id === currentAssistantId && <Check className="w-4 h-4 text-muted-foreground" />}
                </Button>
              ))}
            </ScrollArea>
          </div>
        )}

        {panel === 'model' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-accent" onClick={() => setPanel('main')}>
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
              {loadingModels && <div className="px-4 py-3 text-xs text-muted-foreground">{t('toolbar.loadingModels')}</div>}
              {groups.map((g) => (
                <div key={g.provider.id}>
                  <div className="px-4 py-1 text-xs text-muted-foreground">
                    {g.provider.name}
                  </div>
                  {g.models.map((m) => (
                    <Button
                      key={`${g.provider.id}-${m.id}`}
                      variant="ghost"
                      className={cn(
                        itemCls,
                        m.id === currentModelId && g.provider.id === currentProviderId && 'bg-accent',
                      )}
                      onClick={() => { onSelectModel(m.id, g.provider.id); close() }}
                    >
                      <ModelIcon model={m.id} size={16} className="flex-shrink-0" />
                      <span className="flex-1 truncate">{m.name}</span>
                      {m.id === currentModelId && g.provider.id === currentProviderId && (
                        <Check className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </Button>
                  ))}
                </div>
              ))}
              {!loadingModels && groups.length === 0 && (
                <div className="px-4 py-3 text-xs text-muted-foreground">{t('toolbar.noModels')}</div>
              )}
            </ScrollArea>
          </div>
        )}

        {panel === 'thinking' && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Button variant="ghost" size="icon" className="size-auto p-1 rounded-md hover:bg-accent" onClick={() => setPanel('main')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">{t('toolbar.thinking')}</span>
            </div>
            {levels.map((level) => (
              <Button
                key={level.id}
                variant="ghost"
                className={cn(itemCls, 'justify-between', level.id === thinkingLevel && 'bg-accent')}
                onClick={() => { onSelectThinkingLevel(level.id); close() }}
              >
                <span>{t(level.labelKey)}</span>
                <span className="text-xs text-muted-foreground">{t(level.descKey)}</span>
              </Button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
