import { useLayoutEffect, useMemo, useRef } from 'react'
import { buildTurns, type Turn } from '@/lib/turns'
import type { Message, TurnRecord } from '@/types'

/** The turns the backend says never reached an ending.
 *
 *  A `Set` rather than the records themselves so `buildTurns` never has to know
 *  the backend's vocabulary — `interrupted` there means a turn that stopped
 *  without recording how, while the same word here means something milder, and
 *  translating it in one place keeps the two from being confused for each
 *  other. */
function crashedIds(turns: TurnRecord[]): ReadonlySet<string> {
  return new Set(turns.filter((t) => t.status === 'interrupted').map((t) => t.id))
}

/** One shared empty array, because a default parameter would mint a new one on
 *  every render and take the whole memo chain below it with it. */
const NO_TURNS: TurnRecord[] = []

/**
 * Groups messages into turns while keeping object identity across renders.
 *
 * `buildTurns` is pure, so a naive `useMemo` would hand back all-new `Turn`
 * objects every time a stream chunk lands — 24ms apart — and defeat `React.memo`
 * for the whole list. Immer already gives us structural sharing at the `Message`
 * level; this preserves it one layer up, so only the turn actually being written
 * to changes reference.
 */
export function useTurns(
  messages: Message[],
  streaming: boolean,
  turns: TurnRecord[] = NO_TURNS,
): Turn[] {
  const crashed = useMemo(() => crashedIds(turns), [turns])
  const built = useMemo(
    () => buildTurns(messages, { streaming, crashedTurnIds: crashed }),
    [messages, streaming, crashed],
  )
  const prevRef = useRef<Turn[]>(built)
  const stable = reconcileTurns(prevRef.current, built)
  useLayoutEffect(() => {
    prevRef.current = stable
  }, [stable])
  return stable
}

/** Every field of a `Turn` is derived from these, so matching inputs mean the
 *  previously built object is still correct. */
function sameInputs(a: Turn, b: Turn): boolean {
  if (a.userMessage !== b.userMessage) return false
  if (a.status !== b.status) return false
  if (a.assistantMessages.length !== b.assistantMessages.length) return false
  for (let i = 0; i < a.assistantMessages.length; i++) {
    if (a.assistantMessages[i] !== b.assistantMessages[i]) return false
  }
  return true
}

export function reconcileTurns(prev: Turn[], next: Turn[]): Turn[] {
  if (prev.length === 0) return next
  const byId = new Map(prev.map((t) => [t.id, t]))
  let identical = prev.length === next.length
  const out = next.map((t, i) => {
    const old = byId.get(t.id)
    if (old && sameInputs(old, t)) {
      if (prev[i] !== old) identical = false
      return old
    }
    identical = false
    return t
  })
  return identical ? prev : out
}
