import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, Cable, Plug } from '@keyline-icons/react/two-tone'
import { Alert, Button, Input, Switch, TextArea } from '@/components/base'
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { parseStringArrayText } from '@/lib/strict-json'
import { api } from '@/api'
import type { McpServerInfoResponse, McpServerToolInfoResponse } from '@/types'
import { SavedHint, SettingsCard, SettingsRow, SettingsSection, SettingsSkeleton } from '../primitives'
import { SettingsPage } from '../settings-page'
import { useSettingsDraft, type SettingsStack } from '../settings-stack'
import { KeyValueEditor } from './key-value-editor'
import { KeyValueError, pairsFromRecord, pairsSignature, recordFromPairs, type KeyValuePair } from './key-value'

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
      const list = await api.listMcpServers()
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
        <Alert status={loadError ? 'danger' : 'warning'} role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{loadError ? t('settings.mcp.loadError') : t('settings.mcp.serverGone')}</Alert.Title>
            {loadError && <Alert.Description className="break-all">{loadError}</Alert.Description>}
          </Alert.Content>
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
    Promise.all([api.listMcpTools(server.id), api.listMcpConnectionStatuses()])
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
    const request: Parameters<typeof api.updateMcpServer>[0] = { id: server.id, name, transportType }
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
      await api.updateMcpServer(request)
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
      await api.connectMcpServer(server.id)
      setTools(await api.listMcpTools(server.id))
      setConnected(true)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setConnecting(false)
    }
  }, [server.id])

  const handleDisconnect = useCallback(async () => {
    try {
      await api.disconnectMcpServer(server.id)
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
        await api.updateMcpServer({ id: server.id, isEnabled: next })
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

  const handleDelete = useCallback(async () => {
    if (!(await confirm({ body: t('settings.confirmDelete.mcpServer') }))) return
    setDeleting(true)
    try {
      await api.deleteMcpServer(server.id)
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
          <Button size="small" onPress={() => void handleSave()} isDisabled={!dirty} isPending={saving}>
            {t('common.save')}
          </Button>
          {saved && <SavedHint />}
        </>
      }
    >
      {/* What the server is: a name and how it is reached. */}
      <SettingsCard data-slot="mcp-server-identity">
        <SettingsRow label={t('settings.mcp.name')} stacked>
          {({ labelId }) => (
            <Input
              aria-labelledby={labelId}
              name={`mcpName-${server.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              fieldClassName="w-full @sm/pane:w-64"
            />
          )}
        </SettingsRow>
        <SettingsRow label={t('settings.mcp.transport')}>
          {({ labelId }) => (
            // The registry's segmented control. Two Buttons toggling a fill were
            // a lookalike of it.
            <SegmentedControl
              data-slot="mcp-transport-options"
              aria-labelledby={labelId}
              selectedKeys={[isHttp ? 'streamablehttp' : 'stdio']}
              onSelectionChange={(keys) => {
                const next = [...(keys as Set<string>)][0]
                if (next === 'stdio' || next === 'streamablehttp') setTransportType(next)
              }}
            >
              <SegmentedControlItem id="stdio">stdio</SegmentedControlItem>
              <SegmentedControlItem id="streamablehttp">HTTP</SegmentedControlItem>
            </SegmentedControl>
          )}
        </SettingsRow>
      </SettingsCard>

      {isHttp ? (
        <>
          <SettingsSection label={t('settings.mcp.endpoint')}>
            <SettingsRow label={t('settings.mcp.url')} stacked className="@sm/pane:flex-col @sm/pane:items-stretch">
              {({ labelId }) => (
                <Input
                  aria-labelledby={labelId}
                  name={`mcpUrl-${server.id}`}
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/mcp"
                  fieldClassName="w-full"
                  className="font-mono"
                />
              )}
            </SettingsRow>
          </SettingsSection>
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
          <SettingsSection label={t('settings.mcp.launch')}>
            <SettingsRow label={t('settings.mcp.command')} stacked>
              {({ labelId }) => (
                <Input
                  aria-labelledby={labelId}
                  name={`mcpCommand-${server.id}`}
                  spellCheck={false}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npx"
                  fieldClassName="w-full @sm/pane:w-80"
                  className="font-mono"
                />
              )}
            </SettingsRow>
            <SettingsRow
              label={t('settings.mcp.args')}
              description={t('settings.mcp.argsHint')}
              stacked
              className="@sm/pane:flex-col @sm/pane:items-stretch"
            >
              {({ labelId, descriptionId }) => (
                <TextArea
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  name={`mcpArgs-${server.id}`}
                  spellCheck={false}
                  rows={2}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]'
                  fieldClassName="w-full"
                  className="font-mono"
                />
              )}
            </SettingsRow>
          </SettingsSection>
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
      <SettingsSection label={t('settings.mcp.connection')}>
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
            <Button size="small" variant="secondary" leadingIcon={Plug} onPress={() => void handleDisconnect()}>
              {t('settings.mcp.disconnect')}
            </Button>
          ) : (
            <Button
              size="small"
              variant="secondary"
              leadingIcon={Cable}
              onPress={() => void handleConnect()}
              isDisabled={statusLoading}
              isPending={connecting}
            >
              {t('settings.mcp.connect')}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label={t('settings.mcp.autoConnect')} description={t('settings.mcp.autoConnectHint')}>
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              isSelected={autoConnect}
              onChange={(next) => void handleToggleAutoConnect(next)}
            />
          )}
        </SettingsRow>
      </SettingsSection>

      {error && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="break-all">{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* settings-tools.tsx lists a server's tools as its own rows: the name
          you would call it by, what it does underneath. */}
      {tools.length > 0 && (
        <SettingsSection label={t('settings.mcp.toolsWithCount', { count: tools.length })} data-slot="mcp-tools">
          {tools.map((tool) => (
            <div
              key={tool.qualified_name}
              data-slot="mcp-tool-row"
              className="flex w-full flex-col border-b border-separator-border py-2.5 pr-2.5 last:border-b-0"
            >
              <p data-slot="mcp-tool-name" className="truncate font-mono text-body-medium text-text-primary">
                {tool.name}
              </p>
              {tool.description && (
                <p data-slot="mcp-tool-description" className="line-clamp-2 text-body-2-regular text-text-secondary">
                  {tool.description}
                </p>
              )}
            </div>
          ))}
        </SettingsSection>
      )}

      {/* The profile page's closing card: a row saying what the action does,
          its button on the right — not a lone full-width red slab. */}
      <SettingsCard data-slot="mcp-danger-zone">
        <SettingsRow label={t('settings.mcp.deleteServer')} description={t('settings.mcp.deleteServerHint')}>
          <Button
            size="small"
            variant="danger"
            leadingIcon={Bin}
            isPending={deleting}
            onPress={() => void handleDelete()}
          >
            {t('settings.mcp.delete')}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  )
}

/** An argument list as one readable line of JSON: `["-y", "pkg", "/path"]`. */
function formatArgs(args: string[] | null): string {
  return `[${(args ?? []).map((arg) => JSON.stringify(arg)).join(', ')}]`
}
