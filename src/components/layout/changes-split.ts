import type { PanelSize } from '@/components/base/resizable'

/**
 * The chat / changes split, with units, because the library's numbers are
 * pixels (see `PanelSize`).
 *
 * The changes panel opens at 30% of the pane and can be dragged to half of it.
 * Its floor is a width rather than a share: what has to fit is one row of the
 * file tree — indent, chevron, glyph, a name worth truncating, the line count
 * and the operation letter — and that does not get narrower on a narrow
 * window. 240px is where it stops fitting. On the narrowest pane this mounts
 * in (a 769px window less the sidebar, ~520px) the floor wins over 30%, and the
 * chat's 35% still leaves it the rest.
 */
export const CHAT_PANEL_SIZE = { minSize: '35%' } as const satisfies Record<string, PanelSize>

export const CHANGES_PANEL_SIZE = {
  defaultSize: '30%',
  minSize: '240px',
  maxSize: '50%',
} as const satisfies Record<string, PanelSize>
