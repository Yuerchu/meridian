package cn.yuxiaoqiu.meridian.ime

import kotlin.math.floor
import kotlin.math.min

/**
 * Where a long-press menu sits and which item a finger is over, in pixels of
 * the keyboard view. Items wrap into rows no wider than the keyboard; the
 * first row is the one nearest the key (it sits directly above it) so the
 * first item — the one a short slide picks — is closest to the finger. The
 * menu is centred on the key and pushed back inside the edges.
 */
data class MenuGeometry(
  val count: Int,
  val columns: Int,
  val rows: Int,
  val left: Float,
  /**
   * The bottom edge of the first row: the key's top edge, or lower when the
   * menu would otherwise leave the top of the keyboard (the first row of keys
   * has only the candidate bar above it), in which case it covers the key.
   */
  val bottom: Float,
  val itemWidth: Float,
  val itemHeight: Float,
) {
  /** Top-left corner of item `index`. */
  fun itemLeft(index: Int): Float = left + (index % columns) * itemWidth
  fun itemTop(index: Int): Float = bottom - (index / columns + 1) * itemHeight

  /**
   * The item under (`x`, `y`), or -1 when the finger has gone well below
   * the key: that is how a person backs out of a menu without choosing.
   * Anywhere else picks the nearest item, so the menu is forgiving sideways.
   */
  fun indexAt(x: Float, y: Float, keyBottom: Float): Int {
    if (y > keyBottom + itemHeight) return -1
    val col = floor((x - left) / itemWidth).toInt().coerceIn(0, columns - 1)
    val row = floor((bottom - y) / itemHeight).toInt().coerceIn(0, rows - 1)
    return min(row * columns + col, count - 1)
  }

  companion object {
    fun of(
      count: Int,
      keyLeft: Float,
      keyRight: Float,
      keyTop: Float,
      itemWidth: Float,
      itemHeight: Float,
      viewWidth: Float,
    ): MenuGeometry {
      require(count > 0)
      val maxColumns = maxOf(1, floor(viewWidth / itemWidth).toInt())
      val columns = min(count, maxColumns)
      val rows = (count + columns - 1) / columns
      val width = columns * itemWidth
      val centred = (keyLeft + keyRight) / 2 - width / 2
      val left = centred.coerceIn(0f, maxOf(0f, viewWidth - width))
      val bottom = maxOf(keyTop, rows * itemHeight)
      return MenuGeometry(count, columns, rows, left, bottom, itemWidth, itemHeight)
    }
  }
}
