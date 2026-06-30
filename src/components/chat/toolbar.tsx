import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, Cpu, Check, Star, Lightbulb, RefreshCw } from 'lucide-react'
import { ModelIcon } from '@lobehub/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import type { Assistant, Provider, ProviderCapabilities, ModelInfo, ThinkingLevel } from '@/types'

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
      <PopoverTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Bot className="w-3.5 h-3.5" />
        <span className="max-w-[120px] truncate">{current?.name ?? t('toolbar.noAssistant')}</span>
        <ChevronDown className="w-3 h-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1 bg-popover border-border">
        {assistants.map((a) => (
          <Button
            key={a.id}
            variant="ghost"
            onClick={() => {
              onSelect(a.id)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 h-auto text-xs justify-start',
              a.id === currentId
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {a.is_default === 1 && <Star className="w-3 h-3 text-amber-500 flex-shrink-0" fill="currentColor" />}
            <span className="flex-1 truncate">{a.name}</span>
            {a.id === currentId && <Check className="w-3 h-3 text-muted-foreground" />}
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
      <PopoverTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        {currentModelId ? <ModelIcon model={currentModelId} size={14} /> : <Cpu className="w-3.5 h-3.5" />}
        <span className="max-w-[160px] truncate">{currentModelId ?? t('toolbar.selectModel')}</span>
        <ChevronDown className="w-3 h-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0 bg-popover border-border">
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t('toolbar.models')}</span>
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
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">{t('toolbar.loadingModels')}</div>}
          {groups.map((g) => (
            <div key={g.provider.id}>
              <div className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
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
                    'w-full flex items-center gap-2 px-2.5 py-1.5 h-auto text-xs justify-start',
                    m.id === currentModelId && g.provider.id === currentProviderId
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <ModelIcon model={m.id} size={14} className="flex-shrink-0" />
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.id === currentModelId && g.provider.id === currentProviderId && (
                    <Check className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  )}
                </Button>
              ))}
            </div>
          ))}
          {!loading && groups.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
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
  { id: 'low', labelKey: 'toolbar.thinking.low', descKey: 'toolbar.thinking.lowDesc' },
  { id: 'medium', labelKey: 'toolbar.thinking.medium', descKey: 'toolbar.thinking.mediumDesc' },
  { id: 'high', labelKey: 'toolbar.thinking.high', descKey: 'toolbar.thinking.highDesc' },
  { id: 'max', labelKey: 'toolbar.thinking.max', descKey: 'toolbar.thinking.maxDesc' },
]

function ThinkingSelector({
  current,
  onSelect,
}: {
  current: ThinkingLevel
  onSelect: (level: ThinkingLevel) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isActive = current !== 'default' && current !== 'off'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
        isActive
          ? 'text-blue-400 hover:text-blue-300 hover:bg-accent'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
      )}>
        <Lightbulb className="w-3.5 h-3.5" />
        {current !== 'default' && (
          <span className="max-w-[60px] truncate">{t(`toolbar.thinking.${current}`)}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1 bg-popover border-border">
        <div className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {t('toolbar.thinking')}
        </div>
        {THINKING_LEVELS.map((level) => (
          <Button
            key={level.id}
            variant="ghost"
            onClick={() => { onSelect(level.id); setOpen(false) }}
            className={cn(
              'w-full flex items-center justify-between px-2.5 py-1.5 h-auto text-xs',
              level.id === current
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <span>{t(level.labelKey)}</span>
            <span className="text-[10px] text-muted-foreground/60">{t(level.descKey)}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
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
          />
        </>
      )}
    </div>
  )
}
