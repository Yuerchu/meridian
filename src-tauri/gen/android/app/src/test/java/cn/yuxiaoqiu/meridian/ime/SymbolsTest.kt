package cn.yuxiaoqiu.meridian.ime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SymbolsTest {
  @Test
  fun everyPageHasItsOwnNameAndNoBlankOrRepeatedItem() {
    assertEquals(SYMBOL_PAGES.size, SYMBOL_PAGES.map { it.name }.toSet().size)
    for (page in SYMBOL_PAGES) {
      assertTrue(page.name, page.items.isNotEmpty())
      assertTrue(page.name, page.items.none { it.isBlank() })
      assertEquals("${page.name} repeats an item", page.items.size, page.items.toSet().size)
    }
  }

  /** A mark of two characters stays one item: …… is inserted whole. */
  @Test
  fun theChinesePageKeepsItsDoubledMarksWhole() {
    val chinese = SYMBOL_PAGES.first { it.name == "中文" }.items
    assertTrue("……" in chinese && "——" in chinese)
  }
}
