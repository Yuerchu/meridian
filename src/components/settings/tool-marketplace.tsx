import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronDown, ChevronRight, Wrench, Terminal, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/api'
import type { CustomTool, ToolInfo, ToolPreset } from '@/types'

function CustomToolEditor({
  tool,
  onSave,
  onDelete,
}: {
  tool?: CustomTool
  onSave: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(tool?.name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [command, setCommand] = useState(tool?.command ?? '')
  const [argsTemplate, setArgsTemplate] = useState(tool?.args_template ?? '')
  const [permission, setPermission] = useState(tool?.permission ?? 'ask')
  const [timeoutMs, setTimeoutMs] = useState(tool?.timeout_ms?.toString() ?? '30000')
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    if (!name.trim() || !description.trim() || !command.trim()) return
    if (tool) {
      await api.updateCustomTool(tool.id, {
        name: name.trim(),
        description: description.trim(),
        command: command.trim(),
        argsTemplate: argsTemplate.trim() || null,
        permission,
        timeoutMs: timeoutMs ? parseInt(timeoutMs) : null,
      })
    } else {
      await api.createCustomTool({
        name: name.trim(),
        description: description.trim(),
        command: command.trim(),
        argsTemplate: argsTemplate.trim() || undefined,
        permission,
        timeoutMs: timeoutMs ? parseInt(timeoutMs) : undefined,
      })
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onSave()
  }

  return (
    <div className="space-y-3 p-3 border border-border rounded-lg">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t('settings.tools.name')}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_tool" className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t('settings.tools.permission')}</label>
          <Select value={permission} onValueChange={(v) => { if (v) setPermission(v) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="always">{t('settings.tools.permAlways')}</SelectItem>
              <SelectItem value="ask">{t('settings.tools.permAsk')}</SelectItem>
              <SelectItem value="never">{t('settings.tools.permNever')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{t('settings.tools.description')}</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{t('settings.tools.command')}</label>
        <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="python script.py" className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{t('settings.tools.argsTemplate')}</label>
        <Input value={argsTemplate} onChange={(e) => setArgsTemplate(e.target.value)} placeholder="--input {{input}} --output {{output}}" className="font-mono text-xs" />
        <p className="text-[10px] text-muted-foreground/60">{t('settings.tools.argsTemplateHint')}</p>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{t('settings.tools.timeout')}</label>
        <Input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} className="w-32" />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={!name.trim() || !command.trim()}>
          {t('common.save')}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] text-green-400">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
        {onDelete && (
          <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function ToolMarketplace() {
  const { t } = useTranslation()
  const [builtinTools, setBuiltinTools] = useState<ToolInfo[]>([])
  const [customTools, setCustomTools] = useState<CustomTool[]>([])
  const [presets, setPresets] = useState<ToolPreset[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [tools, custom, cats, pres] = await Promise.all([
      api.listAllToolNames(),
      api.listCustomTools(),
      api.listToolCategories(),
      api.listToolPresets(),
    ])
    setBuiltinTools(tools)
    setCustomTools(custom)
    void cats
    setPresets(pres)
  }, [])

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [refresh])

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.tools.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('settings.tools.subtitle')}</p>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">{t('settings.tools.builtinSection')}</h3>
        <div className="grid grid-cols-1 gap-1">
          {builtinTools.filter((t) => t.source === 'builtin').map((tool) => (
            <div key={tool.name} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg">
              <Wrench className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="font-mono flex-1">{tool.name}</span>
              <span className="text-muted-foreground/60 truncate max-w-[200px]">{tool.description}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">{t('settings.tools.customSection')}</h3>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.tools.new')}
          </Button>
        </div>

        {showCreate && (
          <div className="mb-3">
            <CustomToolEditor
              onSave={() => { setShowCreate(false); refresh() }}
            />
          </div>
        )}

        <div className="space-y-1">
          {customTools.map((ct) => {
            const isExpanded = expandedToolId === ct.id
            return (
              <div key={ct.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedToolId(isExpanded ? null : ct.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/50 transition-colors text-left"
                >
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-mono flex-1">{ct.name}</span>
                  <span className="text-muted-foreground/60">{ct.command}</span>
                  {ct.is_enabled === 0 && (
                    <span className="text-[10px] text-muted-foreground bg-accent px-1 rounded">{t('settings.tools.disabled')}</span>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <CustomToolEditor
                      tool={ct}
                      onSave={refresh}
                      onDelete={async () => {
                        await api.deleteCustomTool(ct.id)
                        setExpandedToolId(null)
                        refresh()
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
          {customTools.length === 0 && !showCreate && (
            <p className="text-xs text-muted-foreground text-center py-4">{t('settings.tools.noCustom')}</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">{t('settings.tools.presetsSection')}</h3>
        <div className="space-y-1">
          {presets.map((preset) => {
            const toolNames: string[] = JSON.parse(preset.tool_names || '[]')
            return (
              <div key={preset.id} className="flex items-center gap-2 px-3 py-2 text-xs border border-border rounded-lg">
                <span className="font-medium flex-1">{preset.name}</span>
                <span className="text-muted-foreground/60">{toolNames.length} tools</span>
                {preset.is_builtin === 1 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">{t('settings.template.builtin')}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
