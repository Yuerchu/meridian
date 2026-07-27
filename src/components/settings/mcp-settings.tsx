import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Plug, PlugZap, Trash2, ArrowLeft, ClipboardPaste } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { api } from '@/api'
import type { McpServer, McpToolDef } from '@/types'

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
      <Textarea
        className="h-40 font-mono resize-none"
        placeholder={t('settings.mcp.importJsonPlaceholder')}
        value={text}
        onChange={(e) => { setText(e.target.value); setError(false) }}
      />
      {error && (
        <p className="text-sm text-destructive">{t('settings.mcp.importJsonError')}</p>
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
    setError(null)
    api.listMcpTools(server.id).then((t) => {
      setTools(t)
      setConnected(t.length > 0)
    })
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

  const isHttp = transportType === 'streamablehttp'

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">{t('settings.mcp.name')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
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
                ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
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
                ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
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
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1" placeholder="https://example.com/mcp" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.headers')}</label>
            <Input value={headers} onChange={(e) => setHeaders(e.target.value)} className="mt-1" placeholder='{"Authorization": "Bearer ..."}' />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.command')}</label>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} className="mt-1" placeholder="npx" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.args')}</label>
            <Input value={args} onChange={(e) => setArgs(e.target.value)} className="mt-1" placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]' />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.mcp.env')}</label>
            <Input value={env} onChange={(e) => setEnv(e.target.value)} className="mt-1" placeholder='{}' />
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {connected ? (
          <Button variant="outline" onClick={handleDisconnect}>
            <PlugZap className="w-3.5 h-3.5 mr-1.5" />
            {t('settings.mcp.disconnect')}
          </Button>
        ) : (
          <Button variant="outline" onClick={handleConnect} disabled={connecting}>
            <Plug className="w-3.5 h-3.5 mr-1.5" />
            {connecting ? t('common.loading') : t('settings.mcp.connect')}
          </Button>
        )}
      </div>

      {error && (
        <div className="p-2 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive break-all">
          {error}
        </div>
      )}

      {tools.length > 0 && (
        <div>
          <label className="text-sm font-medium">{t('settings.mcp.tools')} ({tools.length})</label>
          <div className="mt-1 space-y-1">
            {tools.map((tool) => (
              <div key={tool.qualified_name} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/50 text-xs">
                <span className="font-mono">{tool.name}</span>
                <span className="text-muted-foreground truncate">{tool.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-border">
        <Button variant="destructive" onClick={() => onDelete(server.id)}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          {t('settings.mcp.deleteServer')}
        </Button>
      </div>
    </div>
  )
}

export function McpSettings() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  const refresh = useCallback(() => {
    api.listMcpServers().then(setServers)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleAdd = useCallback(async () => {
    const server = await api.createMcpServer('New Server', 'stdio')
    refresh()
    setSelectedId(server.id)
  }, [refresh])

  const handleDelete = useCallback(async (id: string) => {
    await api.deleteMcpServer(id)
    if (selectedId === id) setSelectedId(null)
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
    setShowImport(false)
    refresh()
    if (lastId) setSelectedId(lastId)
  }, [refresh])

  const selected = servers.find((s) => s.id === selectedId)

  const serverList = (
    <div className="space-y-1">
      {servers.map((s) => (
        <Button
          key={s.id}
          variant="ghost"
          onClick={() => setSelectedId(s.id)}
          className={cn(
            'w-full justify-start h-auto px-3 py-2',
            selectedId === s.id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground',
          )}
        >
          <div className="flex items-center gap-2 w-full">
            <Plug className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{s.name}</span>
            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
              {s.transport_type === 'streamablehttp' ? 'HTTP' : 'stdio'}
            </span>
          </div>
        </Button>
      ))}
    </div>
  )

  const headerActions = (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <ClipboardPaste className="w-4 h-4" />
            </Button>
          }
        />
        <TooltipContent side="top">{t('settings.mcp.importJson')}</TooltipContent>
      </Tooltip>
      <Button variant="outline" onClick={handleAdd}>
        <Plus className="w-4 h-4" />
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <div className="max-w-3xl">
        {showImport ? (
          <>
            <h2 className="text-lg font-semibold mb-4">{t('settings.mcp.importJson')}</h2>
            <JsonImportDialog onImport={handleImport} onCancel={() => setShowImport(false)} />
          </>
        ) : selected ? (
          <>
            <Button
              variant="ghost"
              onClick={() => setSelectedId(null)}
              className="text-muted-foreground mb-4"
            >
              <ArrowLeft />
              {t('common.back')}
            </Button>
            <McpServerEditor
              key={selected.id}
              server={selected}
              onUpdate={refresh}
              onDelete={handleDelete}
            />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{t('settings.mcp.title')}</h2>
              {headerActions}
            </div>
            {servers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('settings.mcp.noServers')}</p>
            ) : (
              serverList
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{t('settings.mcp.title')}</h2>
        {headerActions}
      </div>

      {showImport && (
        <div className="mb-4">
          <JsonImportDialog onImport={handleImport} onCancel={() => setShowImport(false)} />
        </div>
      )}

      {servers.length === 0 && !showImport ? (
        <p className="text-sm text-muted-foreground">{t('settings.mcp.noServers')}</p>
      ) : (
        <div className="flex gap-4">
          <ScrollArea className="w-48 flex-shrink-0">
            {serverList}
          </ScrollArea>

          <div className="flex-1">
            {selected ? (
              <McpServerEditor
                key={selected.id}
                server={selected}
                onUpdate={refresh}
                onDelete={handleDelete}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('settings.mcp.selectServer')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
