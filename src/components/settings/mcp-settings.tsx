import { useEffect, useId, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, PlugWire, PlugConnection, LogoMcp, TrashBin, ArrowDownToSquare } from '@gravity-ui/icons'
import { Alert, Button, Input, Label, Switch, TextArea, TextField, Tooltip, TooltipTrigger } from '@/components/base'
import { EmptyState } from '@/components/base'
import { ListView } from '@/components/base'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import {
  parseJsonText,
  parseStringArrayText,
  parseStringRecordText,
  requireExactKeys,
  requireKnownKeys,
  requireRecord,
} from '@/lib/strict-json'
import { cx } from '@/utils/cx'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import type { McpServerInfoResponse, McpServerToolInfoResponse, McpTransport } from '@/types'
import { MasterDetail } from './master-detail'
import { SettingsSkeleton } from './primitives'
import { useMasterDetail } from './use-master-detail'
import { useSettingsDirtyRegistration } from './dirty-guard'

interface McpServersJson {
  mcpServers: Record<
    string,
    {
      type?: McpTransport
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    }
  >
}

function parseImportJson(raw: string): McpServersJson | null {
  try {
    const root = requireExactKeys(parseJsonText(raw, 'MCP import'), ['mcpServers'], 'MCP import')
    const entries = requireRecord(root.mcpServers, 'MCP import.mcpServers')
    const mcpServers: McpServersJson['mcpServers'] = {}
    for (const [name, rawEntry] of Object.entries(entries)) {
      const entry = requireKnownKeys(
        rawEntry,
        ['type', 'command', 'args', 'env', 'url', 'headers'],
        `MCP server ${name}`,
      )
      const type = entry.type
      if (type !== undefined && type !== 'stdio' && type !== 'streamablehttp') {
        throw new Error(`MCP server ${name}.type is unknown`)
      }
      for (const key of ['command', 'url'] as const) {
        if (entry[key] !== undefined && typeof entry[key] !== 'string') {
          throw new Error(`MCP server ${name}.${key} must be a string`)
        }
      }
      if (
        entry.args !== undefined &&
        (!Array.isArray(entry.args) || entry.args.some((value) => typeof value !== 'string'))
      ) {
        throw new Error(`MCP server ${name}.args must be a string array`)
      }
      const readStringRecord = (field: 'env' | 'headers') => {
        if (entry[field] === undefined) return undefined
        const value = requireRecord(entry[field], `MCP server ${name}.${field}`)
        if (Object.values(value).some((item) => typeof item !== 'string')) {
          throw new Error(`MCP server ${name}.${field} must contain only string values`)
        }
        return value as Record<string, string>
      }
      mcpServers[name] = {
        type,
        command: entry.command as string | undefined,
        args: entry.args as string[] | undefined,
        env: readStringRecord('env'),
        url: entry.url as string | undefined,
        headers: readStringRecord('headers'),
      }
    }
    return { mcpServers }
  } catch {
    return null
  }
}

