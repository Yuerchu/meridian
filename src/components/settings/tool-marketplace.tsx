import './tool-marketplace.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, ChevronRight, Plus, Terminal, Wrench } from '@keyline-icons/react/two-tone'
import { Button as AriaButton, Disclosure, DisclosureGroup, DisclosurePanel, Heading } from 'react-aria-components'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import type {
  CustomToolExecution,
  CustomToolInfoResponse,
  McpToolInfoResponse,
  ToolPermission,
  ToolPresetInfoResponse,
} from '@/types'
import { parseCustomToolExecution } from '@/lib/custom-tool-execution'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsDrilldown } from './settings-drilldown'
import { useSettingsDirtyRegistration } from './dirty-guard'
import { titleIfTruncated } from '@/lib/truncation'

export function CustomToolEditor({
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
  const [executionText, setExecutionText] = useState(tool?.execution ? JSON.stringify(tool.execution, null, 2) : '')
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(tool?.parameters_schema ?? { type: 'object', properties: {} }, null, 2),
  )
  const [workingDirectory, setWorkingDirectory] = useState(tool?.working_directory ?? '')
  const [permission, setPermission] = useState<ToolPermission>(tool?.permission ?? 'ask')
  const [timeoutMs, setTimeoutMs] = useState(tool ? (tool.timeout_ms?.toString() ?? '') : '30000')
  const [saved, markSaved] = useTemporaryFlag()
  const [savedDraft, setSavedDraft] = useState(() =>
    JSON.stringify({
      name: tool?.name ?? '',
      description: tool?.description ?? '',
      command: tool?.command ?? '',
      argsTemplate: tool?.args_template ?? '',
      executionText: tool?.execution ? JSON.stringify(tool.execution, null, 2) : '',
      schemaText: JSON.stringify(tool?.parameters_schema ?? { type: 'object', properties: {} }, null, 2),
      workingDirectory: tool?.working_directory ?? '',
      permission: tool?.permission ?? 'ask',
      timeoutMs: tool ? (tool.timeout_ms?.toString() ?? '') : '30000',
    }),
  )
  const [invalid, setInvalid] = useState<Set<'name' | 'description' | 'command' | 'timeout'>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLInputElement>(null)
  const commandRef = useRef<HTMLTextAreaElement>(null)
  const timeoutRef = useRef<HTMLInputElement>(null)
  const draft = JSON.stringify({
    name,
    description,
    command,
    argsTemplate,
    executionText,
    schemaText,
    workingDirectory,
    permission,
    timeoutMs,
  })
  useSettingsDirtyRegistration('tools', tool ? `custom-tool-${tool.id}` : 'custom-tool-new', draft !== savedDraft)

  async function handleSave() {
    const nextInvalid = new Set<'name' | 'description' | 'command' | 'timeout'>()
    if (!name.trim()) nextInvalid.add('name')
    if (!description.trim()) nextInvalid.add('description')
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
      const execution: CustomToolExecution | null = executionText.trim()
        ? parseCustomToolExecution(JSON.parse(executionText))
        : null
      if (!tool && !execution) throw new Error(t('settings.tools.executionRequired'))
      const rawSchema: unknown = JSON.parse(schemaText)
      if (typeof rawSchema !== 'object' || rawSchema === null || Array.isArray(rawSchema)) {
        throw new Error(t('settings.tools.invalidSchema'))
      }
      const parametersSchema = Object.fromEntries(Object.entries(rawSchema))
      const timeout = timeoutMs.trim() ? Number(timeoutMs) : null
      if (timeout !== null && (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647)) {
        throw new Error(t('settings.tools.invalidTimeout'))
      }
      if (tool) {
        await api.tools.updateCustom({
          id: tool.id,
          name: name.trim(),
          description: description.trim(),
          command,
          args_template: argsTemplate === '' && tool.args_template === null ? null : argsTemplate,
          execution,
          is_enabled: execution === null ? false : tool.execution === null ? true : tool.is_enabled,
          parameters_schema: parametersSchema,
          working_directory: workingDirectory || null,
          permission,
          timeout_ms: timeout,
        })
      } else {
        await api.tools.createCustom({
          name: name.trim(),
          description: description.trim(),
          command,
          category_id: null,
          parameters_schema: parametersSchema,
          args_template: null,
          execution,
          working_directory: workingDirectory || null,
          permission,
          timeout_ms: timeout,
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
      {tool?.execution === null && <Alert tone="warning">{t('settings.tools.legacyWarning')}</Alert>}
      <SettingsGroup>
        <SettingsRow label={t('settings.tools.name')} layout="stacked">
          <TextField
            isInvalid={invalid.has('name')}
            ref={nameRef}
            name="customToolName"
            value={name}
            onChange={setName}
            placeholder="my_tool"
          />
        </SettingsRow>
        <SettingsRow label={t('settings.tools.permission')}>
          <div className="m-tools__select">
            <SettingsSelect
              ariaLabel={t('settings.tools.permission')}
              value={permission}
              options={permissionOptions}
              onChange={setPermission}
            />
          </div>
        </SettingsRow>
        <SettingsRow label={t('settings.tools.description')} layout="stacked">
          <TextField
            isInvalid={invalid.has('description')}
            ref={descriptionRef}
            name="customToolDescription"
            value={description}
            onChange={setDescription}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.tools.execution')}
          description={t('settings.tools.executionHint')}
          layout="stacked"
        >
          <TextArea
            name="customToolExecution"
            value={executionText}
            onChange={setExecutionText}
            rows={8}
            placeholder={
              '{"kind":"executable","program":"python","args":[{"kind":"literal","value":"script.py"},{"kind":"parameter","name":"input"}]}'
            }
            className="m-tools__mono-input"
          />
        </SettingsRow>
        <SettingsRow label={t('settings.tools.parametersSchema')} layout="stacked">
          <TextArea
            name="customToolSchema"
            rows={4}
            value={schemaText}
            onChange={setSchemaText}
            className="m-tools__mono-input"
          />
        </SettingsRow>
        <SettingsRow label={t('settings.tools.workingDirectory')} layout="stacked">
          <TextField name="customToolWorkingDirectory" value={workingDirectory} onChange={setWorkingDirectory} />
        </SettingsRow>
        {tool && (
          <SettingsRow label={t('settings.tools.command')} layout="stacked">
            <TextArea
              isInvalid={invalid.has('command')}
              ref={commandRef}
              name="customToolCommand"
              rows={3}
              value={command}
              onChange={setCommand}
              className="m-tools__mono-input"
            />
          </SettingsRow>
        )}
        {tool && (
          <SettingsRow
            label={t('settings.tools.argsTemplate')}
            description={t('settings.tools.argsTemplateHint')}
            layout="stacked"
          >
            <TextArea
              name="customToolArgs"
              rows={3}
              value={argsTemplate}
              onChange={setArgsTemplate}
              className="m-tools__mono-input"
            />
          </SettingsRow>
        )}
        <SettingsRow label={t('settings.tools.timeout')}>
          <div className="m-tools__compact-field">
            <NumberField
              isInvalid={invalid.has('timeout')}
              value={draftToNumber(timeoutMs)}
              onChange={(value) => setTimeoutMs(numberToDraft(value))}
              ref={timeoutRef}
              name="customToolTimeout"
              minValue={1}
              formatOptions={PLAIN_INTEGER}
            />
          </div>
        </SettingsRow>
      </SettingsGroup>
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
        api.mcp.listAllTools(),
        api.tools.listCustom(),
        api.tools.listCategories(),
        api.tools.listPresets(),
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
        <SettingsGroup>
          <div data-slot="builtin-tool-list" className="m-tools__list">
            {builtinTools
              .filter((t) => t.source === 'builtin')
              .map((tool) => (
                <div key={tool.name} data-slot="builtin-tool-row" className="m-tools__line">
                  <Wrench size={14} aria-hidden />
                  <span data-slot="builtin-tool-name" className="m-tools__mono">
                    {tool.name}
                  </span>
                  <span
                    data-slot="builtin-tool-description"
                    onPointerEnter={titleIfTruncated}
                    className="m-tools__desc"
                  >
                    {tool.description}
                  </span>
                </div>
              ))}
          </div>
        </SettingsGroup>
      </SettingsDrilldown>

      {builtinTools.some((tool) => tool.source === 'onebot') && (
        <SettingsDrilldown
          title={t('settings.tools.onebotSection')}
          summary={builtinTools.filter((tool) => tool.source === 'onebot').length}
        >
          <SettingsGroup description={t('settings.tools.onebotHint')}>
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
          </SettingsGroup>
        </SettingsDrilldown>
      )}

      <div data-slot="custom-tools" className="m-tools__section">
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
        <SettingsGroup>
          <DisclosureGroup
            className="m-tools__folds"
            expandedKeys={expandedToolId ? [expandedToolId] : []}
            onExpandedChange={(keys) => setExpandedToolId(([...keys][0] as string | undefined) ?? null)}
          >
            {customTools.map((ct) => {
              const isExpanded = expandedToolId === ct.id
              return (
                <Disclosure key={ct.id} id={ct.id} className="m-tools__fold">
                  <Heading className="m-tools__fold-heading">
                    <AriaButton slot="trigger" className="m-tools__trigger">
                      <Terminal size={14} aria-hidden />
                      <span data-slot="custom-tool-name" onPointerEnter={titleIfTruncated} className="m-tools__mono">
                        {ct.name}
                      </span>
                      <span data-slot="custom-tool-command" onPointerEnter={titleIfTruncated} className="m-tools__desc">
                        {ct.execution?.kind === 'executable'
                          ? ct.execution.program
                          : ct.execution?.kind === 'script'
                            ? t('settings.tools.fixedScript')
                            : ct.command}
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
                            await api.tools.deleteCustom({ id: ct.id })
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
        </SettingsGroup>
      </div>

      <div data-slot="tool-presets">
        <SettingsGroup heading={t('settings.tools.presetsSection')} headingLevel={3}>
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
        </SettingsGroup>
      </div>
      {confirmDialog}
    </SettingsPane>
  )
}
