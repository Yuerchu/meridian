import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Plug, PlugZap, Trash2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { api } from '@/api'
import type { McpServer, McpToolDef } from '@/types'

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
  const [command, setCommand] = useState(server.command ?? '')
  const [args, setArgs] = useState(server.args ?? '[]')
  const [env, setEnv] = useState(server.env ?? '{}')
  const [saved, setSaved] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [tools, setTools] = useState<McpToolDef[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listMcpTools(server.id).then((t) => {
      setTools(t)
      setConnected(t.length > 0)
    })
  }, [server.id])

  const handleSave = useCallback(async () => {
    await api.updateMcpServer(server.id, { name, command, args, env })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onUpdate()
  }, [server.id, name, command, args, env, onUpdate])

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

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">{t('settings.mcp.name')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
      </div>

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

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {connected ? (
          <Button size="sm" variant="outline" onClick={handleDisconnect}>
            <PlugZap className="w-3.5 h-3.5 mr-1.5" />
            {t('settings.mcp.disconnect')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={handleConnect} disabled={connecting}>
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
        <Button size="sm" variant="destructive" onClick={() => onDelete(server.id)}>
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

  const selected = servers.find((s) => s.id === selectedId)

  const serverList = (
    <div className="space-y-1">
      {servers.map((s) => (
        <button
          key={s.id}
          onClick={() => setSelectedId(s.id)}
          className={cn(
            'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
            selectedId === s.id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          <div className="flex items-center gap-2">
            <Plug className="w-3.5 h-3.5" />
            {s.name}
          </div>
        </button>
      ))}
    </div>
  )

  if (isMobile) {
    return (
      <div className="max-w-3xl">
        {selected ? (
          <>
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-2 text-sm text-muted-foreground mb-4 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back')}
            </button>
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
              <Button size="sm" variant="outline" onClick={handleAdd}>
                <Plus className="w-4 h-4" />
              </Button>
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
        <Button size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {servers.length === 0 ? (
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
