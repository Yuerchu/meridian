package cn.yuxiaoqiu.meridian.ime

import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutTest {
  private val tokens = EngineJson.decodeFromString(
    ListSerializer(GridToken.serializer()),
    rustFile("ime/android/fixtures/grid-tokens.json").readText(),
  )

  private fun placedTokens(): List<String> =
    GRID_LETTER_ROWS.flatten().mapNotNull { (it.action as? KeyAction.Token)?.name }

  @Test
  fun everyGridKeyIsPlacedOnceAndEveryOtherIsALongPress() {
    val placed = placedTokens()
    assertEquals("placed twice: ${placed.groupBy { it }.filter { it.value.size > 1 }.keys}", placed.toSet().size, placed.size)
    val variants = tokens.flatMap { it.variants }.toSet()
    val all = tokens.map { it.name }.toSet()
    assertEquals("a token reachable by no key", all, placed.toSet() + variants)
    assertTrue("a placed name the engine does not know", all.containsAll(placed))
    assertEquals(35, placed.size)
  }

  @Test
  fun rowsFillTheirColumns() {
    fun widths(layer: Layer) = rows(layer).map { row -> row.sumOf { it.width.toDouble() } }
    assertEquals(List(5) { 9.0 }, widths(Layer.GRID))
    assertEquals(List(5) { 9.0 }, widths(Layer.NUMBER))
    assertEquals(List(4) { 10.0 }, widths(Layer.QWERTY))
  }

  @Test
  fun theDialPadIsComplete() {
    val digits = NUMBER_ROWS.flatten().mapNotNull { (it.action as? KeyAction.Text)?.text }.filter { it.single().isDigit() }
    assertEquals((0..9).map { "$it" }.sorted(), digits.sorted())
    // 1 2 3 on top in the right three columns, 0 under 8.
    assertEquals(listOf("1", "2", "3"), NUMBER_ROWS[0].takeLast(3).map { it.label })
    assertEquals("0", NUMBER_ROWS[3][7].label)
  }

  @Test
  fun backspaceStaysPutAcrossLayers() {
    assertEquals(KeyAction.Backspace, GRID_LETTER_ROWS[3].last().action)
    assertEquals(KeyAction.Backspace, NUMBER_ROWS[3].last().action)
  }

  @Test
  fun thePunctuationMenusMirrorEachOther() {
    val pairs = mapOf(
      "“" to "”", "‘" to "’", "《" to "》", "（" to "）", "【" to "】", "「" to "」",
      "<" to ">", "(" to ")", "[" to "]",
    )
    assertEquals(COMMA_REST.size, STOP_REST.size)
    for (i in (BRACKETS_FROM - 1) until COMMA_REST.size) {
      assertEquals("position ${i + 1}", pairs[COMMA_REST[i]], STOP_REST[i])
    }
    assertEquals(KeyAction.Text(","), commaMenu(chinese = true).first())
    assertEquals(KeyAction.Text("，"), commaMenu(chinese = false).first())
    assertEquals(KeyAction.Text("."), stopMenu(chinese = true).first())
    assertEquals(KeyAction.Text("。"), stopMenu(chinese = false).first())
  }

  @Test
  fun theMedialsSayWhichVowelTheyAre() {
    val hints = GRID_LETTER_ROWS.flatten()
      .filter { (it.action as? KeyAction.Token)?.name in setOf("y", "w", "v") }
      .associate { (it.action as KeyAction.Token).name to it.hint }
    assertEquals(mapOf("y" to "i", "w" to "u", "v" to "ü"), hints)
  }

  @Test
  fun aFuzzyKeyOffersItsPreciseKeysFirst() {
    val byName = tokens.associateBy { it.name }
    val z = GRID_LETTER_ROWS.flatten().single { it.action == KeyAction.Token("z") }
    assertEquals(
      listOf(KeyAction.Token("z_"), KeyAction.Token("zh"), KeyAction.Text("5")),
      gridMenu(z, byName),
    )
    val ng = GRID_LETTER_ROWS.flatten().single { it.action == KeyAction.Token("ng") }
    assertEquals(listOf("er", "-n", "-ng").map { KeyAction.Token(it) }, gridMenu(ng, byName))
  }
}
