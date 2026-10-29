import type { ReadableMime } from '@/types'
import { READABLE_MIMES } from '@/types'

export const IMAGE_MIMES: readonly ReadableMime[] = READABLE_MIMES.filter((mime) => mime.startsWith('image/'))

export function readsAnyImage(caps: { readable_mime_types?: readonly ReadableMime[] } | null | undefined): boolean {
  return (caps?.readable_mime_types ?? []).some((mime) => mime.startsWith('image/'))
}
