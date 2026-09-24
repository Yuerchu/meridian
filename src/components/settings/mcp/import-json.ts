import { parseJsonText, requireExactKeys, requireKnownKeys, requireRecord } from '@/lib/strict-json'
import type { McpTransport } from '@/types'

/** The `mcpServers` document other clients export, read strictly. */
export interface McpServersJson {
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

export function parseImportJson(raw: string): McpServersJson | null {
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
