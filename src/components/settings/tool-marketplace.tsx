import { useEffect, useState, useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, TrashBin, Wrench, Terminal, Check } from '@gravity-ui/icons'
import { Button, Card, Disclosure, DisclosureGroup, Input, Label, ListBox, Select } from '@heroui/react'
import { api } from '@/api'
import type { CustomTool, ToolInfo, ToolPreset } from '@/types'
import { SettingsHeader, SettingsPane } from './primitives'
import { SettingsDrilldown } from './settings-drilldown'

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
  const nameId = useId()
  const descriptionId = useId()
  const commandId = useId()
  const argsTemplateId = useId()
  const timeoutId = useId()

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

  // No chrome of its own: the caller decides whether this is a card floating on
  // the page or the body of an already-bounded disclosure row.
  return (
    <div data-slot="custom-tool-editor" className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor={nameId} className="text-xs text-muted">{t('settings.tools.name')}</label>
          <Input fullWidth id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="my_tool" className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Select value={permission} onChange={(v) => { if (v) setPermission(String(v)) }}>
            <Label className="text-xs text-muted">{t('settings.tools.permission')}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {permissionOptions.map((o) => (
                  <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                    {o.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={descriptionId} className="text-xs text-muted">{t('settings.tools.description')}</label>
        <Input fullWidth id={descriptionId} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor={commandId} className="text-xs text-muted">{t('settings.tools.command')}</label>
        <Input fullWidth id={commandId} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="python script.py" className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <label htmlFor={argsTemplateId} className="text-xs text-muted">{t('settings.tools.argsTemplate')}</label>
        <Input fullWidth id={argsTemplateId} value={argsTemplate} onChange={(e) => setArgsTemplate(e.target.value)} placeholder="--input {{input}} --output {{output}}" className="font-mono text-xs" />
        <p className="text-xs text-muted">{t('settings.tools.argsTemplateHint')}</p>
      </div>
      <div className="space-y-1">
        <label htmlFor={timeoutId} className="text-xs text-muted">{t('settings.tools.timeout')}</label>
        <Input fullWidth id={timeoutId} type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} className="w-32" />
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} isDisabled={!name.trim() || !command.trim()}>
          {t('common.save')}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success-soft-foreground">
            <Check className="w-3.5 h-3.5" /> {t('common.saved')}
          </span>
        )}
        {onDelete && (
          <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={onDelete}>
            <TrashBin className="w-3.5 h-3.5" />
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
    <SettingsPane>
      <SettingsHeader title={t('settings.tools.title')} subtitle={t('settings.tools.subtitle')} />

      <SettingsDrilldown
        title={t('settings.tools.builtinSection')}
        summary={builtinTools.filter((tool) => tool.source === 'builtin').length}
      >
        <div className="grid grid-cols-1 gap-1">
          {builtinTools.filter((t) => t.source === 'builtin').map((tool) => (
            <div key={tool.name} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg">
              <Wrench className="w-3.5 h-3.5 text-muted flex-shrink-0" />
              <span className="font-mono flex-1">{tool.name}</span>
              <span className="text-muted truncate max-w-[200px]">{tool.description}</span>
            </div>
          ))}
        </div>
      </SettingsDrilldown>

      {builtinTools.some((tool) => tool.source === 'onebot') && (
        <SettingsDrilldown
          title={t('settings.tools.onebotSection')}
          summary={builtinTools.filter((tool) => tool.source === 'onebot').length}
        >
          <p className="text-xs text-muted">{t('settings.tools.onebotHint')}</p>
          <div className="grid grid-cols-1 gap-1">
            {builtinTools.filter((tool) => tool.source === 'onebot').map((tool) => (
              <div key={tool.name} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg">
                <Wrench className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                <span className="font-mono flex-1">{tool.name}</span>
                <span className="text-muted truncate max-w-[160px]">
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
        </SettingsDrilldown>
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
          <Card className="mb-3">
            <CustomToolEditor
              onSave={() => { setShowCreate(false); refresh() }}
            />
          </Card>
        )}

        {/* One open at a time is the group's own default
            (`allowsMultipleExpanded` is off), so the single-open rule lives in
            the primitive rather than in the click handler. */}
        <DisclosureGroup
          className="flex flex-col gap-1"
          expandedKeys={expandedToolId ? [expandedToolId] : []}
          onExpandedChange={(keys) => setExpandedToolId((([...keys][0] as string | undefined) ?? null))}
        >
          {customTools.map((ct) => {
            const isExpanded = expandedToolId === ct.id
            return (
              <Disclosure
                key={ct.id}
                id={ct.id}
                className="flex w-full flex-col overflow-hidden rounded-lg border border-border"
              >
                <Disclosure.Heading>
                  {/* `flex` is not optional: HeroUI styles the indicator with
                      `ms-auto` and `shrink-0`, which only mean anything inside a
                      flex container. `text-start` undoes the button element's
                      centred UA default. */}
                  <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30">
                    <Terminal className="w-3.5 h-3.5 shrink-0 text-muted" />
                    <span className="font-mono min-w-0 flex-1 truncate">{ct.name}</span>
                    <span className="text-muted truncate">{ct.command}</span>
                    {ct.is_enabled === 0 && (
                      <span className="text-xs text-muted bg-default px-1 rounded shrink-0">{t('settings.tools.disabled')}</span>
                    )}
                    <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
                  </Disclosure.Trigger>
                </Disclosure.Heading>
                {/* `min-h-0` is load-bearing: the card is a flex column, and a
                    flex item's default `min-height: auto` floors it at its
                    content height. */}
                <Disclosure.Content className="min-h-0 w-full">
                  {/* Body, not a plain wrapper: it is what keeps the panel
                      measurable, so without it the editor never collapses. The
                      padding is the editor's own former `p-3`, moved out here
                      now that the row is the only box around it. */}
                  <Disclosure.Body className="p-3">
                    {/* A collapsed panel is only hidden, not unmounted, so the
                        editor is still gated on the open row. */}
                    {isExpanded && (
                      <CustomToolEditor
                        tool={ct}
                        onSave={refresh}
                        onDelete={async () => {
                          await api.deleteCustomTool(ct.id)
                          setExpandedToolId(null)
                          refresh()
                        }}
                      />
                    )}
                  </Disclosure.Body>
                </Disclosure.Content>
              </Disclosure>
            )
          })}
          {customTools.length === 0 && !showCreate && (
            <p className="text-xs text-muted text-center py-4">{t('settings.tools.noCustom')}</p>
          )}
        </DisclosureGroup>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">{t('settings.tools.presetsSection')}</h3>
        <div className="space-y-1">
          {presets.map((preset) => {
            const toolNames: string[] = JSON.parse(preset.tool_names || '[]')
            return (
              <div key={preset.id} className="flex items-center gap-2 px-3 py-2 text-xs border border-border rounded-lg">
                <span className="font-medium flex-1">{preset.name}</span>
                <span className="text-muted">{toolNames.length} tools</span>
                {preset.is_builtin === 1 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted">{t('settings.template.builtin')}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </SettingsPane>
  )
}
