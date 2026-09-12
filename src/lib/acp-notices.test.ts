import { mergeAcpNotice, placeNotices } from './acp-notices'
import type { Turn } from './turns'
import type { AcpSessionNoticeInfoResponse } from '@/types'

function notice(over: Partial<AcpSessionNoticeInfoResponse> = {}): AcpSessionNoticeInfoResponse {
  return {
    id: 'n1',
    conversation_id: 'c1',
    turn_id: null,
    notice_id: 'prompt-1:error',
    revision: 1,
    category: 'limit',
    severity: 'warning',
    title: 'Retrying Claude, attempt 1 of 5.',
    details: null,
    reason: null,
    actions: [],
    created_at: 1,
    updated_at: 1,
    ...over,
  }
}

describe('mergeAcpNotice', () => {
  it('appends an incident it has not seen', () => {
    const held = [notice()]
    const next = mergeAcpNotice(held, notice({ id: 'n2', notice_id: 'sess:notice:1' }))
    expect(next.map((n) => n.notice_id)).toEqual(['prompt-1:error', 'sess:notice:1'])
  })

  /** The same incident again, now terminal: replaced in place so the row
   *  keeps its position in the transcript, and the old revision is gone. */
  it('replaces an incident with a higher revision in place', () => {
    const held = [notice(), notice({ id: 'n2', notice_id: 'other' })]
    const next = mergeAcpNotice(
      held,
      notice({ revision: 2, severity: 'error', title: 'Rate limit reached.', actions: ['retry'] }),
    )
    expect(next).toHaveLength(2)
    expect(next[0].revision).toBe(2)
    expect(next[0].severity).toBe('error')
    expect(next[1].notice_id).toBe('other')
  })

  /** A replay of what is already held is the adapter repeating itself. The
   *  very same array comes back, so nothing downstream re-renders. */
  it('ignores an equal or lower revision and keeps the array identity', () => {
    const held = [notice({ revision: 2 })]
    expect(mergeAcpNotice(held, notice({ revision: 2, title: 'said again' }))).toBe(held)
    expect(mergeAcpNotice(held, notice({ revision: 1 }))).toBe(held)
  })
})

describe('placeNotices', () => {
  const turn = (turnId: string | null): Turn => ({ turnId }) as Turn

  it('files an incident under its turn when that turn is on the path', () => {
    const placed = placeNotices([notice({ turn_id: 't1' })], [turn('t1'), turn('t2')])
    expect(placed.byTurn.get('t1')?.map((n) => n.id)).toEqual(['n1'])
    expect(placed.unplaced).toEqual([])
  })

  /** Session-scoped, or on a turn that is not on this path (another
   *  branch's): both are drawn after the transcript rather than guessed onto
   *  a turn they do not belong to. */
  it('leaves session-scoped and off-path incidents unplaced', () => {
    const placed = placeNotices(
      [notice({ id: 'a', turn_id: null }), notice({ id: 'b', notice_id: 'x', turn_id: 't9' })],
      [turn('t1')],
    )
    expect(placed.byTurn.size).toBe(0)
    expect(placed.unplaced.map((n) => n.id)).toEqual(['a', 'b'])
  })
})
