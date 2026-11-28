import './server-list-page.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowInDownDashedPanel, Plug } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { api } from '@/api'
import type {
  AnthropicToolSearchStrategy,
  McpConnectionStatusInfoResponse,
  McpDefaultPolicyInfoResponse,
  McpServerInfoResponse,
  McpServerToolInfoResponse,
  ToolApprovalPolicy,
  ToolLoading,
  ToolScope,
} from '@/types'
import { SettingsAddRow, SettingsLinkRow, SettingsSkeleton } from '../primitives'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
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
  const [defaultPolicy, setDefaultPolicy] = useState<McpDefaultPolicyInfoResponse | null>(null)
  const [anthropicSearch, setAnthropicSearch] = useState<AnthropicToolSearchStrategy>('server_bm25')
  const [hotId, setHotId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const [list, status, listed, policy, searchPref] = await Promise.all([
        api.mcp.listServers(),
        api.mcp.listConnectionStatuses(),
        api.mcp.listServerTools({ server_id: null }),
        api.mcp.getDefaultPolicy(),
        api.preferences.get({ key: 'tools.anthropic_search_strategy' }),
      ])
      setServers(list)
      setStatuses(status)
      setTools(listed)
      setDefaultPolicy(policy)
      setAnthropicSearch(searchPref.value ?? 'server_bm25')
    } catch (reason) {
      setLoadError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  const updateAnthropicSearch = useCallback(
    async (value: AnthropicToolSearchStrategy) => {
      const previous = anthropicSearch
      setAnthropicSearch(value)
      setLoadError(null)
      try {
        await api.preferences.set({ key: 'tools.anthropic_search_strategy', value })
      } catch (reason) {
        setAnthropicSearch(previous)
        setLoadError(String(reason))
      }
    },
    [anthropicSearch],
  )

  const updateDefaultPolicy = useCallback(
    async (patch: Partial<McpDefaultPolicyInfoResponse>) => {
      if (!defaultPolicy) return
      const next: McpDefaultPolicyInfoResponse = { ...defaultPolicy, ...patch }
      const previous = defaultPolicy
      setDefaultPolicy(next)
      setLoadError(null)
      try {
        const saved = await api.mcp.setDefaultPolicy(next)
        setDefaultPolicy(saved)
      } catch (reason) {
        setDefaultPolicy(previous)
        setLoadError(String(reason))
      }
    },
    [defaultPolicy],
  )

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

  if (loading && servers.length === 0) return <SettingsSkeleton width="wide" />

  return (
    <SettingsPage
      width="wide"
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
      {defaultPolicy && (
        <SettingsGroup headingLevel={3} heading={t('settings.mcp.policy.defaultTitle')}>
          <SettingsRow label={t('settings.mcp.policy.scope')} description={t('settings.mcp.policy.scopeHint')}>
            <SegmentedControl
              size="sm"
              selectedKey={defaultPolicy.scope}
              onSelectionChange={(key) => void updateDefaultPolicy({ scope: key as ToolScope })}
            >
              <Segment id="local_only">{t('settings.mcp.policy.scope.local_only')}</Segment>
              <Segment id="operator_only">{t('settings.mcp.policy.scope.operator_only')}</Segment>
              <Segment id="shared_room">{t('settings.mcp.policy.scope.shared_room')}</Segment>
            </SegmentedControl>
          </SettingsRow>
          <SettingsRow label={t('settings.mcp.policy.loading')} description={t('settings.mcp.policy.loadingHint')}>
            <SegmentedControl
              size="sm"
              selectedKey={defaultPolicy.loading}
              onSelectionChange={(key) => void updateDefaultPolicy({ loading: key as ToolLoading })}
            >
              <Segment id="deferred">{t('settings.mcp.policy.loading.deferred')}</Segment>
              <Segment id="eager">{t('settings.mcp.policy.loading.eager')}</Segment>
            </SegmentedControl>
          </SettingsRow>
          <SettingsRow label={t('settings.mcp.policy.approval')} description={t('settings.mcp.policy.approvalHint')}>
            <SegmentedControl
              size="sm"
              selectedKey={defaultPolicy.approval}
              onSelectionChange={(key) => void updateDefaultPolicy({ approval: key as ToolApprovalPolicy })}
            >
              <Segment id="always">{t('settings.mcp.policy.approval.always')}</Segment>
              <Segment id="auto_review">{t('settings.mcp.policy.approval.auto_review')}</Segment>
              <Segment id="request_approve">{t('settings.mcp.policy.approval.request_approve')}</Segment>
              <Segment id="never">{t('settings.mcp.policy.approval.never')}</Segment>
            </SegmentedControl>
          </SettingsRow>
          <SettingsRow
            label={t('settings.mcp.policy.anthropicSearch')}
            description={t('settings.mcp.policy.anthropicSearchHint')}
          >
            <SegmentedControl
              size="sm"
              selectedKey={anthropicSearch}
              onSelectionChange={(key) => void updateAnthropicSearch(key as AnthropicToolSearchStrategy)}
            >
              <Segment id="server_bm25">{t('settings.mcp.policy.anthropicSearch.server_bm25')}</Segment>
              <Segment id="server_regex">{t('settings.mcp.policy.anthropicSearch.server_regex')}</Segment>
              <Segment id="client_tool_reference">
                {t('settings.mcp.policy.anthropicSearch.client_tool_reference')}
              </Segment>
            </SegmentedControl>
          </SettingsRow>
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
