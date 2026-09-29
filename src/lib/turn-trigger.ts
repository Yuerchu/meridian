import type { TurnTrigger } from '@/types'

/** Every value `turns.trigger` may hold, in the backend's own spelling. */
export const TURN_TRIGGERS = [
  'user',
  'plan_continuation',
  'task_completion',
  'agent_autonomous',
] as const satisfies readonly TurnTrigger[]

/**
 * Whether a turn has no question of its own above it.
 *
 * Such a turn is started by something other than a person — a background task
 * finishing, a hosted agent going round again — and the transcript gives it a
 * group of its own. A plan continuation is not one: the question it carries on
 * answering is the one above it.
 */
export function isUnprompted(trigger: TurnTrigger | undefined): boolean {
  return trigger === 'task_completion' || trigger === 'agent_autonomous'
}
