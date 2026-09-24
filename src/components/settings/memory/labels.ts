import type { TFunction } from 'i18next'
import type { MemoryOrigin, MemoryScope, MemoryType } from '@/types'

/**
 * What the closed memory enums are called on screen.
 *
 * The values come from Rust (`memory_enums`) and used to be printed as they
 * are — `onebot_user`, `private`, `fact` — which is the database talking. A
 * switch per enum rather than a key built from the value: a variant added in
 * Rust then fails the type check here instead of rendering a missing key.
 */
export function memoryTypeLabel(t: TFunction, type: MemoryType): string {
  switch (type) {
    case 'general':
      return t('settings.memory.types.general')
    case 'preference':
      return t('settings.memory.types.preference')
    case 'fact':
      return t('settings.memory.types.fact')
    case 'instruction':
      return t('settings.memory.types.instruction')
    case 'relationship':
      return t('settings.memory.types.relationship')
  }
}

export function memoryScopeLabel(t: TFunction, scope: MemoryScope): string {
  switch (scope) {
    case 'project':
      return t('settings.memory.scopes.project')
    case 'client_global':
      return t('settings.memory.scopes.clientGlobal')
    case 'onebot_global':
      return t('settings.memory.scopes.onebotGlobal')
    case 'onebot_user':
      return t('settings.memory.scopes.onebotUser')
  }
}

export function memoryOriginLabel(t: TFunction, origin: MemoryOrigin): string {
  switch (origin) {
    case 'private':
      return t('settings.memory.origins.private')
    case 'group':
      return t('settings.memory.origins.group')
    case 'admin':
      return t('settings.memory.origins.admin')
    case 'desktop':
      return t('settings.memory.origins.desktop')
    case 'legacy':
      return t('settings.memory.origins.legacy')
  }
}

/**
 * A remembered person's name, or what their id says when they have none.
 *
 * `onebot:<number>` is the only shape the backend writes
 * (`onebot_user_scope_id`); it is shown as "QQ 3757469533" with the number
 * split out, so the caller can set it in a quieter style and it reads as an
 * identifier rather than as a name.
 */
export function subjectLabel(
  t: TFunction,
  subject: { scope_id: string; display_name: string | null },
): { name: string; id?: undefined } | { name: string; id: string } {
  const displayName = subject.display_name?.trim()
  if (displayName) return { name: displayName }
  const qq = /^onebot:(\d+)$/.exec(subject.scope_id)
  if (qq) return { name: t('settings.memory.person.qq'), id: qq[1] }
  return { name: subject.scope_id }
}