function JsonImportDialog({ onImport, onCancel }: { onImport: (data: McpServersJson) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState(false)
  const errorId = useId()

  const handleSubmit = () => {
    const data = parseImportJson(text)
    if (data) {
      onImport(data)
    } else {
      setError(true)
    }
  }

  return (
    <div data-slot="mcp-import-form" className="space-y-3">
      <TextField isInvalid={error}>
        <Label>{t('settings.mcp.importJson')}</Label>
        <TextArea
          name="mcpImportJson"
          aria-describedby={error ? errorId : undefined}
          className="h-40 font-mono resize-none"
          placeholder={t('settings.mcp.importJsonPlaceholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(false)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />
      </TextField>
      {error && (
        <p id={errorId} data-slot="mcp-import-error" role="alert" className="text-body-regular text-status-danger">
          {t('settings.mcp.importJsonError')}
        </p>
      )}
      <div data-slot="mcp-import-actions" className="flex gap-2">
        <Button onPress={handleSubmit}>{t('settings.mcp.importJsonSubmit')}</Button>
        <Button variant="outline" onPress={onCancel}>
          {t('settings.mcp.importJsonCancel')}
        </Button>
      </div>
    </div>
  )
}

function McpServerEditor({
  server,
  onUpdate,
  onDelete,
  onDirtyChange,
}: {
  server: McpServerInfoResponse
  onUpdate: () => void
  onDelete: (id: string) => void
  onDirtyChange?: (id: string, dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(server.name)
  const [transportType, setTransportType] = useState(server.transport_type)
  const [command, setCommand] = useState(server.command ?? '')
  const [args, setArgs] = useState(() => JSON.stringify(server.args ?? [], null, 2))
  const [env, setEnv] = useState(() => JSON.stringify(server.env ?? {}, null, 2))
  const [url, setUrl] = useState(server.url ?? '')
  const [headers, setHeaders] = useState(() => JSON.stringify(server.headers ?? {}, null, 2))
  const [saved, markSaved] = useTemporaryFlag(1500)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  /** Whether this one comes up on its own at launch — `is_enabled` in the row. */
  const [autoConnect, setAutoConnect] = useState(server.is_enabled)
  const [tools, setTools] = useState<McpServerToolInfoResponse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [savedDraft, setSavedDraft] = useState(() =>
    JSON.stringify({
      name: server.name,
      transportType: server.transport_type,
      command: server.command ?? '',
      args: JSON.stringify(server.args ?? [], null, 2),
      env: JSON.stringify(server.env ?? {}, null, 2),
      url: server.url ?? '',
      headers: JSON.stringify(server.headers ?? {}, null, 2),
    }),
  )
  const draft = JSON.stringify({ name, transportType, command, args, env, url, headers })
  const dirty = draft !== savedDraft

  useEffect(() => onDirtyChange?.(server.id, dirty), [dirty, onDirtyChange, server.id])
  useEffect(() => () => onDirtyChange?.(server.id, false), [onDirtyChange, server.id])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setStatusLoading(true)
    // Asked, not inferred. Reading this off the tool list showed a server that
    // connects and exposes nothing as disconnected, while its process was
    // running quite happily.
    Promise.all([api.listMcpTools(server.id), api.listMcpConnectionStatuses()])
      .then(([t, statuses]) => {
        if (cancelled) return
        setTools(t)
        setConnected(statuses.some((s) => s.server_id === server.id && s.state === 'connected'))
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [server.id])

  const handleSave = useCallback(async () => {
    const request: Parameters<typeof api.updateMcpServer>[0] = {
      id: server.id,
      name,
      transportType,
    }
    try {
      if (transportType === 'stdio') {
        request.command = command || null
        request.args = parseStringArrayText(args, 'args')
        request.env = parseStringRecordText(env, 'env')
        request.url = null
        request.headers = null
      } else {
        request.url = url || null
        request.headers = parseStringRecordText(headers, 'headers')
        request.command = null
        request.args = null
        request.env = null
      }
      setError(null)
      await api.updateMcpServer(request)
      setSavedDraft(draft)
      markSaved()
      onUpdate()
    } catch (reason) {
      setError(String(reason))
    }
  }, [server.id, name, transportType, command, args, env, url, headers, draft, onUpdate, markSaved])

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      await api.connectMcpServer(server.id)
      const t = await api.listMcpTools(server.id)
      setTools(t)
      setConnected(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setConnecting(false)
    }
  }, [server.id])

  const handleDisconnect = useCallback(async () => {
    await api.disconnectMcpServer(server.id)
    setTools([])
    setConnected(false)
  }, [server.id])

  const handleToggleAutoConnect = useCallback(
    async (next: boolean) => {
      const previous = autoConnect
      setAutoConnect(next)
      try {
        await api.updateMcpServer({ id: server.id, isEnabled: next })
        onUpdate()
      } catch (e) {
        // Rolled back rather than kept locally: a switch that says a server will
        // come back on its own, when nothing recorded that, is worse than an
        // error — the user finds out at the next launch.
        setAutoConnect(previous)
        setError(String(e))
      }
    },
    [server.id, autoConnect, onUpdate],
  )

  const isHttp = transportType === 'streamablehttp'

  return (
    <div data-slot="mcp-server-editor" className="space-y-4">
      <TextField>
        <Label>{t('settings.mcp.name')}</Label>
        <Input name={`mcpName-${server.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      <div data-slot="mcp-transport">
        <p data-slot="mcp-transport-label" className="text-body-medium">
          {t('settings.mcp.transport')}
        </p>
        <div
          data-slot="mcp-transport-options"
          role="group"
          aria-label={t('settings.mcp.transport')}
          className="flex gap-2 mt-1"
        >
          <Button
            variant="ghost"
            aria-pressed={!isHttp}
            onPress={() => setTransportType('stdio')}
            className={cx(
              'px-3 py-1.5 rounded-md text-body-regular transition-colors',
              !isHttp
                ? 'bg-background-secondary-default text-text-primary hover:bg-background-primary-hover hover:text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-primary-hover/50',
            )}
          >
            {t('settings.mcp.transportStdio')}
          </Button>
          <Button
            variant="ghost"
            aria-pressed={isHttp}
            onPress={() => setTransportType('streamablehttp')}
            className={cx(
              'px-3 py-1.5 rounded-md text-body-regular transition-colors',
              isHttp
                ? 'bg-background-secondary-default text-text-primary hover:bg-background-primary-hover hover:text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-primary-hover/50',
            )}
          >
            {t('settings.mcp.transportHttp')}
          </Button>
        </div>
      </div>

      {isHttp ? (
        <>
          <TextField type="url">
            <Label>{t('settings.mcp.url')}</Label>
            <Input
              name={`mcpUrl-${server.id}`}
              inputMode="url"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </TextField>
          <TextField>
            <Label>{t('settings.mcp.headers')}</Label>
            <Input
              name={`mcpHeaders-${server.id}`}
              autoComplete="off"
              spellCheck={false}
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder='{"Authorization": "Bearer ..."}'
            />
          </TextField>
        </>
      ) : (
        <>
          <TextField>
            <Label>{t('settings.mcp.command')}</Label>
            <Input
              name={`mcpCommand-${server.id}`}
              spellCheck={false}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
            />
          </TextField>
          <TextField>
            <Label>{t('settings.mcp.args')}</Label>
            <Input
              name={`mcpArgs-${server.id}`}
              spellCheck={false}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]'
            />
          </TextField>
          <TextField>
            <Label>{t('settings.mcp.env')}</Label>
            <Input
              name={`mcpEnv-${server.id}`}
              autoComplete="off"
              spellCheck={false}
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder="{}"
            />
          </TextField>
        </>
      )}

      {/* Two different things, deliberately side by side: connecting is
          something you do now, auto-connect is something you mean for next
          time. Disconnecting does not turn the switch off. */}
      {/* Wraps: two labelled buttons and a labelled switch come to about 370px
          in English, against roughly 330px on a phone — and this panel is not
          desktop-only, so that is a width it really gets. The switch keeps its
          `ml-auto` and simply lands on the second line once there is one. */}
      <div data-slot="mcp-editor-actions" className="flex flex-wrap items-center gap-2">
        <Button onPress={handleSave}>{saved ? t('common.saved') : t('common.save')}</Button>
        {connected ? (
          <Button variant="outline" onPress={handleDisconnect}>
            <PlugConnection className="w-3.5 h-3.5 mr-1.5" />
            {t('settings.mcp.disconnect')}
          </Button>
        ) : (
          <Button
            variant="outline"
            onPress={handleConnect}
            isDisabled={statusLoading}
            isPending={connecting}
            aria-busy={connecting}
          >
            <PlugWire aria-hidden="true" className="w-3.5 h-3.5 mr-1.5" />
            {t('settings.mcp.connect')}
          </Button>
        )}
        <Switch className="ml-auto" isSelected={autoConnect} onChange={handleToggleAutoConnect}>
          {t('settings.mcp.autoConnect')}
        </Switch>
      </div>

      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="break-all">{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {tools.length > 0 && (
        <div data-slot="mcp-tools">
          <p data-slot="mcp-tools-label" className="text-body-medium">
            {t('settings.mcp.tools')} ({tools.length})
          </p>
          <div data-slot="mcp-tool-list" className="mt-1 space-y-1">
            {tools.map((tool) => (
              <div
                key={tool.qualified_name}
                data-slot="mcp-tool-row"
                className="flex items-center gap-2 px-2 py-1 rounded-lg bg-background-secondary-default/50 text-caption-1-regular"
              >
                <span data-slot="mcp-tool-name" className="font-mono">
                  {tool.name}
                </span>
                <span data-slot="mcp-tool-description" className="text-text-secondary truncate">
                  {tool.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div data-slot="mcp-danger-zone" className="pt-4 border-t border-border-button-default">
        <Button variant="danger-soft" onPress={() => onDelete(server.id)}>
          <TrashBin className="w-3.5 h-3.5 mr-1.5" />
          {t('settings.mcp.deleteServer')}
        </Button>
      </div>
    </div>
  )
}

export function McpSettings() {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [dirtyServerId, setDirtyServerId] = useState<string | null>(null)
  const requestLeave = useCallback(async () => {
    if (!dirtyServerId) return true
    return confirm({ body: t('settings.unsavedChanges'), status: 'warning' })
  }, [confirm, dirtyServerId, t])
  useSettingsDirtyRegistration('mcp', 'mcp-server-editor', dirtyServerId !== null)
  // Never auto-selects: unlike providers, an MCP server list is often empty on
  // first open, and there is nothing to fall back to.
  const nav = useMasterDetail<'import'>({ beforeLeave: requestLeave })
  const { selectedId, openItem, openAux, select, back } = nav
  const [servers, setServers] = useState<McpServerInfoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const showImport = nav.aux === 'import'

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      setServers(await api.listMcpServers())
    } catch (reason) {
      setLoadError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleAdd = useCallback(async () => {
    if (!(await requestLeave())) return
    const server = await api.createMcpServer({
      name: 'New Server',
      transportType: 'stdio',
      command: null,
      args: null,
      env: null,
      url: null,
      headers: null,
    })
    await refresh()
    select(server.id)
  }, [refresh, requestLeave, select])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.mcpServer') }))) return
      await api.deleteMcpServer(id)
      if (selectedId === id) select(null)
      refresh()
    },
    [confirm, t, selectedId, select, refresh],
  )

  const handleImport = useCallback(
    async (data: McpServersJson) => {
      let lastId: string | null = null
      for (const [name, cfg] of Object.entries(data.mcpServers)) {
        const type = cfg.type ?? (cfg.url ? 'streamablehttp' : 'stdio')
        const server = await api.createMcpServer({
          name,
          transportType: type,
          command: cfg.command ?? null,
          args: cfg.args ?? null,
          env: cfg.env ?? null,
          url: cfg.url ?? null,
          headers: cfg.headers ?? null,
        })
        lastId = server.id
      }
      back()
      refresh()
      if (lastId) openItem(lastId)
    },
    [back, openItem, refresh],
  )

  const selected = servers.find((s) => s.id === selectedId)
  const handleDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyServerId((current) => (dirty ? id : current === id ? null : current))
  }, [])

  if (loading && servers.length === 0) return <SettingsSkeleton className="max-w-3xl" />

  const serverList = (
    <ListView
      aria-label={t('settings.mcp.title')}
      className="flex flex-col gap-1"
      selectedKeys={selectedId ? new Set([selectedId]) : new Set<string>()}
      selectionBehavior="replace"
      selectionMode="single"
      shouldSelectOnPressUp
      variant="secondary"
      onSelectionChange={(keys) => {
        if (keys === 'all') return
        const id = keys.values().next().value
        if (typeof id === 'string' && id !== selectedId) openItem(id)
      }}
    >
      {servers.map((s) => (
        <ListView.Item
          key={s.id}
          id={s.id}
          textValue={s.name}
          className="min-h-11 rounded-lg border-b-0 px-3 py-2 data-[selected=true]:bg-background-tertiary-default data-[selected=true]:text-text-primary"
        >
          <ListView.ItemContent>
            <LogoMcp className="size-4" />
            <ListView.Title className="text-body-regular">{s.name}</ListView.Title>
          </ListView.ItemContent>
          <ListView.ItemAction>
            <span data-slot="mcp-server-transport" className="truncate text-caption-1-regular text-text-secondary">
              {s.transport_type === 'streamablehttp' ? 'HTTP' : 'stdio'}
            </span>
          </ListView.ItemAction>
        </ListView.Item>
      ))}
    </ListView>
  )

  const headerActions = (
    <div data-slot="mcp-header-actions" className="flex items-center gap-1">
      <TooltipTrigger delay={0}>
        <Button iconOnly aria-label={t('settings.mcp.importJson')} variant="outline" onPress={() => openAux('import')}>
          <ArrowDownToSquare className="w-4 h-4" />
        </Button>
        <Tooltip placement="top">{t('settings.mcp.importJson')}</Tooltip>
      </TooltipTrigger>
      <TooltipTrigger delay={0}>
        <Button iconOnly aria-label={t('settings.mcp.addServer')} variant="outline" onPress={handleAdd}>
          <Plus className="w-4 h-4" />
        </Button>
        <Tooltip placement="top">{t('settings.mcp.addServer')}</Tooltip>
      </TooltipTrigger>
    </div>
  )

  return (
    <>
      {loadError && (
        <Alert status="danger" className="mb-3 max-w-3xl">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="break-all">{t('settings.mcp.loadError')}</Alert.Description>
            <Button
              size="small"
              variant="outline"
              className="mt-2"
              onPress={() => {
                setLoading(servers.length === 0)
                void refresh()
              }}
            >
              {t('settings.mcp.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      )}
      <MasterDetail
        nav={nav}
        title={t('settings.mcp.title')}
        actions={headerActions}
        listWidth="w-48"
        headerPlacement="top"
        list={
          <div data-slot="mcp-server-list" className="overflow-y-auto overscroll-contain">
            {serverList}
          </div>
        }
        detailTitle={selected?.name}
        detail={
          selected ? (
            <McpServerEditor
              key={selected.id}
              server={selected}
              onUpdate={() => void refresh()}
              onDelete={handleDelete}
              onDirtyChange={handleDirtyChange}
            />
          ) : undefined
        }
        emptyDetail={t('settings.mcp.selectServer')}
        // On a phone the import form is a screen of its own and now has a way
        // back out of it; on a desktop it opens above a list that stays put.
        auxTitle={t('settings.mcp.importJson')}
        aux={showImport ? <JsonImportDialog onImport={handleImport} onCancel={back} /> : undefined}
        emptyState={
          servers.length === 0 && !showImport && !loadError ? (
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>{t('settings.mcp.noServers')}</EmptyState.Title>
              </EmptyState.Header>
            </EmptyState>
          ) : undefined
        }
      />
      {confirmDialog}
    </>
  )
}
