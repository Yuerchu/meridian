import { Message } from '@keyline-icons/react/two-tone'
// The leaves, not the icon. `es/ClaudeCode` is a compound that imports all five
// of its variants eagerly, and two of them — `Avatar` and `Combine` — reach
// `../../features/`, which imports `@lobehub/ui`, which is most of the megabyte
// `ui/model-icon` is lazy-loaded to avoid. Vitest cannot even resolve that far:
// `@lobehub/fluent-emoji` does a directory import Node refuses. `Mono` and
// `Color` reach `react` and a sibling style module and nothing else.
import ClaudeCodeMono from '@lobehub/icons/es/ClaudeCode/components/Mono'
import ClaudeCodeColor from '@lobehub/icons/es/ClaudeCode/components/Color'

/**
 * Whose conversation this is, in one glyph.
 *
 * Straight from the package rather than through `ui/model-icon`, which matches
 * a name against every logo it knows and so has to pull all of them. A
 * `Suspense` boundary per sidebar row to defer one named icon would cost more
 * than it saved.
 */
export function ConversationIcon({ agentKind }: { agentKind?: string | null }) {
  // Mono, not colour: these rows are monochrome and take their colour from the
  // row's state — muted, hovered, current — and a hardcoded brand hex would
  // ignore all three and read as a selection that had not applied.
  if (agentKind === 'claude_code') return <ClaudeCodeMono aria-hidden />
  // Everything else, including the hook gates' review transcripts and a
  // delegated run: those appear where what they are is already said, so a
  // second mark would be decoration.
  return <Message className="size-4" />
}

/**
 * The same logo where a *model's* would go.
 *
 * A hosted row's `model_id` is whatever the agent reported, and Claude Code's
 * default answers `"default"` — a real value that names no model and matches no
 * logo, so `ModelIcon` drew an empty circle. What the row wants to say there is
 * which agent wrote it, which is known from the conversation rather than from
 * the id.
 *
 * Colour here and not in the sidebar, because this one sits on a frame of its
 * own rather than in a row of monochrome siblings, and an avatar is the one
 * place a logo is meant to look like itself.
 */
export function HostedAgentGlyph({ size = 18 }: { size?: number }) {
  return <ClaudeCodeColor size={size} aria-hidden />
}
