import './tool-marketplace.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, ChevronRight, Plus, Terminal, Wrench } from '@keyline-icons/react/two-tone'
import { Button as AriaButton, Disclosure, DisclosureGroup, DisclosurePanel, Heading } from 'react-aria-components'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import type { CustomToolInfoResponse, McpToolInfoResponse, ToolPermission, ToolPresetInfoResponse } from '@/types'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { SettingsDrilldown } from './settings-drilldown'
import { useSettingsDirtyRegistration } from './dirty-guard'
import { titleIfTruncated } from '@/lib/truncation'

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
      className="m-tools__editor"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <div data-slot="custom-tool-fields" className="m-tools__grid">
        <TextField
          isInvalid={invalid.has('name')}
          label={t('settings.tools.name')}
          ref={nameRef}
          name="customToolName"
          value={name}
          onChange={setName}
          placeholder="my_tool"
        />
        <SettingsSelect
          label={t('settings.tools.permission')}
          value={permission}
          options={permissionOptions}
          onChange={setPermission}
        />
      </div>
      <TextField
        isInvalid={invalid.has('description')}
        label={t('settings.tools.description')}
        ref={descriptionRef}
        name="customToolDescription"
        value={description}
        onChange={setDescription}
      />
      <TextField
        isInvalid={invalid.has('command')}
        label={t('settings.tools.command')}
        ref={commandRef}
        name="customToolCommand"
        value={command}
        onChange={setCommand}
        placeholder="python script.py"
      />
      <TextField
        label={t('settings.tools.argsTemplate')}
        name="customToolArgs"
        value={argsTemplate}
        onChange={setArgsTemplate}
        placeholder="--input {{input}} --output {{output}}"
        description={t('settings.tools.argsTemplateHint')}
      />
      <NumberField
        isInvalid={invalid.has('timeout')}
        label={t('settings.tools.timeout')}
        value={draftToNumber(timeoutMs)}
        onChange={(value) => setTimeoutMs(numberToDraft(value))}
        ref={timeoutRef}
        name="customToolTimeout"
        minValue={1}
        formatOptions={PLAIN_INTEGER}
      />
      {invalid.size > 0 && (
        <Alert data-slot="custom-tool-validation" tone="danger" shouldAnnounce>
          {invalid.has('timeout') ? t('settings.tools.invalidTimeout') : t('settings.tools.requiredFields')}
        </Alert>
      )}
      {saveError && (
        <Alert data-slot="custom-tool-save-error" tone="danger" shouldAnnounce>
          {saveError}
        </Alert>
      )}
      <div data-slot="custom-tool-actions" className="m-tools__actions">
        <Button type="submit">{t('common.save')}</Button>
        {saved && <SavedHint />}
        {onDelete && (
          <TooltipTrigger>
            <Button
              type="button"
              icon={<Bin />}
              size="sm"
              variant="ghost"
              aria-label={t('settings.tools.delete')}
              className="m-tools__aside"
              onPress={onDelete}
            />
            <Tooltip>{t('settings.tools.delete')}</Tooltip>
          </TooltipTrigger>
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
        <Alert
          tone="danger"
          shouldAnnounce
          actions={
            <Button size="sm" variant="secondary" onPress={() => void refresh()}>
              {t('settings.tools.retry')}
            </Button>
          }
        >
          {t('settings.tools.loadError')}
        </Alert>
      )}

      <SettingsDrilldown
        title={t('settings.tools.builtinSection')}
        summary={builtinTools.filter((tool) => tool.source === 'builtin').length}
      >
        <div data-slot="builtin-tool-list" className="m-tools__list">
          {builtinTools
            .filter((t) => t.source === 'builtin')
            .map((tool) => (
              <div key={tool.name} data-slot="builtin-tool-row" className="m-tools__line">
                <Wrench size={14} aria-hidden />
                <span data-slot="builtin-tool-name" className="m-tools__mono">
                  {tool.name}
                </span>
                <span data-slot="builtin-tool-description" onPointerEnter={titleIfTruncated} className="m-tools__desc">
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
          <p data-slot="onebot-tool-hint" className="m-tools__hint">
            {t('settings.tools.onebotHint')}
          </p>
          <div data-slot="onebot-tool-list" className="m-tools__list">
            {builtinTools
              .filter((tool) => tool.source === 'onebot')
              .map((tool) => (
                <div key={tool.name} data-slot="onebot-tool-row" className="m-tools__line">
                  <Wrench size={14} aria-hidden />
                  <span data-slot="onebot-tool-name" className="m-tools__mono">
                    {tool.name}
                  </span>
                  <span data-slot="onebot-tool-description" className="m-tools__desc">
                    {t(`settings.tools.qq.${tool.name}`)}
                  </span>
                  {tool.scope === 'group' && <Badge>{t('settings.tools.qqGroupOnly')}</Badge>}
                  {tool.scope === 'private' && <Badge>{t('settings.tools.qqPrivateOnly')}</Badge>}
                  {tool.admin_only === true && <Badge>{t('settings.tools.qqAdminOnly')}</Badge>}
                  {tool.needs_approval === true && <Badge>{t('settings.tools.qqApproval')}</Badge>}
                </div>
              ))}
          </div>
        </SettingsDrilldown>
      )}

      <div data-slot="custom-tools">
        <div data-slot="custom-tools-header" className="m-tools__header">
          <h3 data-slot="custom-tools-title" className="m-tools__title">
            {t('settings.tools.customSection')}
          </h3>
          <Button icon={<Plus />} variant="secondary" onPress={() => setShowCreate(!showCreate)}>
            {t('settings.tools.new')}
          </Button>
        </div>

        {showCreate && (
          <div className="m-tools__create">
            <CustomToolEditor
              onSave={() => {
                setShowCreate(false)
                refresh()
              }}
            />
          </div>
        )}

        {/* One open at a time is the group's own default
            (`allowsMultipleExpanded` is off), so the single-open rule lives in
            the primitive rather than in the click handler. */}
        <DisclosureGroup
          className="m-tools__folds"
          expandedKeys={expandedToolId ? [expandedToolId] : []}
          onExpandedChange={(keys) => setExpandedToolId(([...keys][0] as string | undefined) ?? null)}
        >
          {customTools.map((ct) => {
            const isExpanded = expandedToolId === ct.id
            return (
              <Disclosure key={ct.id} id={ct.id} className="m-tools__fold">
                <Heading>
                  <AriaButton slot="trigger" className="m-tools__trigger">
                    <Terminal size={14} aria-hidden />
                    <span data-slot="custom-tool-name" onPointerEnter={titleIfTruncated} className="m-tools__mono">
                      {ct.name}
                    </span>
                    <span data-slot="custom-tool-command" onPointerEnter={titleIfTruncated} className="m-tools__desc">
                      {ct.command}
                    </span>
                    {!ct.is_enabled && <Badge>{t('settings.tools.disabled')}</Badge>}
                    <ChevronRight size={14} aria-hidden className="m-tools__chevron" />
                  </AriaButton>
                </Heading>
                <DisclosurePanel className="m-tools__panel">
                  <div className="m-tools__body">
                    {/* A collapsed panel is only hidden, not unmounted, so the
                        editor is still gated on the open row. */}
                    {isExpanded && (
                      <CustomToolEditor
                        tool={ct}
                        onSave={refresh}
                        onDelete={async () => {
                          if (
                            !(await confirm({
                              description: t('settings.confirmDelete.customTool'),
                              confirmLabel: t('common.delete'),
                              tone: 'danger',
                            }))
                          )
                            return
                          await api.deleteCustomTool(ct.id)
                          setExpandedToolId(null)
                          refresh()
                        }}
                      />
                    )}
                  </div>
                </DisclosurePanel>
              </Disclosure>
            )
          })}
          {customTools.length === 0 && !showCreate && (
            <EmptyState heading={t('settings.tools.noCustom')} headingLevel={3} size="sm" />
          )}
        </DisclosureGroup>
      </div>

      <div data-slot="tool-presets">
        <h3 data-slot="tool-presets-title" className="m-tools__title">
          {t('settings.tools.presetsSection')}
        </h3>
        <div data-slot="tool-preset-list" className="m-tools__list">
          {presets.map((preset) => {
            const toolNames = preset.tool_names
            return (
              <div key={preset.id} data-slot="tool-preset-row" className="m-tools__line">
                <span data-slot="tool-preset-name" className="m-tools__preset-name">
                  {preset.name}
                </span>
                <span data-slot="tool-preset-count" className="m-tools__hint">
                  {t('settings.tools.presetCount', { count: toolNames.length })}
                </span>
                {preset.is_builtin && <Badge>{t('settings.template.builtin')}</Badge>}
              </div>
            )
          })}
        </div>
      </div>
      {confirmDialog}
    </SettingsPane>
  )
}
