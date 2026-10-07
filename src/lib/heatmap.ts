/** Which of the four non-empty steps a value falls on, scaled to the busiest cell. */
export function heatmapStep(value: number, max: number): number {
  return value <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4))
}

/**
 * Where an arrow, Home or End key moves the active cell of a rows × columns
 * grid, or null for any other key. Clamped at the edges rather than wrapping:
 * wrapping from Sunday 23:00 to Monday 00:00 would read as the next hour.
 */
export function heatmapMove(
  key: string,
  [row, column]: readonly [number, number],
  rows: number,
  columns: number,
  ctrl: boolean,
): [number, number] | null {
  switch (key) {
    case 'ArrowLeft':
      return [row, Math.max(0, column - 1)]
    case 'ArrowRight':
      return [row, Math.min(columns - 1, column + 1)]
    case 'ArrowUp':
      return [Math.max(0, row - 1), column]
    case 'ArrowDown':
      return [Math.min(rows - 1, row + 1), column]
    case 'Home':
      return ctrl ? [0, 0] : [row, 0]
    case 'End':
      return ctrl ? [rows - 1, columns - 1] : [row, columns - 1]
    default:
      return null
  }
}
