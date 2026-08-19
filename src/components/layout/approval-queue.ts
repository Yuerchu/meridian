import type { AttentionItem } from '@/stores/conversation-store'

/**
 * How many questions are on screen at once.
 *
 * HeroUI stacks them and makes every one but the frontmost
 * `pointer-events-none`, so this is a depth cue rather than three things to
 * answer: the queue is worked one at a time, and the two behind say how much is
 * left. The rest of the queue is not handed to `ToastQueue` at all — thirty
 * questions would otherwise be thirty live toasts to say the same thing.
 */
export const MAX_VISIBLE = 3

/**
 * Which questions the queue offers, front first.
 *
 * Split out from the component it serves so its tests do not have to mount one.
 * The two exclusions are the whole policy, and neither fails in a way anybody
 * would see: a question that should have been filtered out just draws, and one
 * that should have been offered just does not.
 */
export function visible(
  attention: Record<string, AttentionItem>,
  order: string[],
  activeId: string | null,
): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const id of order) {
    const item = attention[id]
    // The order is written independently of the map, so an id can outlive the
    // entry it names for the span of one update.
    if (!item) continue
    // Already in the transcript being read, at the live edge the scroller
    // follows. Two places to click for one decision is worse than one.
    if (item.conversationId === activeId) continue
    out.push(item)
    if (out.length === MAX_VISIBLE) break
  }
  return out
}
