/**
 * How each tool this app knows by name is drawn.
 *
 * The table itself is `lib/tool-catalog.ts`, together with every other
 * decision the front end makes about a tool; this file is the view of it the
 * result renderer reads. Tools whose names cannot be known in advance — MCP
 * (`mcp__server__tool`) and the user's custom tools — get
 * `GENERIC_RENDERER`: arguments as typed fields and a result read as
 * structured data when it parses, text when it does not. Neither half ever
 * pastes JSON source; `components/ui/tool-value.tsx` is the one place a value
 * of unknown shape is turned into something to look at.
 */
import { TOOLS, canonicalToolName, toolUi, type ToolArgsView, type ToolResultView } from './tool-catalog'

export type { ToolArgsView, ToolResultView }

export interface ToolRenderer {
  args: ToolArgsView
  result: ToolResultView
}

export const TOOL_RENDERERS: Readonly<Record<string, ToolRenderer>> = Object.fromEntries(
  Object.entries(TOOLS).map(([name, ui]) => [name, { args: ui.args, result: ui.result }]),
)

/** MCP, custom tools, and anything else whose shape is only known at runtime. */
export const GENERIC_RENDERER: ToolRenderer = { args: 'fields', result: 'structured' }

export function rendererFor(toolName: string): ToolRenderer {
  // Through `toolUi`, which asks for an own key: a tool called `constructor`
  // must not find `Object.prototype`'s.
  return toolUi(toolName) ? TOOL_RENDERERS[canonicalToolName(toolName)] : GENERIC_RENDERER
}
