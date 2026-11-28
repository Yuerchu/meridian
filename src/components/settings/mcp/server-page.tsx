import './server-page.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, Cable, Plug } from '@keyline-icons/react/two-tone'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { parseStringArrayText } from '@/lib/strict-json'
import { api } from '@/api'
import type {
  McpServerInfoResponse,
  McpServerToolInfoResponse,
  McpToolPolicyOverrideResponse,
  ToolApprovalPolicy,
  ToolLoading,
  ToolScope,
} from '@/types'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { SavedHint, SettingsSkeleton } from '../primitives'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { formatDefinitionTokens } from './format'
import { SettingsPage } from '../settings-page'
import { useSettingsDraft, type SettingsStack } from '../settings-stack'
import { KeyValueEditor } from './key-value-editor'
import { KeyValueError, pairsFromRecord, pairsSignature, recordFromPairs, type KeyValuePair } from './key-value'
import { titleIfTruncated } from '@/lib/truncation'
type ConfirmFn = SettingsStack<unknown>['confirm']
/**
 * One MCP server, fetched by id.
 *
 * There is no single-server command, so this is the list narrowed — the same
 * trade the provider page makes. By id rather than handed a row, so coming
 * back to it lands on the server as it is now.
 */
export function McpServerPage({
  serverId,
  confirm,
  onDeleted,
}: {
  serverId: string
  confirm: ConfirmFn
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [server, setServer] = useState<McpServerInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const list = await api.mcp.listServers()
      setServer(list.find((candidate) => candidate.id === serverId) ?? null)
      setLoadError(null)
    } catch (reason) {
      setLoadError(String(reason))
    }
  }, [serverId])
  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])
  if (loading) return <SettingsSkeleton />
  if (!server) {
    return (
      <SettingsPage title={t('settings.mcp.title')}>
        <Alert
          tone={loadError ? 'danger' : 'warning'}
          shouldAnnounce
          heading={<>{loadError ? t('settings.mcp.loadError') : t('settings.mcp.serverGone')}</>}
        >
          {loadError}
        </Alert>
      </SettingsPage>
    )
  }
  return (
    <McpServerEditor
      key={server.id}
      server={server}
      confirm={confirm}
      onSaved={() => void refresh()}
      onDeleted={onDeleted}
    />
  )
}
function McpServerEditor({
  server,
  confirm,
  onSaved,
  onDeleted,
}: {
  server: McpServerInfoResponse
  confirm: ConfirmFn
  onSaved: () => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(server.name)
  const [transportType, setTransportType] = useState(server.transport_type)
  const [command, setCommand] = useState(server.command ?? '')
  const [args, setArgs] = useState(() => formatArgs(server.args))
  const [env, setEnv] = useState<KeyValuePair[]>(() => pairsFromRecord(server.env))
  const [url, setUrl] = useState(server.url ?? '')
  const [headers, setHeaders] = useState<KeyValuePair[]>(() => pairsFromRecord(server.headers))
  const [saved, markSaved] = useTemporaryFlag(1500)
  const [saving, setSaving] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  /** Whether this one comes up on its own at launch — `is_enabled` in the row. */
  const [autoConnect, setAutoConnect] = useState(server.is_enabled)
  const [serverPolicy, setServerPolicy] = useState<McpToolPolicyOverrideResponse>(
    server.default_policy ?? { scope: null, loading: null, approval: null },
  )
  const [toolPolicies, setToolPolicies] = useState<Record<string, McpToolPolicyOverrideResponse>>(
    server.tool_policies ?? {},
  )
  const [tools, setTools] = useState<McpServerToolInfoResponse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const signature = (draft: {
    name: string
    transportType: string
    command: string
    args: string
    env: KeyValuePair[]
    url: string
    headers: KeyValuePair[]
  }) =>
    JSON.stringify([
      draft.name,
      draft.transportType,
      draft.command,
      draft.args,
      pairsSignature(draft.env),
      draft.url,
      pairsSignature(draft.headers),
    ])
  const [savedSignature, setSavedSignature] = useState(() =>
    signature({
      name: server.name,
      transportType: server.transport_type,
      command: server.command ?? '',
      args: formatArgs(server.args),
      env: pairsFromRecord(server.env),
      url: server.url ?? '',
      headers: pairsFromRecord(server.headers),
    }),
  )
  const currentSignature = signature({ name, transportType, command, args, env, url, headers })
  const dirty = currentSignature !== savedSignature
  useSettingsDraft('mcp', 'mcp-server-editor', dirty)
  useEffect(() => {
    let cancelled = false
    setError(null)
    setStatusLoading(true)
    // Asked, not inferred. Reading this off the tool list showed a server that
    // connects and exposes nothing as disconnected, while its process was
    // running quite happily.
    Promise.all([api.mcp.listServerTools({ server_id: server.id }), api.mcp.listConnectionStatuses()])
      .then(([list, statuses]) => {
        if (cancelled) return
        setTools(list)
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
  const describeKeyValueError = useCallback(
    (reason: unknown, field: string) => {
      if (!(reason instanceof KeyValueError)) return String(reason)
      return reason.reason === 'emptyKey'
        ? t('settings.mcp.kv.emptyKey', { field })
        : t('settings.mcp.kv.duplicateKey', { field, key: reason.key })
    },
    [t],
  )
  const handleSave = useCallback(async () => {
    const request: Parameters<typeof api.mcp.updateServer>[0] = {
      id: server.id,
      name,
      transport_type: transportType,
    }
    try {
      if (transportType === 'stdio') {
        request.command = command || null
        request.args = parseStringArrayText(args, 'args')
        request.env = recordFromPairs(env)
        request.url = null
        request.headers = null
      } else {
        request.url = url || null
        request.headers = recordFromPairs(headers)
        request.command = null
        request.args = null
        request.env = null
      }
    } catch (reason) {
      setError(
        describeKeyValueError(reason, transportType === 'stdio' ? t('settings.mcp.env') : t('settings.mcp.headers')),
      )
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.mcp.updateServer(request)
      setSavedSignature(currentSignature)
      markSaved()
      onSaved()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }, [
    server.id,
    name,
    transportType,
    command,
    args,
    env,
    url,
    headers,
    currentSignature,
    describeKeyValueError,
    markSaved,
    onSaved,
    t,
  ])
  const handleConnect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      await api.mcp.connectServer({ id: server.id })
      setTools(await api.mcp.listServerTools({ server_id: server.id }))
      setConnected(true)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setConnecting(false)
    }
  }, [server.id])
  const handleDisconnect = useCallback(async () => {
    try {
      await api.mcp.disconnectServer({ id: server.id })
      setTools([])
      setConnected(false)
    } catch (reason) {
      setError(String(reason))
    }
  }, [server.id])
  const handleToggleAutoConnect = useCallback(
    async (next: boolean) => {
      const previous = autoConnect
      setAutoConnect(next)
      try {
        await api.mcp.updateServer({ id: server.id, is_enabled: next })
      } catch (reason) {
        // Rolled back rather than kept locally: a switch that says a server will
        // come back on its own, when nothing recorded that, is worse than an
        // error — the user finds out at the next launch.
        setAutoConnect(previous)
        setError(String(reason))
      }
    },
    [server.id, autoConnect],
  )
  const handleToggleTool = useCallback(
    async (toolName: string, next: boolean) => {
      const previous = tools
      setTools((current) => current.map((tool) => (tool.name === toolName ? { ...tool, enabled: next } : tool)))
      setError(null)
      try {
        await api.mcp.setToolEnabled({ server_id: server.id, tool_name: toolName, enabled: next })
      } catch (reason) {
        setTools(previous)
        setError(String(reason))
      }
    },
    [server.id, tools],
  )
  const handleUpdateServerPolicy = useCallback(
    async (patch: Partial<McpToolPolicyOverrideResponse>) => {
      const previous = serverPolicy
      const next: McpToolPolicyOverrideResponse = { ...serverPolicy, ...patch }
      setServerPolicy(next)
      setError(null)
      try {
        const updated = await api.mcp.setServerPolicy({
          server_id: server.id,
          scope: next.scope,
          loading: next.loading,
          approval: next.approval,
        })
        setServerPolicy(updated.default_policy ?? { scope: null, loading: null, approval: null })
        setTools(await api.mcp.listServerTools({ server_id: server.id }))
        onSaved()
      } catch (reason) {
        setServerPolicy(previous)
        setError(String(reason))
      }
    },
    [server.id, serverPolicy, onSaved],
  )
  const handleUpdateToolPolicy = useCallback(
    async (toolName: string, patch: Partial<McpToolPolicyOverrideResponse>) => {
      const previous = toolPolicies
      const current = toolPolicies[toolName] ?? { scope: null, loading: null, approval: null }
      const next: McpToolPolicyOverrideResponse = { ...current, ...patch }
      setToolPolicies({ ...toolPolicies, [toolName]: next })
      setError(null)
      try {
        const updated = await api.mcp.setToolPolicy({
          server_id: server.id,
          tool_name: toolName,
          scope: next.scope,
          loading: next.loading,
          approval: next.approval,
        })
        setToolPolicies(updated.tool_policies ?? {})
        setTools(await api.mcp.listServerTools({ server_id: server.id }))
        onSaved()
      } catch (reason) {
        setToolPolicies(previous)
        setError(String(reason))
      }
    },
    [server.id, toolPolicies, onSaved],
  )
  const handleApproveDriftedTools = useCallback(
    async (toolNames: string[]) => {
      setError(null)
      try {
        await api.mcp.approveAlwaysTools({ server_id: server.id, tool_names: toolNames })
        setTools(await api.mcp.listServerTools({ server_id: server.id }))
        onSaved()
      } catch (reason) {
        setError(String(reason))
      }
    },
    [server.id, onSaved],
  )
  const handleDelete = useCallback(async () => {
    if (
      !(await confirm({
        description: t('settings.confirmDelete.mcpServer'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    setDeleting(true)
    try {
      await api.mcp.deleteServer({ id: server.id })
    } catch (reason) {
      setError(String(reason))
      setDeleting(false)
      return
    }
    onDeleted()
  }, [confirm, t, server.id, onDeleted])
  const isHttp = transportType === 'streamablehttp'
  const transportLabel = isHttp ? t('settings.mcp.transportHttp') : t('settings.mcp.transportStdio')
  return (
    <SettingsPage
      title={server.name}
      subtitle={transportLabel}
      footer={
        <>
          <Button size="sm" onPress={() => void handleSave()} isDisabled={!dirty} isPending={saving}>
            {t('common.save')}
          </Button>
          {saved && <SavedHint />}
        </>
      }
    >
      {/* What the server is: a name and how it is reached. */}
      <SettingsGroup>
        <SettingsRow label={t('settings.mcp.name')}>
          <TextField name={`mcpName-${server.id}`} value={name} onChange={(event) => setName(event)} />
        </SettingsRow>
        <SettingsRow label={t('settings.mcp.transport')}>
          {/* The registry's segmented control. Two Buttons toggling a fill were
              a lookalike of it. */}
          <SegmentedControl
            data-slot="mcp-transport-options"
            selectedKey={isHttp ? 'streamablehttp' : 'stdio'}
            onSelectionChange={(next) => {
              if (next === 'stdio' || next === 'streamablehttp') setTransportType(next)
            }}
          >
            <Segment id="stdio">stdio</Segment>
            <Segment id="streamablehttp">HTTP</Segment>
          </SegmentedControl>
        </SettingsRow>
      </SettingsGroup>
      {isHttp ? (
        <>
          <SettingsGroup headingLevel={3} heading={t('settings.mcp.endpoint')}>
            <SettingsRow label={t('settings.mcp.url')}>
              <TextField
                name={`mcpUrl-${server.id}`}
                type="url"
                inputMode="url"
                spellCheck="false"
                value={url}
                onChange={(event) => setUrl(event)}
                placeholder="https://example.com/mcp"
              />
            </SettingsRow>
          </SettingsGroup>
          <KeyValueEditor
            label={t('settings.mcp.headers')}
            description={t('settings.mcp.headersHint')}
            addLabel={t('settings.mcp.kv.addHeader')}
            keyPlaceholder="Authorization"
            pairs={headers}
            onChange={setHeaders}
          />
        </>
      ) : (
        <>
          <SettingsGroup headingLevel={3} heading={t('settings.mcp.launch')}>
            <SettingsRow label={t('settings.mcp.command')}>
              <TextField
                name={`mcpCommand-${server.id}`}
                spellCheck="false"
                value={command}
                onChange={(event) => setCommand(event)}
                placeholder="npx"
              />
            </SettingsRow>
            <SettingsRow label={t('settings.mcp.args')} description={t('settings.mcp.argsHint')}>
              <TextArea
                name={`mcpArgs-${server.id}`}
                spellCheck="false"
                rows={2}
                value={args}
                onChange={(event) => setArgs(event)}
                placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]'
              />
            </SettingsRow>
          </SettingsGroup>
          <KeyValueEditor
            label={t('settings.mcp.env')}
            description={t('settings.mcp.envHint')}
            addLabel={t('settings.mcp.kv.addEnv')}
            keyPlaceholder="API_KEY"
            pairs={env}
            onChange={setEnv}
          />
        </>
      )}
      {/* Two different things, deliberately side by side: connecting is
          something you do now, auto-connect is something you mean for next
          time. Disconnecting does not turn the switch off. */}
      <SettingsGroup headingLevel={3} heading={t('settings.mcp.connection')}>
        <SettingsRow
          label={t('settings.mcp.status')}
          description={
            statusLoading
              ? t('common.loading')
              : connected
                ? t('settings.mcp.connectedWithTools', { count: tools.length })
                : t('settings.mcp.disconnected')
          }
        >
          {connected ? (
            <Button size="sm" variant="secondary" icon={<Plug />} onPress={() => void handleDisconnect()}>
              {t('settings.mcp.disconnect')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              icon={<Cable />}
              onPress={() => void handleConnect()}
              isDisabled={statusLoading}
              isPending={connecting}
            >
              {t('settings.mcp.connect')}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label={t('settings.mcp.autoConnect')} description={t('settings.mcp.autoConnectHint')}>
          <Switch isSelected={autoConnect} onChange={(next) => void handleToggleAutoConnect(next)} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup headingLevel={3} heading={t('settings.mcp.policy.serverTitle')}>
        <SettingsRow label={t('settings.mcp.policy.scope')} description={t('settings.mcp.policy.scopeHint')}>
          <SegmentedControl
            size="sm"
            selectedKey={serverPolicy.scope ?? 'inherit'}
            onSelectionChange={(key) =>
              void handleUpdateServerPolicy({ scope: key === 'inherit' ? null : (key as ToolScope) })
            }
          >
            <Segment id="inherit">{t('settings.mcp.policy.inherit')}</Segment>
            <Segment id="local_only">{t('settings.mcp.policy.scope.local_only')}</Segment>
            <Segment id="operator_only">{t('settings.mcp.policy.scope.operator_only')}</Segment>
            <Segment id="shared_room">{t('settings.mcp.policy.scope.shared_room')}</Segment>
          </SegmentedControl>
        </SettingsRow>
        <SettingsRow label={t('settings.mcp.policy.loading')} description={t('settings.mcp.policy.loadingHint')}>
          <SegmentedControl
            size="sm"
            selectedKey={serverPolicy.loading ?? 'inherit'}
            onSelectionChange={(key) =>
              void handleUpdateServerPolicy({ loading: key === 'inherit' ? null : (key as ToolLoading) })
            }
          >
            <Segment id="inherit">{t('settings.mcp.policy.inherit')}</Segment>
            <Segment id="deferred">{t('settings.mcp.policy.loading.deferred')}</Segment>
            <Segment id="eager">{t('settings.mcp.policy.loading.eager')}</Segment>
          </SegmentedControl>
        </SettingsRow>
        <SettingsRow label={t('settings.mcp.policy.approval')} description={t('settings.mcp.policy.approvalHint')}>
          <SegmentedControl
            size="sm"
            selectedKey={serverPolicy.approval ?? 'inherit'}
            onSelectionChange={(key) =>
              void handleUpdateServerPolicy({ approval: key === 'inherit' ? null : (key as ToolApprovalPolicy) })
            }
          >
            <Segment id="inherit">{t('settings.mcp.policy.inherit')}</Segment>
            <Segment id="always">{t('settings.mcp.policy.approval.always')}</Segment>
            <Segment id="auto_review">{t('settings.mcp.policy.approval.auto_review')}</Segment>
            <Segment id="request_approve">{t('settings.mcp.policy.approval.request_approve')}</Segment>
            <Segment id="never">{t('settings.mcp.policy.approval.never')}</Segment>
          </SegmentedControl>
        </SettingsRow>
      </SettingsGroup>
      {tools.some((tool) => tool.resolved_policy.needs_always_reapproval) && (
        <Alert
          tone="warning"
          shouldAnnounce
          actions={
            <Button
              size="sm"
              variant="secondary"
              onPress={() =>
                void handleApproveDriftedTools(
                  tools.filter((tool) => tool.resolved_policy.needs_always_reapproval).map((tool) => tool.name),
                )
              }
            >
              {t('settings.mcp.policy.approveDrifted')}
            </Button>
          }
        >
          {t('settings.mcp.policy.driftAlert', {
            tools: tools
              .filter((tool) => tool.resolved_policy.needs_always_reapproval)
              .map((tool) => tool.name)
              .join(', '),
          })}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
      {/* settings-tools.tsx lists a server's tools as its own rows: the name
          you would call it by, what it does underneath. The switch is the
          catalogue filter — off means the definition never enters the prefix. */}
      {tools.length > 0 && (
        <SettingsGroup
          headingLevel={3}
          heading={t('settings.mcp.toolsSection', {
            on: tools.filter((tool) => tool.enabled).length,
            total: tools.length,
            tokens: formatDefinitionTokens(
              tools.filter((tool) => tool.enabled).reduce((sum, tool) => sum + tool.definition_tokens, 0),
            ),
          })}
        >
          {tools.map((tool) => {
            const override = toolPolicies[tool.name]
            const description = [
              tool.description.split('\n')[0],
              t('settings.mcp.toolTokenCount', { tokens: formatDefinitionTokens(tool.definition_tokens) }),
              t(`settings.mcp.policy.loading.${tool.resolved_policy.loading}`),
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <SettingsRow
                key={tool.qualified_name}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      data-slot="mcp-tool-name"
                      onPointerEnter={titleIfTruncated}
                      className="m-mcp-server-page__tool-name"
                    >
                      {tool.name}
                    </span>
                    {tool.resolved_policy.needs_always_reapproval && (
                      <Badge size="sm" tone="warning">
                        {t('settings.mcp.policy.driftBadge')}
                      </Badge>
                    )}
                  </span>
                }
                description={description}
              >
                <div className="inline-flex items-center gap-2">
                  <SegmentedControl
                    size="sm"
                    aria-label={`${tool.name} ${t('settings.mcp.policy.approval')}`}
                    selectedKey={override?.approval ?? 'inherit'}
                    onSelectionChange={(key) =>
                      void handleUpdateToolPolicy(tool.name, {
                        approval: key === 'inherit' ? null : (key as ToolApprovalPolicy),
                      })
                    }
                  >
                    <Segment id="inherit">{t('settings.mcp.policy.inherit')}</Segment>
                    <Segment id="always">{t('settings.mcp.policy.approval.always')}</Segment>
                    <Segment id="auto_review">{t('settings.mcp.policy.approval.auto_review')}</Segment>
                    <Segment id="request_approve">{t('settings.mcp.policy.approval.request_approve')}</Segment>
                    <Segment id="never">{t('settings.mcp.policy.approval.never')}</Segment>
                  </SegmentedControl>
                  <Switch isSelected={tool.enabled} onChange={(next) => void handleToggleTool(tool.name, next)} />
                </div>
              </SettingsRow>
            )
          })}
        </SettingsGroup>
      )}
      {/* The profile page's closing card: a row saying what the action does,
          its button on the right — not a lone full-width red slab. */}
      <SettingsGroup>
        <SettingsRow label={t('settings.mcp.deleteServer')} description={t('settings.mcp.deleteServerHint')}>
          <Button
            size="sm"
            variant="destructive"
            icon={<Bin />}
            isPending={deleting}
            onPress={() => void handleDelete()}
          >
            {t('settings.mcp.delete')}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
/** An argument list as one readable line of JSON: `["-y", "pkg", "/path"]`. */
function formatArgs(args: string[] | null): string {
  return `[${(args ?? []).map((arg) => JSON.stringify(arg)).join(', ')}]`
}
