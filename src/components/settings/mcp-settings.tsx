import { useCallback } from 'react'
import { api } from '@/api'
import { SettingsStack, useSettingsStack } from './settings-stack'
import type { McpServersJson } from './mcp/import-json'
import { McpImportPage } from './mcp/import-page'
import { McpServerListPage } from './mcp/server-list-page'
import { McpServerPage } from './mcp/server-page'

/**
 * MCP servers, as pages — the list, a server over it, and the JSON import as
 * a page of its own.
 *
 * This was the second panel on `MasterDetail`; it moved to the stack the way
 * providers did, so it is the same pages at every width, a draft survives the
 * shell's leave guard through `useSettingsDraft`, and each page fetches what
 * it shows by id.
 */
type McpLevel = { kind: 'server'; serverId: string } | { kind: 'import' }

export function McpSettings() {
  const stack = useSettingsStack<McpLevel>()
  const { push, reset } = stack

  const handleCreate = useCallback(async () => {
    const server = await api.createMcpServer({
      name: 'New Server',
      transportType: 'stdio',
      command: null,
      args: null,
      env: null,
      url: null,
      headers: null,
    })
    push({ kind: 'server', serverId: server.id })
  }, [push])

  const handleImport = useCallback(
    async (data: McpServersJson) => {
      let lastId: string | null = null
      for (const [name, cfg] of Object.entries(data.mcpServers)) {
        const server = await api.createMcpServer({
          name,
          transportType: cfg.type ?? (cfg.url ? 'streamablehttp' : 'stdio'),
          command: cfg.command ?? null,
          args: cfg.args ?? null,
          env: cfg.env ?? null,
          url: cfg.url ?? null,
          headers: cfg.headers ?? null,
        })
        lastId = server.id
      }
      // The import page has nothing left to say once it has worked, so it
      // is swapped for the last server it made rather than left under it.
      reset()
      if (lastId) push({ kind: 'server', serverId: lastId })
    },
    [push, reset],
  )

  return (
    <SettingsStack stack={stack}>
      {(level) => {
        if (level === null) {
          return (
            <McpServerListPage
              onOpen={(serverId) => push({ kind: 'server', serverId })}
              onCreate={handleCreate}
              onImport={() => push({ kind: 'import' })}
            />
          )
        }
        if (level.kind === 'import') {
          return <McpImportPage onImport={handleImport} onCancel={() => void stack.pop()} />
        }
        return (
          <McpServerPage
            key={level.serverId}
            serverId={level.serverId}
            confirm={stack.confirm}
            // Unguarded: the draft is about a server that no longer exists.
            onDeleted={() => reset()}
          />
        )
      }}
    </SettingsStack>
  )
}
