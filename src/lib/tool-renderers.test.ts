import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GENERIC_RENDERER, HOSTED_TOOL_NAMES, TOOL_RENDERERS, rendererFor } from '@/lib/tool-renderers'

/**
 * The gate: a tool that exists in Rust has a renderer here, or this fails.
 *
 * The names are read from the source rather than from a list somebody keeps,
 * because a kept list is exactly what falls behind. Three shapes cover every
 * built-in tool `meridian-core` defines:
 *
 * - a `Tool` impl under `tools/` whose `name()` returns a literal;
 * - a `…_TOOL` constant (plans, skills, sub-agents, QQ history, voice);
 * - a row of the QQ tool table, `name: "qq_…",`.
 *
 * Relative to the project root, which is where vitest runs from — the same
 * convention `locales.test.ts` uses. `src-tauri/crates` is a submodule; a
 * checkout without it fails here loudly rather than passing on zero names.
 */
const CORE = 'src-tauri/crates/core/src'

function rustFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.rs'))
    .map((p) => join(dir, p))
}

function builtInToolNames(): Map<string, string> {
  const found = new Map<string, string>()
  const note = (name: string, file: string) => {
    if (!found.has(name)) found.set(name, file)
  }
  for (const file of rustFiles(CORE)) {
    const src = readFileSync(file, 'utf8')
    const rel = file.replaceAll('\\', '/')
    if (rel.includes('/tools/')) {
      for (const m of src.matchAll(/fn name\(&self\) -> &(?:'static )?str \{\s*"([a-z_]+)"/g)) note(m[1], rel)
    }
    for (const m of src.matchAll(/const [A-Z_]+_TOOL: &str = "([a-z_]+)";/g)) note(m[1], rel)
    if (rel.endsWith('/onebot/qq_tools.rs')) {
      for (const m of src.matchAll(/\bname: "([a-z_]+)",/g)) note(m[1], rel)
    }
  }
  return found
}

describe('tool renderers', () => {
  const names = builtInToolNames()

  it('finds the built-in tools in the Rust sources', () => {
    // A floor, so a moved directory or a renamed pattern cannot turn this
    // into a gate over nothing.
    expect(names.size).toBeGreaterThanOrEqual(45)
    for (const known of ['read_file', 'run_command', 'run_agent', 'update_plan', 'qq_set_group_ban', 'send_voice']) {
      expect(names.has(known), known).toBe(true)
    }
  })

  it('has a renderer for every built-in tool', () => {
    const missing = [...names].filter(([name]) => !(name in TOOL_RENDERERS))
    expect(
      missing.map(([name, file]) => `${name} (${file})`),
      'A new tool must be registered in src/lib/tool-renderers.ts (TOOL_RENDERERS) with how its arguments ' +
        'and its result are drawn — not left to fall through to the generic view.',
    ).toEqual([])
  })

  it('has a renderer for every hosted Claude Code tool', () => {
    const missing = HOSTED_TOOL_NAMES.filter((name) => !(name in TOOL_RENDERERS))
    expect(missing, 'Add the hosted tool to TOOL_RENDERERS in src/lib/tool-renderers.ts').toEqual([])
  })

  it('registers nothing that no longer exists', () => {
    const hosted = new Set<string>(HOSTED_TOOL_NAMES)
    const stale = Object.keys(TOOL_RENDERERS).filter((name) => !names.has(name) && !hosted.has(name))
    expect(stale, 'A renderer for a tool that is neither in the Rust sources nor in HOSTED_TOOL_NAMES').toEqual([])
  })

  it('gives a name it cannot know the generic renderer', () => {
    expect(rendererFor('mcp__notes__append')).toBe(GENERIC_RENDERER)
    expect(rendererFor('my_custom_tool')).toBe(GENERIC_RENDERER)
  })
})
