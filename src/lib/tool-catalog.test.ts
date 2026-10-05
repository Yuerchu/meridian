import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BRIDGE_PREFIX,
  TOOLS,
  canonicalToolName,
  isAskTool,
  toolUi,
  type ToolUi,
  type TwinProperty,
} from '@/lib/tool-catalog'

/**
 * The gate between `lib/tool-catalog.ts` and what `meridian-core` says its
 * tools are. The catalog is generated from each tool's `spec()` and checked
 * in beside the crate; a checkout without the submodule fails here loudly
 * rather than passing on zero tools. Paths are relative to the project root,
 * where vitest runs.
 */
interface CatalogTool {
  name: string
  bridged: boolean
  spec: { effect: string }
  parameters: { properties?: Record<string, unknown> }
}
interface Catalog {
  bridge_prefix: string
  native: CatalogTool[]
  onebot: { name: string; effect: string }[]
}
const catalog = JSON.parse(readFileSync('src-tauri/crates/core/tool-catalog.json', 'utf8')) as Catalog

/** Every tool core defines, with its effect and argument keys. A QQ tool has
 *  no schema in the catalog, so it may name no argument here. */
const core = new Map<string, { effect: string; keys: Set<string> | null }>()
for (const tool of catalog.native) {
  core.set(tool.name, { effect: tool.spec.effect, keys: new Set(Object.keys(tool.parameters.properties ?? {})) })
}
for (const tool of catalog.onebot) {
  if (!core.has(tool.name)) core.set(tool.name, { effect: tool.effect, keys: null })
}

const entries = Object.entries(TOOLS)

/** Every argument key an entry reads, with what reads it. */
function keysRead(ui: ToolUi): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (ui.ident && ui.ident !== 'patch') for (const key of ui.ident.keys) out.push([key, 'ident'])
  if (ui.ident === 'patch') out.push(['patch', 'ident'])
  for (const key of ui.readOnly ?? []) out.push([key, 'readOnly'])
  if (ui.touches?.op === 'modify' || ui.touches?.op === 'delete') out.push([ui.touches.key, 'touches'])
  if (ui.touches?.op === 'move') out.push(['from', 'touches'], ['to', 'touches'])
  if (ui.touches?.op === 'patch') out.push(['patch', 'touches'])
  const diffKeys: Record<string, string[]> = {
    write: ['content'],
    edit: ['file_path', 'old_string', 'new_string'],
    'multi-edit': ['file_path', 'edits'],
    patch: ['patch'],
  }
  for (const key of ui.diff ? diffKeys[ui.diff] : []) out.push([key, 'diff'])
  return out
}

