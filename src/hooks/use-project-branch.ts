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

const LOADING: ProjectBranch = { status: 'loading' }

/**
 * Read once when the conversation opens, again when a turn (or a `!` command)
 * finishes — a `git checkout` is something either can run — and again when the
 * window comes back to the front, since a terminal beside it can too. Nothing
 * polls: the branch moves only when somebody acts, and each of those is one of
 * these edges.
 *
 * `projectPath` is the folder of the conversation's local project, or null
 * when it has none. The command rejects a conversation without one
 * (`require_root`), and asking anyway would turn every plain chat into a failed
 * IPC call. It is the folder rather than a yes/no because a conversation can be
 * moved to another project and keep its id: that is another repository, and a
 * boolean that was true before the move and true after it would never ask.
 *
 * The answer is stored with the conversation and folder it was read for, and
 * one for anything else reads as `loading`. Resetting it in an effect instead
 * would let the first render after a switch paint the last conversation's
 * branch, which is the one thing this chip must not get wrong.
 */
export function useProjectBranch(
  conversationId: string,
  projectPath: string | null,
  busy: boolean,
): ProjectBranch | null {
  const key = projectPath === null ? null : `${conversationId}\0${projectPath}`
  const [answer, setAnswer] = useState<{ key: string; branch: ProjectBranch } | null>(null)
  const [focusCount, setFocusCount] = useState(0)
  const enabled = key !== null

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => setFocusCount((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled])

  // The conversation and folder the last answer was for. One opened mid-turn
  // still gets its first read; after that, reads wait for the turn to end —
  // the branch read mid-turn would be stale again by the end of it.
  const readFor = useRef<string | null>(null)

  useEffect(() => {
    if (key === null) return
    if (busy && readFor.current === key) return
    let cancelled = false
    const settle = (branch: ProjectBranch) => {
      if (cancelled) return
      readFor.current = key
      setAnswer({ key, branch })
    }
    api
      .workspaceGitStatus({ conversationId })
      .then((status) => {
        if (status.state !== 'ok' || status.branch === null) settle({ status: 'none' })
        else if (status.branch === DETACHED) settle({ status: 'detached' })
        else settle({ status: 'branch', name: status.branch })
      })
      .catch(() => settle({ status: 'none' }))
    return () => {
      cancelled = true
    }
  }, [conversationId, key, busy, focusCount])

  if (key === null) return null
  return answer?.key === key ? answer.branch : LOADING
}
