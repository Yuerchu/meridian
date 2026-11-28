import { useEffect, useState } from 'react'
import { api } from '@/api'

/** Platform id → the last nickname seen for it. */
export type SenderNames = Record<number, string>

function parseNumericSubjectId(scopeId: string): number | null {
  const sep = scopeId.indexOf(':')
  if (sep <= 0) return null
  const id = Number(scopeId.slice(sep + 1))
  return Number.isFinite(id) ? id : null
}

/**
 * Nicknames for the people in a multi-speaker conversation.
 *
 * A message row stores only the sender's id, because nicknames change and a
 * stored one would freeze at whatever it was that day. The transcript therefore
 * re-attributes history from the subject table — the same table, and the same
 * reasoning, as the backend uses when it rebuilds a payload.
 *
 * Someone who has never been recorded as a subject is simply absent here; the
 * caller falls back to showing the raw id rather than an empty label.
 *
 * `speakers` is the set of ids the transcript currently needs, joined into a
 * string, or null on a surface with a single implicit author. Keying the fetch
 * on it means a newcomer's first message pulls their nickname in, while the far
 * more common case — more messages from the same people — refetches nothing.
 */
export function useSenderNames(speakers: string | null): SenderNames {
  const [names, setNames] = useState<SenderNames>({})

  useEffect(() => {
    if (speakers === null) {
      setNames({})
      return
    }
    let cancelled = false

    api.memories
      .listSubjects()
      .then((subjects) => {
        if (cancelled) return
        const next: SenderNames = {}
        for (const s of subjects) {
          if (!s.display_name) continue
          const id = parseNumericSubjectId(s.scope_id)
          if (id !== null) next[id] = s.display_name
        }
        setNames(next)
      })
      .catch(() => {
        // A missing name degrades to the raw id, which is still a stable way to
        // tell two people apart — not worth surfacing as an error.
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- a missing name degrades to the raw id; display only
        if (!cancelled) setNames({})
      })

    return () => {
      cancelled = true
    }
  }, [speakers])

  return names
}
