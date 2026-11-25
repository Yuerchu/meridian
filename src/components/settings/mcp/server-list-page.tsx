import './server-list-page.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowInDownDashedPanel, Plug } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { api } from '@/api'
import type { McpConnectionStatusInfoResponse, McpServerInfoResponse, McpServerToolInfoResponse } from '@/types'
import { SettingsAddRow, SettingsLinkRow, SettingsSkeleton } from '../primitives'
import { SettingsGroup } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { SettingsPage } from '../settings-page'
import { useSettingsResume } from '../settings-stack'
import { ContextMeter } from './context-meter'
import { formatDefinitionTokens } from './format'

/**
 * Every MCP server, and the way into one.
 *
 * settings-tools.tsx's server list, row for row: a 32px tile with the
 * connection dot pinned to its corner and ringed in the card's colour, the
 * name with its transport beside it, a line saying what it is — its tool
 * count once connected, where it runs otherwise — and "New MCP server" as the
 * card's last row. Fetches on mount and again whenever the stack returns here,
 * the same as the provider list, so a rename or delete one page up is picked
 * up without a callback.
 */
export function McpServerListPage({
  onOpen,
  onCreate,
  onImport,
}: {
  onOpen: (serverId: string) => void
  onCreate: () => Promise<void>
  onImport: () => void
}) {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpServerInfoResponse[]>([])
  const [statuses, setStatuses] = useState<McpConnectionStatusInfoResponse[]>([])
  const [tools, setTools] = useState<McpServerToolInfoResponse[]>([])
  const [hotId, setHotId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const [list, status, listed] = await Promise.all([
        api.mcp.listServers(),
        api.mcp.listConnectionStatuses(),
        api.mcp.listServerTools({ server_id: null }),
      ])
      setServers(list)
      setStatuses(status)
      setTools(listed)
    } catch (reason) {
      setLoadError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void refresh()
  }, [refresh])

  useSettingsResume(() => void refresh())

  const meter = useMemo(() => {
    const enabled = tools.filter((tool) => tool.enabled)
    if (enabled.length === 0) return null
    const byServer = new Map<string, { name: string; tokens: number }>()
    for (const tool of enabled) {
      const current = byServer.get(tool.server_id) ?? { name: tool.server_name, tokens: 0 }
      current.tokens += tool.definition_tokens
      byServer.set(tool.server_id, current)
    }
    return {
      toolCount: enabled.length,
      segments: [...byServer.entries()].map(([id, segment]) => ({ id, name: segment.name, tokens: segment.tokens })),
    }
  }, [tools])

  if (loading && servers.length === 0) return <SettingsSkeleton />

  return (
    <SettingsPage
      title={t('settings.mcp.title')}
      subtitle={t('settings.mcp.subtitle')}

      actions={
        <Button
          data-slot="mcp-import-open"
          variant="secondary"
          size="sm"
          icon={<ArrowInDownDashedPanel />}
          onPress={onImport}
        >
          {t('settings.mcp.importJson')}
        </Button>
      }
    >
      {loadError && (
        <Alert
          tone="danger"
          shouldAnnounce
          actions={
            <Button size="sm" variant="secondary" onPress={() => void refresh()}>
              {t('settings.mcp.retry')}
            </Button>
          }
        >
          {t('settings.mcp.loadError')}
        </Alert>
      )}
      {meter && (
        <SettingsGroup>
          <ContextMeter segments={meter.segments} toolCount={meter.toolCount} hotId={hotId} />
        </SettingsGroup>
      )}
      <div data-slot="mcp-server-list">
        <SettingsGroup>
          {servers.map((server) => {
            const status = statuses.find((candidate) => candidate.server_id === server.id)
            const connected = status?.state === 'connected'
            const stateLabel = connected
              ? t('settings.mcp.connected')
              : status?.state === 'connecting'
                ? t('settings.mcp.connecting')
                : t('settings.mcp.disconnected')
            const target = server.transport_type === 'streamablehttp' ? server.url : server.command
            const serverTools = tools.filter((tool) => tool.server_id === server.id)
            const enabledTools = serverTools.filter((tool) => tool.enabled)
            const enabledTokens = enabledTools.reduce((sum, tool) => sum + tool.definition_tokens, 0)
            const description = connected
              ? serverTools.length > 0
                ? t('settings.mcp.connectedToolShare', {
                    on: enabledTools.length,
                    total: serverTools.length,
                    tokens: formatDefinitionTokens(enabledTokens),
                  })
                : `${stateLabel} · ${t('settings.mcp.toolCount', { count: status?.tool_count ?? 0 })}`
              : `${stateLabel}${target ? ` · ${target}` : ''}`
            return (
              <SettingsLinkRow
                key={server.id}
                data-key={server.id}
                icon={<ServerTile state={status?.state ?? 'disconnected'} />}
                label={server.name}
                badge={
                  <Badge size="sm" data-slot="mcp-server-transport">
                    {server.transport_type === 'streamablehttp' ? 'HTTP' : 'stdio'}
                  </Badge>
                }
                description={description}
                onHoverStart={() => setHotId(server.id)}
                onHoverEnd={() => setHotId((current) => (current === server.id ? null : current))}
                onFocus={() => setHotId(server.id)}
                onBlur={() => setHotId((current) => (current === server.id ? null : current))}
                onPress={() => onOpen(server.id)}
              />
            )
          })}
          <SettingsAddRow
            label={t('settings.mcp.addServer')}
            description={t('settings.mcp.addServerHint')}
            isDisabled={creating}
            onPress={() => {
              setCreating(true)
              void onCreate().finally(() => setCreating(false))
            }}
          />
        </SettingsGroup>
      </div>
    </SettingsPage>
  )
}

/**
 * The server's tile, with its connection state as a dot on the corner.
 *
 * The dot is ringed in the card's own colour so it reads as punched through
 * the tile (settings-tools.tsx, `ServerTile`). Its state is said in words on
 * the row's second line as well, so the colour is never the only signal.
 */
function ServerTile({ state }: { state: McpConnectionStatusInfoResponse['state'] }) {
  return (
    <span data-slot="mcp-server-tile" className="m-mcp-server-list__tile">
      <span data-slot="mcp-server-tile-face" className="m-mcp-server-list__tile-face">
        <Plug size={16} aria-hidden />
      </span>
      <span data-slot="mcp-server-tile-dot" data-state={state} aria-hidden className="m-mcp-server-list__tile-dot" />
    </span>
  )
}
