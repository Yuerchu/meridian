import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, PlugWire, PlugConnection, LogoMcp, TrashBin, ArrowDownToSquare } from '@gravity-ui/icons'
import { Button, Input, Switch, TextArea, Tooltip } from '@heroui/react'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import type { McpServer, McpToolDef } from '@/types'
import { MasterDetail } from './master-detail'
import { useMasterDetail } from './use-master-detail'

interface McpServersJson {
  mcpServers?: Record<string, {
    type?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  }>
}

function parseImportJson(raw: string): McpServersJson | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') return parsed
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed)
      if (keys.length > 0 && keys.every(k => typeof parsed[k] === 'object')) {
        return { mcpServers: parsed }
      }
    }
    return null
  } catch {
    return null
  }
}

function JsonImportDialog({
  onImport,
  onCancel,
}: {
  onImport: (data: McpServersJson) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = () => {
    const data = parseImportJson(text)
    if (data) {
      onImport(data)
    } else {
      setError(true)
    }
  }

  return (
    <div className="space-y-3">
      <TextArea fullWidth
        className="h-40 font-mono resize-none"
        placeholder={t('settings.mcp.importJsonPlaceholder')}
        value={text}
        onChange={(e) => { setText(e.target.value); setError(false) }}
      />
      {error && (
        <p className="text-sm text-danger">{t('settings.mcp.importJsonError')}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={handleSubmit}>{t('settings.mcp.importJsonSubmit')}</Button>
        <Button variant="outline" onClick={onCancel}>{t('settings.mcp.importJsonCancel')}</Button>
      </div>
    </div>
  )
}

function McpServerEditor({
  server,
  onUpdate,
  onDelete,
}: {
  server: McpServer
  onUpdate: () => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(server.name)
  const [transportType, setTransportType] = useState(server.transport_type)
  const [command, setCommand] = useState(server.command ?? '')
  const [args, setArgs] = useState(server.args ?? '[]')
  const [env, setEnv] = useState(server.env ?? '{}')
  const [url, setUrl] = useState(server.url ?? '')
  const [headers, setHeaders] = useState(server.headers ?? '{}')
  const [saved, setSaved] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  /** Whether this one comes up on its own at launch — `is_enabled` in the row. */
  const [autoConnect, setAutoConnect] = useState(server.is_enabled === 1)
  const [tools, setTools] = useState<McpToolDef[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(server.name)
    setTransportType(server.transport_type)
    setCommand(server.command ?? '')
    setArgs(server.args ?? '[]')
    setEnv(server.env ?? '{}')
    setUrl(server.url ?? '')
    setHeaders(server.headers ?? '{}')
    setAutoConnect(server.is_enabled === 1)
    setError(null)
    // Asked, not inferred. Reading this off the tool list showed a server that
    // connects and exposes nothing as disconnected, while its process was
    // running quite happily.
    Promise.all([api.listMcpTools(server.id), api.listMcpConnectionStatuses()])
      .then(([t, statuses]) => {
        setTools(t)
        setConnected(statuses.some((s) => s.server_id === server.id && s.state === 'connected'))
      })
      .catch(() => { /* the card still renders; the buttons say what to try */ })
  }, [server.id])

  const handleSave = useCallback(async () => {
    const updates: Parameters<typeof api.updateMcpServer>[1] = {
      name,
      transportType,
    }
    if (transportType === 'stdio') {
      updates.command = command || null
      updates.args = args
      updates.env = env
      updates.url = null
      updates.headers = null
    } else {
      updates.url = url || null
      updates.headers = headers
      updates.command = null
      updates.args = null
      updates.env = null
    }
    await api.updateMcpServer(server.id, updates)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onUpdate()
  }, [server.id, name, transportType, command, args, env, url, headers, onUpdate])

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

  const handleToggleAutoConnect = useCallback(async (next: boolean) => {
    const previous = autoConnect
    setAutoConnect(next)
    try {
      await api.updateMcpServer(server.id, { isEnabled: next ? 1 : 0 })
      onUpdate()
    } catch (e) {
      // Rolled back rather than kept locally: a switch that says a server will
      // come back on its own, when nothing recorded that, is worse than an
      // error — the user finds out at the next launch.
      setAutoConnect(previous)
      setError(String(e))
    }
  }, [server.id, autoConnect, onUpdate])

  const isHttp = transportType === 'streamablehttp'

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">{t('settings.mcp.name')}</label>
        <Input fullWidth value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
      </div>

      <div>
        <label className="text-sm font-medium">{t('settings.mcp.transport')}</label>
        <div className="flex gap-2 mt-1">
          <Button
            variant="ghost"
            onClick={() => setTransportType('stdio')}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm transition-colors',
              !isHttp
                ? 'bg-default text-default-foreground hover:bg-default hover:text-default-foreground'
                : 'text-muted hover:text-foreground hover:bg-default/50'
            )}
          >
            {t('settings.mcp.transportStdio')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setTransportType('streamablehttp')}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm transition-colors',
              isHttp
                ? 'bg-default text-default-foreground hover:bg-default hover:text-default-foreground'
                : 'text-muted hover:text-foreground hover:bg-default/50'
            )}
          >
            {t('settings.mcp.transportHttp')}
          </Button>
        </div>
      </div>

      {isHttp ? (
        <>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.url')}</label>
            <Input fullWidth value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1" placeholder="https://example.com/mcp" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.headers')}</label>
            <Input fullWidth value={headers} onChange={(e) => setHeaders(e.target.value)} className="mt-1" placeholder='{"Authorization": "Bearer ..."}' />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.command')}</label>
            <Input fullWidth value={command} onChange={(e) => setCommand(e.target.value)} className="mt-1" placeholder="npx" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.args')}</label>
            <Input fullWidth value={args} onChange={(e) => setArgs(e.target.value)} className="mt-1" placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]' />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.env')}</label>
            <Input fullWidth value={env} onChange={(e) => setEnv(e.target.value)} className="mt-1" placeholder='{}' />
          </div>
        </>
      )}

      {/* Two different things, deliberately side by side: connecting is
          something you do now, auto-connect is something you mean for next
          time. Disconnecting does not turn the switch off. */}
      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {connected ? (
          <Button variant="outline" onClick={handleDisconnect}>
            <PlugConnection className="w-3.5 h-3.5 mr-1.5" />
            {t('settings.mcp.disconnect')}
          </Button>
        ) : (
          <Button variant="outline" onClick={handleConnect} isDisabled={connecting}>
            <PlugWire className="w-3.5 h-3.5 mr-1.5" />
            {connecting ? t('common.loading') : t('settings.mcp.connect')}
          </Button>
        )}
        <Switch
          className="ml-auto"
          isSelected={autoConnect}
          onChange={handleToggleAutoConnect}
        >
          {t('settings.mcp.autoConnect')}
        </Switch>
      </div>

      {error && (
        <div className="p-2 bg-danger/10 border border-danger/30 rounded text-sm text-danger break-all">
          {error}
        </div>
      )}

      {tools.length > 0 && (
        <div>
          <label className="text-sm font-medium">{t('settings.mcp.tools')} ({tools.length})</label>
          <div className="mt-1 space-y-1">
            {tools.map((tool) => (
              <div key={tool.qualified_name} className="flex items-center gap-2 px-2 py-1 rounded bg-default/50 text-xs">
                <span className="font-mono">{tool.name}</span>
                <span className="text-muted truncate">{tool.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-border">
        <Button variant="danger-soft" onClick={() => onDelete(server.id)}>
          <TrashBin className="w-3.5 h-3.5 mr-1.5" />
          {t('settings.mcp.deleteServer')}
        </Button>
      </div>
    </div>
  )
}

export function McpSettings() {
  const { t } = useTranslation()
  // Never auto-selects: unlike providers, an MCP server list is often empty on
  // first open, and there is nothing to fall back to.
  const nav = useMasterDetail<'import'>()
  const { selectedId } = nav
  const [servers, setServers] = useState<McpServer[]>([])
  const showImport = nav.aux === 'import'

  const refresh = useCallback(() => {
    api.listMcpServers().then(setServers)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleAdd = useCallback(async () => {
    const server = await api.createMcpServer('New Server', 'stdio')
    refresh()
    nav.openItem(server.id)
  }, [refresh])

  const handleDelete = useCallback(async (id: string) => {
    await api.deleteMcpServer(id)
    if (selectedId === id) nav.select(null)
    refresh()
  }, [selectedId, refresh])

  const handleImport = useCallback(async (data: McpServersJson) => {
    if (!data.mcpServers) return
    let lastId: string | null = null
    for (const [name, cfg] of Object.entries(data.mcpServers)) {
      const type = cfg.type ?? (cfg.url ? 'streamablehttp' : 'stdio')
      const server = await api.createMcpServer(name, type, {
        command: cfg.command,
        args: cfg.args ? JSON.stringify(cfg.args) : undefined,
        env: cfg.env ? JSON.stringify(cfg.env) : undefined,
        url: cfg.url,
        headers: cfg.headers ? JSON.stringify(cfg.headers) : undefined,
      })
      lastId = server.id
    }
    nav.back()
    refresh()
    if (lastId) nav.openItem(lastId)
  }, [refresh])

  const selected = servers.find((s) => s.id === selectedId)

  const serverList = (
    <div className="space-y-1">
      {servers.map((s) => (
        <Button
          key={s.id}
          variant="ghost"
          onClick={() => nav.openItem(s.id)}
          className={cn(
            'w-full justify-start h-auto px-3 py-2',
            selectedId === s.id
              ? 'bg-default text-default-foreground'
              : 'text-muted',
          )}
        >
          <div className="flex items-center gap-2 w-full">
            <LogoMcp className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{s.name}</span>
            <span className="text-xs text-muted ml-auto flex-shrink-0">
              {s.transport_type === 'streamablehttp' ? 'HTTP' : 'stdio'}
            </span>
          </div>
        </Button>
      ))}
    </div>
  )

  const headerActions = (
    <div className="flex items-center gap-1">
      <Tooltip delay={0}>
        <Button
          aria-label={t('settings.mcp.importJson')}
          variant="outline"
          onClick={() => nav.openAux('import')}
        >
          <ArrowDownToSquare className="w-4 h-4" />
        </Button>
        <Tooltip.Content placement="top">{t('settings.mcp.importJson')}</Tooltip.Content>
      </Tooltip>
      <Button variant="outline" onClick={handleAdd}>
        <Plus className="w-4 h-4" />
      </Button>
    </div>
  )

  return (
    <MasterDetail
      nav={nav}
      title={t('settings.mcp.title')}
      actions={headerActions}
      listWidth="w-48"
      headerPlacement="top"
      list={
        <div
          data-slot="mcp-server-list"
          className="overflow-y-auto overscroll-contain"
        >
          {serverList}
        </div>
      }
      detail={selected ? (
        <McpServerEditor
          key={selected.id}
          server={selected}
          onUpdate={refresh}
          onDelete={handleDelete}
        />
      ) : undefined}
      emptyDetail={t('settings.mcp.selectServer')}
      // On a phone the import form is a screen of its own and now has a way
      // back out of it; on a desktop it opens above a list that stays put.
      auxTitle={t('settings.mcp.importJson')}
      aux={showImport ? (
        <JsonImportDialog onImport={handleImport} onCancel={nav.back} />
      ) : undefined}
      emptyState={servers.length === 0 && !showImport ? (
        <p className="text-sm text-muted">{t('settings.mcp.noServers')}</p>
      ) : undefined}
    />
  )
}
