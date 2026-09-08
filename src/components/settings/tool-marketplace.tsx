import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, TrashBin, Wrench, Terminal } from '@gravity-ui/icons'
import {
  Alert,
  Button,
  Card,
  Chip,
  Description,
  Disclosure,
  DisclosureGroup,
  Input,
  Label,
  TextField,
  Tooltip,
} from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import type { CustomToolInfoResponse, McpToolInfoResponse, ToolPermission, ToolPresetInfoResponse } from '@/types'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { SettingsDrilldown } from './settings-drilldown'
import { useSettingsDirtyRegistration } from './dirty-guard'

function CustomToolEditor({
  tool,
  onSave,
  onDelete,
}: {
  tool?: CustomToolInfoResponse
  onSave: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(tool?.name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [command, setCommand] = useState(tool?.command ?? '')
  const [argsTemplate, setArgsTemplate] = useState(tool?.args_template ?? '')
  const [permission, setPermission] = useState<ToolPermission>(tool?.permission ?? 'ask')
  const [timeoutMs, setTimeoutMs] = useState(tool?.timeout_ms?.toString() ?? '30000')
  const [saved, markSaved] = useTemporaryFlag()
  const [savedDraft, setSavedDraft] = useState(() =>
    JSON.stringify({
      name: tool?.name ?? '',
      description: tool?.description ?? '',
      command: tool?.command ?? '',
      argsTemplate: tool?.args_template ?? '',
      permission: tool?.permission ?? 'ask',
      timeoutMs: tool?.timeout_ms?.toString() ?? '30000',
    }),
  )
  const [invalid, setInvalid] = useState<Set<'name' | 'description' | 'command' | 'timeout'>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLInputElement>(null)
  const commandRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<HTMLInputElement>(null)
  const draft = JSON.stringify({ name, description, command, argsTemplate, permission, timeoutMs })
  useSettingsDirtyRegistration('tools', tool ? `custom-tool-${tool.id}` : 'custom-tool-new', draft !== savedDraft)

  async function handleSave() {
    const nextInvalid = new Set<'name' | 'description' | 'command' | 'timeout'>()
    if (!name.trim()) nextInvalid.add('name')
    if (!description.trim()) nextInvalid.add('description')
    if (!command.trim()) nextInvalid.add('command')
    if (timeoutMs.trim() && (!Number.isInteger(Number(timeoutMs)) || Number(timeoutMs) <= 0)) {
      nextInvalid.add('timeout')
    }
    setInvalid(nextInvalid)
    if (nextInvalid.size > 0) {
      const first = [...nextInvalid][0]
      ;({ name: nameRef, description: descriptionRef, command: commandRef, timeout: timeoutRef })[
        first
      ].current?.focus()
      return
    }

    setSaveError(null)
    try {
      if (tool) {
        await api.updateCustomTool({
          id: tool.id,
          name: name.trim(),
          description: description.trim(),
          command: command.trim(),
          argsTemplate: argsTemplate.trim() || null,
          permission,
          timeoutMs: timeoutMs ? Number(timeoutMs) : null,
        })
      } else {
        await api.createCustomTool({
          name: name.trim(),
          description: description.trim(),
          command: command.trim(),
          categoryId: null,
          parametersSchema: null,
          argsTemplate: argsTemplate.trim() || null,
          workingDirectory: null,
          permission,
          timeoutMs: timeoutMs ? Number(timeoutMs) : null,
        })
      }
      setSavedDraft(draft)
      markSaved()
      onSave()
    } catch (reason) {
      setSaveError(String(reason))
    }
  }

  const permissionOptions: { value: ToolPermission; label: string }[] = [
    { value: 'always', label: t('settings.tools.permAlways') },
    { value: 'ask', label: t('settings.tools.permAsk') },
    { value: 'never', label: t('settings.tools.permNever') },
  ]

  // No chrome of its own: the caller decides whether this is a card floating on
  // the page or the body of an already-bounded disclosure row.
  return (
    <form
      data-slot="custom-tool-editor"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <div data-slot="custom-tool-fields" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
        <TextField fullWidth isInvalid={invalid.has('name')}>
          <Label>{t('settings.tools.name')}</Label>
          <Input
            ref={nameRef}
            name="customToolName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_tool"
            className="font-mono text-xs"
          />
        </TextField>
        <SettingsSelect
          label={t('settings.tools.permission')}
          value={permission}
          options={permissionOptions}
          onChange={setPermission}
        />
      </div>
      <TextField fullWidth isInvalid={invalid.has('description')}>
        <Label>{t('settings.tools.description')}</Label>
        <Input
          ref={descriptionRef}
          name="customToolDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </TextField>
      <TextField fullWidth isInvalid={invalid.has('command')}>
        <Label>{t('settings.tools.command')}</Label>
        <Input
          ref={commandRef}
          name="customToolCommand"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="python script.py"
          className="font-mono text-xs"
        />
      </TextField>
      <TextField fullWidth>
        <Label>{t('settings.tools.argsTemplate')}</Label>
        <Input
          name="customToolArgs"
          value={argsTemplate}
          onChange={(e) => setArgsTemplate(e.target.value)}
          placeholder="--input {{input}} --output {{output}}"
          className="font-mono text-xs"
        />
        <Description>{t('settings.tools.argsTemplateHint')}</Description>
      </TextField>
      <TextField type="number" isInvalid={invalid.has('timeout')}>
        <Label>{t('settings.tools.timeout')}</Label>
        <Input
          ref={timeoutRef}
          name="customToolTimeout"
          inputMode="numeric"
          min={1}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          className="w-32"
        />
      </TextField>
      {invalid.size > 0 && (
        <p data-slot="custom-tool-validation" role="alert" className="text-xs text-danger">
          {invalid.has('timeout') ? t('settings.tools.invalidTimeout') : t('settings.tools.requiredFields')}
        </p>
      )}
      {saveError && (
        <p data-slot="custom-tool-save-error" role="alert" className="text-xs text-danger break-all">
          {saveError}
        </p>
      )}
      <div data-slot="custom-tool-actions" className="flex items-center gap-2">
        <Button type="submit">{t('common.save')}</Button>
        {saved && <SavedHint />}
        {onDelete && (
          <Tooltip delay={0}>
            <Button
              type="button"
              isIconOnly
              variant="danger-soft"
              aria-label={t('settings.tools.delete')}
              className="ml-auto"
              onPress={onDelete}
            >
              <TrashBin className="w-3.5 h-3.5" />
            </Button>
            <Tooltip.Content>{t('settings.tools.delete')}</Tooltip.Content>
          </Tooltip>
        )}
      </div>
    </form>
  )
}

export function ToolMarketplace() {
  const { t } = useTranslation()
  const [builtinTools, setBuiltinTools] = useState<McpToolInfoResponse[]>([])
  const [customTools, setCustomTools] = useState<CustomToolInfoResponse[]>([])
  const [presets, setPresets] = useState<ToolPresetInfoResponse[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
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
    } catch (reason) {
      setLoadError(String(reason))
    }
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  if (loading) {
    return <SettingsSkeleton />
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.tools.title')} subtitle={t('settings.tools.subtitle')} />

      {loadError && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{t('settings.tools.loadError')}</Alert.Description>
            <Button size="sm" variant="outline" onPress={() => void refresh()}>
              {t('settings.tools.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      )}

      <SettingsDrilldown
        title={t('settings.tools.builtinSection')}
        summary={builtinTools.filter((tool) => tool.source === 'builtin').length}
      >
        <div data-slot="builtin-tool-list" className="grid grid-cols-1 gap-1">
          {builtinTools
            .filter((t) => t.source === 'builtin')
            .map((tool) => (
              <div
                key={tool.name}
                data-slot="builtin-tool-row"
                className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg"
              >
                <Wrench className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                <span data-slot="builtin-tool-name" className="font-mono flex-1">
                  {tool.name}
                </span>
                <span data-slot="builtin-tool-description" className="text-muted truncate max-w-48">
                  {tool.description}
                </span>
              </div>
            ))}
        </div>
      </SettingsDrilldown>

      {builtinTools.some((tool) => tool.source === 'onebot') && (
        <SettingsDrilldown
          title={t('settings.tools.onebotSection')}
          summary={builtinTools.filter((tool) => tool.source === 'onebot').length}
        >
          <p data-slot="onebot-tool-hint" className="text-xs text-muted">
            {t('settings.tools.onebotHint')}
          </p>
          <div data-slot="onebot-tool-list" className="grid grid-cols-1 gap-1">
            {builtinTools
              .filter((tool) => tool.source === 'onebot')
              .map((tool) => (
                <div
                  key={tool.name}
                  data-slot="onebot-tool-row"
                  className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg"
                >
                  <Wrench className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                  <span data-slot="onebot-tool-name" className="font-mono flex-1">
                    {tool.name}
                  </span>
                  <span data-slot="onebot-tool-description" className="text-muted truncate max-w-40">
                    {t(`settings.tools.qq.${tool.name}`)}
                  </span>
                  {tool.scope === 'group' && <Chip className="text-muted">{t('settings.tools.qqGroupOnly')}</Chip>}
                  {tool.scope === 'private' && <Chip className="text-muted">{t('settings.tools.qqPrivateOnly')}</Chip>}
                  {tool.admin_only === true && <Chip className="text-muted">{t('settings.tools.qqAdminOnly')}</Chip>}
                  {tool.needs_approval === true && <Chip className="text-muted">{t('settings.tools.qqApproval')}</Chip>}
                </div>
              ))}
          </div>
        </SettingsDrilldown>
      )}

      <div data-slot="custom-tools">
        <div data-slot="custom-tools-header" className="flex items-center justify-between mb-2">
          <h3 data-slot="custom-tools-title" className="text-sm font-medium">
            {t('settings.tools.customSection')}
          </h3>
          <Button variant="outline" onPress={() => setShowCreate(!showCreate)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.tools.new')}
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-3">
            <CustomToolEditor
              onSave={() => {
                setShowCreate(false)
                refresh()
              }}
            />
          </Card>
        )}

        {/* One open at a time is the group's own default
            (`allowsMultipleExpanded` is off), so the single-open rule lives in
            the primitive rather than in the click handler. */}
        <DisclosureGroup
          className="flex flex-col gap-1"
          expandedKeys={expandedToolId ? [expandedToolId] : []}
          onExpandedChange={(keys) => setExpandedToolId(([...keys][0] as string | undefined) ?? null)}
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
                    <span data-slot="custom-tool-name" className="font-mono min-w-0 flex-1 truncate">
                      {ct.name}
                    </span>
                    <span data-slot="custom-tool-command" className="text-muted truncate">
                      {ct.command}
                    </span>
                    {!ct.is_enabled && <Chip className="shrink-0 text-muted">{t('settings.tools.disabled')}</Chip>}
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
                          if (!(await confirm({ body: t('settings.confirmDelete.customTool') }))) return
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
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>{t('settings.tools.noCustom')}</EmptyState.Title>
              </EmptyState.Header>
            </EmptyState>
          )}
        </DisclosureGroup>
      </div>

      <div data-slot="tool-presets">
        <h3 data-slot="tool-presets-title" className="text-sm font-medium mb-2">
          {t('settings.tools.presetsSection')}
        </h3>
        <div data-slot="tool-preset-list" className="space-y-1">
          {presets.map((preset) => {
            const toolNames = preset.tool_names
            return (
              <div
                key={preset.id}
                data-slot="tool-preset-row"
                className="flex items-center gap-2 px-3 py-2 text-xs border border-border rounded-lg"
              >
                <span data-slot="tool-preset-name" className="font-medium flex-1">
                  {preset.name}
                </span>
                <span data-slot="tool-preset-count" className="text-muted">
                  {t('settings.tools.presetCount', { count: toolNames.length })}
                </span>
                {preset.is_builtin && <Chip className="text-muted">{t('settings.template.builtin')}</Chip>}
              </div>
            )
          })}
        </div>
      </div>
      {confirmDialog}
    </SettingsPane>
  )
}
