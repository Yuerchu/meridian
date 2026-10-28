import { describe, expect, it } from 'vitest'

import { resolveDraftProjectId } from './draft-card'

describe('resolveDraftProjectId', () => {
  const ids = ['project-first', 'project-other']

  it('prefers the stored draft over the last successful create', () => {
    expect(resolveDraftProjectId('project-other', 'project-first', ids)).toBe('project-other')
  })

  it('falls back to the last successful create when nothing is stored', () => {
    expect(resolveDraftProjectId(null, 'project-other', ids)).toBe('project-other')
  })

  it('skips a stored id that is no longer in the list', () => {
    expect(resolveDraftProjectId('project-gone', 'project-other', ids)).toBe('project-other')
  })

  it('uses the first local project when neither id is known', () => {
    expect(resolveDraftProjectId(null, null, ids)).toBe('project-first')
  })

  it('answers null when there is no local project', () => {
    expect(resolveDraftProjectId('project-other', 'project-first', [])).toBeNull()
  })
})
