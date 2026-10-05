import { describe, expect, it } from 'vitest'
import { GENERIC_RENDERER, TOOL_RENDERERS, rendererFor } from '@/lib/tool-renderers'
import { BRIDGE_PREFIX } from '@/lib/tool-catalog'

// Which tools have a renderer is `tool-catalog.test.ts`'s gate; this is only
// the lookup.
describe('tool renderers', () => {
  it('gives a name it cannot know the generic renderer', () => {
    expect(rendererFor('mcp__notes__append')).toBe(GENERIC_RENDERER)
    expect(rendererFor('my_custom_tool')).toBe(GENERIC_RENDERER)
    expect(rendererFor('constructor')).toBe(GENERIC_RENDERER)
  })

  it('draws a bridged tool as the tool it is', () => {
    expect(rendererFor(`${BRIDGE_PREFIX}read_app_logs`)).toBe(TOOL_RENDERERS.read_app_logs)
  })
})
