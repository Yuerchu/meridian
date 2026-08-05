import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronDown, ChevronRight, Wrench, Terminal, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@heroui/react'
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

  const permissionOptions = [
    { value: 'always', label: t('settings.tools.permAlways') },
    { value: 'ask', label: t('settings.tools.permAsk') },
    { value: 'never', label: t('settings.tools.permNever') },
  ]

  return (
    <div className="space-y-3 p-3 border border-border rounded-lg">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted">{t('settings.tools.name')}</label>
          <Input fullWidth value={name} onChange={(e) => setName(e.target.value)} placeholder="my_tool" className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">{t('settings.tools.permission')}</label>
          <Select value={permission} onValueChange={(v) => { if (v) setPermission(v) }} items={permissionOptions}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {permissionOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">{t('settings.tools.description')}</label>
        <Input fullWidth value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">{t('settings.tools.command')}</label>
        <Input fullWidth value={command} onChange={(e) => setCommand(e.target.value)} placeholder="python script.py" className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">{t('settings.tools.argsTemplate')}</label>
        <Input fullWidth value={argsTemplate} onChange={(e) => setArgsTemplate(e.target.value)} placeholder="--input {{input}} --output {{output}}" className="font-mono text-xs" />
        <p className="text-xs text-muted/60">{t('settings.tools.argsTemplateHint')}</p>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">{t('settings.tools.timeout')}</label>
        <Input fullWidth type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} className="w-32" />
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={!name.trim() || !command.trim()}>
          {t('common.save')}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
        {onDelete && (
          <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={onDelete}>
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
    return <div className="text-muted text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.tools.title')}</h2>
        <p className="text-xs text-muted mt-1">{t('settings.tools.subtitle')}</p>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">{t('settings.tools.builtinSection')}</h3>
        <div className="grid grid-cols-1 gap-1">
          {builtinTools.filter((t) => t.source === 'builtin').map((tool) => (
            <div key={tool.name} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg">
              <Wrench className="w-3.5 h-3.5 text-muted flex-shrink-0" />
              <span className="font-mono flex-1">{tool.name}</span>
              <span className="text-muted/60 truncate max-w-[200px]">{tool.description}</span>
            </div>
          ))}
        </div>
      </div>

      {builtinTools.some((tool) => tool.source === 'onebot') && (
        <div>
          <h3 className="text-sm font-medium mb-1">{t('settings.tools.onebotSection')}</h3>
          <p className="text-xs text-muted mb-2">{t('settings.tools.onebotHint')}</p>
          <div className="grid grid-cols-1 gap-1">
            {builtinTools.filter((tool) => tool.source === 'onebot').map((tool) => (
              <div key={tool.name} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg">
                <Wrench className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                <span className="font-mono flex-1">{tool.name}</span>
                <span className="text-muted/60 truncate max-w-[160px]">
                  {t(`settings.tools.qq.${tool.name}`)}
                </span>
                {tool.scope === 'group' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted">{t('settings.tools.qqGroupOnly')}</span>
                )}
                {tool.scope === 'private' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted">{t('settings.tools.qqPrivateOnly')}</span>
                )}
                {tool.admin_only === true && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted">{t('settings.tools.qqAdminOnly')}</span>
                )}
                {tool.needs_approval === true && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted">{t('settings.tools.qqApproval')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">{t('settings.tools.customSection')}</h3>
          <Button variant="outline" onClick={() => setShowCreate(!showCreate)}>
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
                <Button
                  variant="ghost"
                  onClick={() => setExpandedToolId(isExpanded ? null : ct.id)}
                  className="w-full justify-start h-auto px-3 py-2 text-xs"
                >
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <Terminal className="w-3.5 h-3.5 text-muted" />
                  <span className="font-mono flex-1">{ct.name}</span>
                  <span className="text-muted/60">{ct.command}</span>
                  {ct.is_enabled === 0 && (
                    <span className="text-xs text-muted bg-default px-1 rounded">{t('settings.tools.disabled')}</span>
                  )}
                </Button>
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
            <p className="text-xs text-muted text-center py-4">{t('settings.tools.noCustom')}</p>
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
                <span className="text-muted/60">{toolNames.length} tools</span>
                {preset.is_builtin === 1 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted">{t('settings.template.builtin')}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
