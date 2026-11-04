import { describe, expect, it } from 'vitest'

import { readsAnyImage } from './model-media'

describe('readsAnyImage', () => {
  it('is true when any image MIME is listed', () => {
    expect(readsAnyImage({ readable_mime_types: ['image/png', 'application/pdf'] })).toBe(true)
  })

  it('is false for an empty or pdf-only list', () => {
    expect(readsAnyImage({ readable_mime_types: [] })).toBe(false)
    expect(readsAnyImage({ readable_mime_types: ['application/pdf'] })).toBe(false)
    expect(readsAnyImage(null)).toBe(false)
  })
})
