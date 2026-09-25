package cn.yuxiaoqiu.meridian.ime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MenuGeometryTest {
  private val width = 1080f
  private val item = 120f

  @Test
  fun aShortMenuSitsCentredOverItsKey() {
    val g = MenuGeometry.of(3, keyLeft = 480f, keyRight = 600f, keyTop = 800f, itemWidth = item, itemHeight = 130f, viewWidth = width)
    assertEquals(1, g.rows)
    assertEquals(360f, g.left)
    assertEquals(800f, g.bottom)
    assertEquals(670f, g.itemTop(0))
  }

  @Test
  fun aLongMenuWrapsAndItsFirstRowIsNearestTheKey() {
    val g = MenuGeometry.of(13, 480f, 600f, 800f, item, 130f, width)
    assertEquals(9, g.columns)
    assertEquals(2, g.rows)
    assertTrue("row 0 is below row 1", g.itemTop(0) > g.itemTop(9))
    assertEquals(0f, g.left)
  }

  @Test
  fun itStaysInsideTheEdges() {
    val right = MenuGeometry.of(4, 960f, 1080f, 800f, item, 130f, width)
    assertEquals(width - 4 * item, right.left)
    val top = MenuGeometry.of(13, 0f, 120f, 100f, item, 130f, width)
    assertEquals("pushed down to fit", 260f, top.bottom)
    assertTrue(top.itemTop(12) >= 0f)
  }

  @Test
  fun theFingerPicksTheNearestItemAndBacksOutDownwards() {
    val g = MenuGeometry.of(13, 480f, 600f, 800f, item, 130f, width)
    // On the key itself: the first row, the column under the finger.
    assertEquals(4, g.indexAt(540f, 850f, keyBottom = 930f))
    // Up into the second row.
    assertEquals(9 + 1, g.indexAt(130f, 800f - 130f - 10f, 930f))
    // Past the end of a short last row: the last item.
    assertEquals(12, g.indexAt(1000f, 800f - 200f, 930f))
    // Far below the key: nothing.
    assertEquals(-1, g.indexAt(540f, 930f + 131f, 930f))
  }
}