describe('tool catalog', () => {
  it('reads the generated catalog', () => {
    // A floor, so a moved file or a renamed field cannot make this a gate over nothing.
    expect(core.size).toBeGreaterThanOrEqual(45)
  })

  it('has an entry for every tool core defines, and none it does not', () => {
    const missing = [...core.keys()].filter((name) => toolUi(name)?.side !== 'native')
    expect(missing, 'Add the tool to TOOLS in src/lib/tool-catalog.ts, with how it is drawn').toEqual([])
    const stale = entries.filter(([name, ui]) => ui.side === 'native' && !core.has(name)).map(([name]) => name)
    expect(stale, 'A native entry for a tool meridian-core no longer has').toEqual([])
  })

  it('reads only argument keys the tool has', () => {
    const wrong: string[] = []
    for (const [name, ui] of entries) {
      const keys = ui.side === 'native' ? core.get(name)?.keys : new Set(ui.params ?? [])
      if (ui.side === 'hosted' && ui.params === undefined) wrong.push(`${name}: a hosted entry states its params`)
      for (const [key, by] of keysRead(ui)) {
        if (!keys?.has(key)) wrong.push(`${name}.${key} (${by})`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('names every tool in both locales', () => {
    for (const locale of ['en', 'zh-CN']) {
      const strings = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8')) as Record<string, string>
      const missing = entries.map(([name]) => name).filter((name) => !(`chat.tool.name.${name}` in strings))
      expect(missing, locale).toEqual([])
    }
  })

  /**
   * What the front end trusts a tool with has to match what core says the
   * tool does. A notification offering Allow/Deny for a tool that writes, or
   * folding one out of sight, is the failure this exists for.
   */
  it('agrees with core about what each native tool does', () => {
    const wrong: string[] = []
    for (const [name, ui] of entries) {
      if (ui.side !== 'native') continue
      const effect = core.get(name)?.effect
      if (ui.readOnly && effect !== 'read') wrong.push(`${name}: readOnly but ${effect}`)
      if (ui.reading && effect !== 'read') wrong.push(`${name}: reading but ${effect}`)
      if (ui.fold === 'commands' && effect !== 'exec') wrong.push(`${name}: folds as a command but ${effect}`)
      if ((ui.fold === 'files' || ui.fold === 'searches') && effect !== 'read') {
        wrong.push(`${name}: folds as a read but ${effect}`)
      }
      if (ui.touches && effect !== 'write_files') wrong.push(`${name}: touches files but ${effect}`)
      if (ui.interactive && effect !== 'interactive' && effect !== 'mode_transition') {
        wrong.push(`${name}: interactive but ${effect}`)
      }
      if (ui.block === 'delegate' && effect !== 'delegate') wrong.push(`${name}: delegates but ${effect}`)
    }
    expect(wrong).toEqual([])
  })

  /**
   * Near tools agree, or say why not. Each group has one native member and the
   * hosted ones are held to it; a reason given for a difference that is not
   * there any more fails too, so the reasons stay true.
   */
  it('holds twins to each other', () => {
    const properties: TwinProperty[] = [
      'ident',
      'fold',
      'reading',
      'readOnly',
      'interactive',
      'ask',
      'diff',
      'touches',
      'block',
    ]
    const groups = new Map<string, Array<[string, ToolUi]>>()
    for (const [name, ui] of entries) {
      if (ui.twin) groups.set(ui.twin, [...(groups.get(ui.twin) ?? []), [name, ui]])
    }
    const wrong: string[] = []
    for (const [twin, members] of groups) {
      const natives = members.filter(([, ui]) => ui.side === 'native')
      if (natives.length !== 1 || members.length < 2) {
        wrong.push(`${twin}: one native member and at least one hosted`)
        continue
      }
      const [nativeName, native] = natives[0]
      const excusedOnNative = new Set<TwinProperty>()
      for (const [name, ui] of members) {
        if (ui === native) continue
        for (const property of properties) {
          const differs = (native[property] !== undefined) !== (ui[property] !== undefined)
          const reason = ui.differs?.[property] ?? native.differs?.[property]
          if (differs && reason === undefined) wrong.push(`${name} vs ${nativeName}: ${property}`)
          if (differs && native.differs?.[property] !== undefined) excusedOnNative.add(property)
          if (!differs && ui.differs?.[property] !== undefined) wrong.push(`${name}: stale differs.${property}`)
        }
      }
      for (const property of Object.keys(native.differs ?? {}) as TwinProperty[]) {
        if (!excusedOnNative.has(property)) wrong.push(`${nativeName}: stale differs.${property}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('looks a bridged tool up as the tool it is', () => {
    expect(BRIDGE_PREFIX).toBe(catalog.bridge_prefix)
    const bridged = catalog.native.filter((tool) => tool.bridged).map((tool) => tool.name)
    expect(bridged.length).toBeGreaterThan(0)
    for (const name of bridged) {
      expect(canonicalToolName(BRIDGE_PREFIX + name)).toBe(name)
      expect(toolUi(BRIDGE_PREFIX + name)).toBe(TOOLS[name])
    }
    // Another server's tools, and a hosted name behind the prefix, keep theirs.
    expect(canonicalToolName('mcp__notes__append')).toBe('mcp__notes__append')
    expect(toolUi(BRIDGE_PREFIX + 'Read')).toBeUndefined()
    expect(toolUi('constructor')).toBeUndefined()
    expect(toolUi(BRIDGE_PREFIX + 'constructor')).toBeUndefined()
  })

  it('answers a question rather than approving it, under either name', () => {
    expect(isAskTool('ask_user')).toBe(true)
    expect(isAskTool('AskUserQuestion')).toBe(true)
    expect(isAskTool('run_command')).toBe(false)
  })

  /**
   * A comparison against a tool name anywhere else in the front end names a
   * tool this file knows. A rename in core then fails here rather than
   * leaving a branch that quietly never runs.
   */
  it('is the only place a tool name is spelled that is not in it', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => !p.replaceAll('\\', '/').startsWith('dev/'))
    const unknown: string[] = []
    const pattern = /\b(?:tool_name|toolName|function\.name)\s*[!=]==\s*'([^']+)'/g
    for (const file of files) {
      const src = readFileSync(join('src', file), 'utf8')
      for (const m of src.matchAll(pattern)) {
        if (!(m[1] in TOOLS)) unknown.push(`${file}: ${m[1]}`)
      }
    }
    expect(unknown).toEqual([])
  })
})
