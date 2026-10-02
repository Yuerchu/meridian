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

/**
 * How near the divider a press has to land to grab it, in px either way of its
 * 1px line combined.
 *
 * The library hit-tests geometrically: it takes the separator's bounding box
 * and widens it to this when narrower. A pseudo-element or a CSS variable on
 * the handle widens nothing — the shell set one for a long time and the
 * divider kept the library's 10px. This panel mounts only above 768px, which
 * is where touch laptops and tablets in landscape are, so the fine target is
 * wider than a mouse needs too.
 */
export const CHANGES_HANDLE_TARGET = { fine: 16, coarse: 24 } as const
