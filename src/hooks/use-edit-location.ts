import { useEffect, useState } from 'react'
import { api } from '@/api'
import { useConversationStore } from '@/stores/conversation-store'
import type { ToolCallDisplay } from '@/types'

/**
 * Where an edit lands, found by reading the file it is about to change.
 *
 * `edit_file` and a hosted `Edit` name a string to replace, not a line, and
 * nothing on the wire says where that string is. The file itself does: read
 * through the same bounded workspace reader the preview sheet uses, the line
 * `old_string` starts on is the line the diff starts on. That is asked only
 * while the call is `pending` or `running` — before the edit has been applied —
 * because afterwards the file has changed and the string is gone. What was
 * found is kept for the card's life under its call id, so a call that resolves
 * while its panel is open keeps the numbers it was approved with.
 *
 * **A card reloaded after the edit ran gets no numbers.** Reading the changed
 * file back and searching for `new_string` would give a number, and it would
 * be wrong exactly when it matters — after a later edit to the same file has
 * moved everything below it. A gutter that is absent is honest; one that is
 * confidently off by twelve is not.
 *
 * Everything that stops the answer — a path outside the project, a hosted
 * session's edit outside its cwd, a file past the reader's bound, a string
 * not found, the playground's transport throwing — leaves it `null`.
 */
const cache = new Map<string, number | null>()

export function useEditLocation(data: ToolCallDisplay, path: string | null, oldString: string | null): number | null {
  const conversationId = useConversationStore((s) => s.activeId)
  const [line, setLine] = useState<number | null>(() => cache.get(data.call_id) ?? null)
  const asking = (data.status === 'pending' || data.status === 'running') && path !== null && oldString !== null

  useEffect(() => {
    if (!asking || conversationId === null || cache.has(data.call_id)) return
    let cancelled = false
    const callId = data.call_id
    // `catch` rather than a returned error: outside the desktop the transport
    // itself throws, and either way the answer is the same — no gutter.
    api
      .workspaceResolveRef({ conversationId, projectId: null, path: path!, lineStart: null, lineEnd: null })
      .then((preview) => {
        if (cancelled) return
        const content = preview.content.replace(/\r\n/g, '\n')
        const at = preview.truncated ? -1 : content.indexOf(oldString!.replace(/\r\n/g, '\n'))
        const found = at === -1 ? null : content.slice(0, at).split('\n').length
        cache.set(callId, found)
        setLine(found)
      })
      .catch(() => {
        if (cancelled) return
        cache.set(callId, null)
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- null is "line unknown": the diff is drawn without a gutter
        setLine(null)
      })
    return () => {
      cancelled = true
    }
  }, [asking, conversationId, data.call_id, path, oldString])

  return line
}

/** For tests: forget what was found. */
export function resetEditLocations(): void {
  cache.clear()
}
