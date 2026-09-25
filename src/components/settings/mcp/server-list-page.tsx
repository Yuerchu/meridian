import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowInDownDashedPanel, Plug } from '@keyline-icons/react/two-tone'
import { Alert, Button } from '@/components/base'
import { api } from '@/api'
import type { McpConnectionStatusInfoResponse, McpServerInfoResponse } from '@/types'
import { cx } from '@/utils/cx'
import { SettingsAddRow, SettingsCard, SettingsLinkRow, SettingsSkeleton, SettingsTag } from '../primitives'
import { SettingsPage } from '../settings-page'
import { useSettingsResume } from '../settings-stack'

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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const [list, status] = await Promise.all([api.listMcpServers(), api.listMcpConnectionStatuses()])
      setServers(list)
      setStatuses(status)
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

  if (loading && servers.length === 0) return <SettingsSkeleton />

  return (
    <SettingsPage
      title={t('settings.mcp.title')}
      subtitle={t('settings.mcp.subtitle')}

      actions={
        <Button
          data-slot="mcp-import-open"
          variant="secondary"
          size="small"
          leadingIcon={ArrowInDownDashedPanel}
          onPress={onImport}
        >
          {t('settings.mcp.importJson')}
        </Button>
      }
    >
      {loadError && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="break-all">{t('settings.mcp.loadError')}</Alert.Description>
            <Button size="small" variant="secondary" className="mt-2" onPress={() => void refresh()}>
              {t('settings.mcp.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      )}
      <SettingsCard data-slot="mcp-server-list">
        {servers.map((server) => {
          const status = statuses.find((candidate) => candidate.server_id === server.id)
          const connected = status?.state === 'connected'
          const stateLabel = connected
            ? t('settings.mcp.connected')
            : status?.state === 'connecting'
              ? t('settings.mcp.connecting')
              : t('settings.mcp.disconnected')
          const target = server.transport_type === 'streamablehttp' ? server.url : server.command
          return (
            <SettingsLinkRow
              key={server.id}
              data-key={server.id}
              icon={<ServerTile state={status?.state ?? 'disconnected'} />}
              label={server.name}
              badge={
                <SettingsTag data-slot="mcp-server-transport">
                  {server.transport_type === 'streamablehttp' ? 'HTTP' : 'stdio'}
                </SettingsTag>
              }
              description={
                connected
                  ? `${stateLabel} · ${t('settings.mcp.toolCount', { count: status?.tool_count ?? 0 })}`
                  : `${stateLabel}${target ? ` · ${target}` : ''}`
              }
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
      </SettingsCard>
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
    <span data-slot="mcp-server-tile" className="relative flex size-8 shrink-0 items-center justify-center">
      <span
        data-slot="mcp-server-tile-face"
        className="flex size-8 items-center justify-center rounded-lg bg-background-tertiary-default"
      >
        <Plug className="size-4 text-foreground-icon-secondary" aria-hidden />
      </span>
      <span
        data-slot="mcp-server-tile-dot"
        data-state={state}
        aria-hidden
        className={cx(
          'absolute -bottom-0.5 -left-0.5 size-2.5 rounded-full ring-2 ring-background-secondary-default',
          state === 'connected'
            ? 'bg-status-success'
            : state === 'connecting'
              ? 'bg-status-warning'
              : 'bg-foreground-icon-tertiary',
        )}
      />
    </span>
  )
}
