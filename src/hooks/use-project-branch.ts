import { useEffect, useRef, useState } from 'react'
import { api } from '@/api'

/**
 * Which branch the conversation's project is on, as the composer's status tab
 * shows it.
 *
 * `loading` is the first read only: the tab holds its place for it, so the
 * chip arriving a moment after the conversation opens does not push the
 * transcript up. A re-read keeps showing the last answer until the new one
 * lands. `none` covers everything with nothing to show — no git, not a
 * repository, and a read that failed: the branch is a supplement to the
 * composer, and the git state proper is the changes panel's to report.
 */
export type ProjectBranch =
  { status: 'loading' } | { status: 'none' } | { status: 'branch'; name: string } | { status: 'detached' }

/** git's own spelling for a HEAD that is not on a branch, passed through by
 *  `workspace::git::parse_porcelain_v2`. */
const DETACHED = '(detached)'

/**
 * Read once when the conversation opens, again when a turn (or a `!` command)
 * finishes — a `git checkout` is something either can run — and again when the
 * window comes back to the front, since a terminal beside it can too. Nothing
 * polls: the branch moves only when somebody acts, and each of those is one of
 * these edges.
 *
 * `enabled` is whether the conversation has a local project with a folder. The
 * command rejects a conversation without one (`require_root`), and asking
 * anyway would turn every plain chat into a failed IPC call.
 */
export function useProjectBranch(conversationId: string, enabled: boolean, busy: boolean): ProjectBranch | null {
  const [branch, setBranch] = useState<ProjectBranch>({ status: 'loading' })
  const [focusCount, setFocusCount] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => setFocusCount((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled])

  // A different conversation starts from nothing: its project may be another
  // repository, and showing the last one's branch meanwhile would be wrong.
  useEffect(() => {
    setBranch({ status: 'loading' })
  }, [conversationId])

  // The conversation the last answer was for. A conversation opened mid-turn
  // still gets its first read; after that, reads wait for the turn to end —
  // the branch read mid-turn would be stale again by the end of it.
  const readFor = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (busy && readFor.current === conversationId) return
    let cancelled = false
    api
      .workspaceGitStatus({ conversationId })
      .then((status) => {
        if (cancelled) return
        readFor.current = conversationId
        if (status.state !== 'ok' || status.branch === null) setBranch({ status: 'none' })
        else if (status.branch === DETACHED) setBranch({ status: 'detached' })
        else setBranch({ status: 'branch', name: status.branch })
      })
      .catch(() => {
        if (cancelled) return
        readFor.current = conversationId
        setBranch({ status: 'none' })
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, enabled, busy, focusCount])

  return enabled ? branch : null
}
