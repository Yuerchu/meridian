import type { AcpSessionNoticeInfoResponse } from '@/types'
import type { Turn } from '@/lib/turns'

/**
 * Fold one incident into the list a session holds.
 *
 * The adapter republishes an incident under the same `notice_id` when it
 * changes — a retry warning becoming the terminal failure is revision 2 of
 * the same thing — and repeats old ones when a session is loaded again. So a
 * newer revision of an id already held takes its place, an older or equal one
 * changes nothing, and a new id goes on the end, which is arrival order.
 */
export function mergeAcpNotice(
  held: AcpSessionNoticeInfoResponse[],
  notice: AcpSessionNoticeInfoResponse,
): AcpSessionNoticeInfoResponse[] {
  const at = held.findIndex((n) => n.notice_id === notice.notice_id)
  if (at === -1) return [...held, notice]
  if (held[at].revision >= notice.revision) return held
  const next = held.slice()
  next[at] = notice
  return next
}

export interface PlacedNotices {
  /** Keyed by the turn they were filed against, for the turns on this path. */
  byTurn: ReadonlyMap<string, readonly AcpSessionNoticeInfoResponse[]>
  /** Filed against no turn, or against one that is not on this path — a
   *  branch that is not active, say. Drawn after the turns. */
  unplaced: readonly AcpSessionNoticeInfoResponse[]
}

/** Where each incident is drawn: under its turn where that turn is on the
 *  path, and after the transcript otherwise. */
export function placeNotices(notices: readonly AcpSessionNoticeInfoResponse[], turns: readonly Turn[]): PlacedNotices {
  const onPath = new Set<string>()
  for (const turn of turns) if (turn.turnId !== null) onPath.add(turn.turnId)
  const byTurn = new Map<string, AcpSessionNoticeInfoResponse[]>()
  const unplaced: AcpSessionNoticeInfoResponse[] = []
  for (const notice of notices) {
    if (notice.turn_id !== null && onPath.has(notice.turn_id)) {
      const list = byTurn.get(notice.turn_id)
      if (list) list.push(notice)
      else byTurn.set(notice.turn_id, [notice])
    } else {
      unplaced.push(notice)
    }
  }
  return { byTurn, unplaced }
}
