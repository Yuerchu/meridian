import { useEffect, useState } from 'react'
import { api } from '@/api'

/** Platform id → the last nickname seen for it. */
export type SenderNames = Record<number, string>

const ONEBOT_SCOPE_PREFIX = 'onebot:'

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

    api.listMemorySubjects()
      .then((subjects) => {
        if (cancelled) return
        const next: SenderNames = {}
        for (const s of subjects) {
          if (!s.display_name || !s.scope_id.startsWith(ONEBOT_SCOPE_PREFIX)) continue
          const id = Number(s.scope_id.slice(ONEBOT_SCOPE_PREFIX.length))
          if (Number.isFinite(id)) next[id] = s.display_name
        }
        setNames(next)
      })
      .catch(() => {
        // A missing name degrades to the raw id, which is still a stable way to
        // tell two people apart — not worth surfacing as an error.
        if (!cancelled) setNames({})
      })

    return () => { cancelled = true }
  }, [speakers])

  return names
}
